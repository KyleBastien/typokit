import { execFile } from "node:child_process";
import { access, chmod, constants, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import type { LatencyPercentiles } from "./types.ts";

const execFileAsync = promisify(execFile);

const BOMBARDIER_VERSION = "v2.0.2";
const GITHUB_RELEASE_BASE = `https://github.com/codesenberg/bombardier/releases/download/${BOMBARDIER_VERSION}`;

/** Configuration for a single bombardier run */
export interface BombardierRunConfig {
  readonly connections: number;
  readonly duration: string;
  readonly method?: string;
  readonly body?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

/** Parsed output from a bombardier benchmark run */
export interface BombardierOutput {
  readonly reqPerSec: number;
  readonly latency: LatencyPercentiles;
  readonly transferPerSec: number;
  readonly totalRequests: number;
  readonly errors: number;
}

/** Default configuration: 100 connections, 30s duration */
export const DEFAULT_CONFIG: BombardierRunConfig = {
  connections: 100,
  duration: "30s",
};

/** CI configuration: 50 connections, 10s duration */
export const CI_CONFIG: BombardierRunConfig = {
  connections: 50,
  duration: "10s",
};

function getCacheDir(): string {
  return join(process.cwd(), "node_modules", ".cache", "benchmarks");
}

function getBinaryName(): string {
  const { platform, arch } = process;

  let os: string;
  switch (platform) {
    case "linux":
      os = "linux";
      break;
    case "darwin":
      os = "darwin";
      break;
    case "win32":
      os = "windows";
      break;
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }

  let architecture: string;
  switch (arch) {
    case "x64":
      architecture = "amd64";
      break;
    case "arm64":
      architecture = "arm64";
      break;
    default:
      throw new Error(`Unsupported architecture: ${arch}`);
  }

  const ext = platform === "win32" ? ".exe" : "";
  return `bombardier-${os}-${architecture}${ext}`;
}

function getDownloadUrl(): string {
  return `${GITHUB_RELEASE_BASE}/${getBinaryName()}`;
}

function getCachedBinaryPath(): string {
  const ext = process.platform === "win32" ? ".exe" : "";
  return join(getCacheDir(), `bombardier${ext}`);
}

async function binaryExists(filePath: string): Promise<boolean> {
  try {
    // On Windows, X_OK is not meaningful; just check file existence
    const mode = process.platform === "win32" ? constants.F_OK : constants.X_OK;
    await access(filePath, mode);
    return true;
  } catch {
    return false;
  }
}

async function downloadBinary(dest: string): Promise<void> {
  const url = getDownloadUrl();
  console.log(`Downloading bombardier ${BOMBARDIER_VERSION} from ${url}...`);

  let response: Response;
  try {
    response = await fetch(url, { redirect: "follow" });
  } catch (error: unknown) {
    exitWithInstallInstructions(
      `Network error: ${error instanceof Error ? error.message : String(error)}`,
      dest,
    );
  }

  if (!response.ok) {
    exitWithInstallInstructions(
      `HTTP ${String(response.status)}: ${response.statusText}`,
      dest,
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await mkdir(getCacheDir(), { recursive: true });
  await writeFile(dest, buffer);

  if (process.platform !== "win32") {
    await chmod(dest, 0o755);
  }

  console.log(`bombardier cached at ${dest}`);
}

function exitWithInstallInstructions(reason: string, dest: string): never {
  console.error(`Failed to download bombardier: ${reason}`);
  console.error("");
  console.error("Manual installation:");
  console.error(
    `  1. Download from https://github.com/codesenberg/bombardier/releases/tag/${BOMBARDIER_VERSION}`,
  );
  console.error(`  2. Place the binary at: ${dest}`);
  if (process.platform !== "win32") {
    console.error(`  3. Make it executable: chmod +x ${dest}`);
  }
  process.exit(1);
}

/**
 * Returns the path to the cached bombardier binary,
 * downloading it from GitHub releases on first run.
 */
export async function getBombardierPath(): Promise<string> {
  const binaryPath = getCachedBinaryPath();

  if (await binaryExists(binaryPath)) {
    return binaryPath;
  }

  await downloadBinary(binaryPath);
  return binaryPath;
}

// --- Bombardier JSON output shape ---

interface BombardierJsonOutput {
  readonly result: {
    readonly bytesRead: number;
    readonly bytesWritten: number;
    readonly timeTakenSeconds: number;
    readonly req1xx: number;
    readonly req2xx: number;
    readonly req3xx: number;
    readonly req4xx: number;
    readonly req5xx: number;
    readonly others: number;
    readonly errors?: ReadonlyArray<{
      readonly description: string;
      readonly count: number;
    }>;
    readonly latency?: {
      readonly mean: number;
      readonly stddev: number;
      readonly max: number;
      readonly percentiles?: Readonly<Record<string, number>>;
    };
    readonly rps?: {
      readonly mean: number;
      readonly stddev: number;
      readonly max: number;
      readonly percentiles?: Readonly<Record<string, number>>;
    };
  };
}

/** Convert microseconds to milliseconds, rounded to 2 decimal places */
function usToMs(us: number): number {
  return Math.round((us / 1000) * 100) / 100;
}

function parseBombardierOutput(json: BombardierJsonOutput): BombardierOutput {
  const { result } = json;
  const latPcts = result.latency?.percentiles ?? {};
  const errorCount =
    result.req4xx +
    result.req5xx +
    result.others +
    (result.errors?.reduce((sum, e) => sum + e.count, 0) ?? 0);
  const totalRequests =
    result.req1xx +
    result.req2xx +
    result.req3xx +
    result.req4xx +
    result.req5xx +
    result.others;
  const transferPerSec =
    result.timeTakenSeconds > 0
      ? result.bytesRead / result.timeTakenSeconds
      : 0;

  return {
    reqPerSec: Math.round((result.rps?.mean ?? 0) * 100) / 100,
    latency: {
      p50: usToMs(latPcts["50"] ?? 0),
      p75: usToMs(latPcts["75"] ?? 0),
      p90: usToMs(latPcts["90"] ?? 0),
      p95: usToMs(latPcts["95"] ?? 0),
      p99: usToMs(latPcts["99"] ?? 0),
    },
    transferPerSec: Math.round(transferPerSec),
    totalRequests,
    errors: errorCount,
  };
}

/**
 * Spawns bombardier against the given URL, parses JSON output,
 * and returns structured benchmark results.
 */
export async function runBombardier(
  url: string,
  config?: Partial<BombardierRunConfig>,
): Promise<BombardierOutput> {
  const bombardierPath = await getBombardierPath();
  const merged: BombardierRunConfig = { ...DEFAULT_CONFIG, ...config };

  const args = [
    url,
    "-c",
    String(merged.connections),
    "-d",
    merged.duration,
    "-o",
    "json",
    "-l",
  ];

  if (merged.method) {
    args.push("-m", merged.method);
  }
  if (merged.body) {
    args.push("-b", merged.body);
  }
  if (merged.headers) {
    for (const [key, value] of Object.entries(merged.headers)) {
      args.push("-H", `${key}: ${value}`);
    }
  }

  const { stdout } = await execFileAsync(bombardierPath, args, {
    timeout: 300_000,
    maxBuffer: 10 * 1024 * 1024,
  });

  const json: BombardierJsonOutput = JSON.parse(stdout) as BombardierJsonOutput;
  return parseBombardierOutput(json);
}
