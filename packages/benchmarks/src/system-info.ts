// system-info.ts — System information collection for benchmark reproducibility.
// Detects OS, CPU, RAM, runtime versions (Node/Bun/Deno/Rust), and bombardier version.

import { execFile } from "node:child_process";
import { cpus, totalmem, type as osType, release, arch } from "node:os";
import { promisify } from "node:util";

import type { SystemInfo } from "./types.ts";
import { getBombardierVersion } from "./results.ts";

const execFileAsync = promisify(execFile);

// ─── Runtime Detection ───────────────────────────────────────

/** Safely execute a command and return trimmed stdout, or undefined on failure. */
async function tryExec(
  cmd: string,
  args: ReadonlyArray<string>,
): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(cmd, [...args], { timeout: 5000 });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

/** Detect Bun version if available. */
async function detectBunVersion(): Promise<string | undefined> {
  const out = await tryExec("bun", ["--version"]);
  if (!out) return undefined;
  // `bun --version` outputs something like "1.1.12"
  const match = /\d+\.\d+\.\d+/.exec(out);
  return match ? match[0] : out.split("\n")[0];
}

/** Detect Deno version if available. */
async function detectDenoVersion(): Promise<string | undefined> {
  const out = await tryExec("deno", ["--version"]);
  if (!out) return undefined;
  // `deno --version` outputs: "deno 1.42.0 (release, ...)\nv8 ...\ntypescript ..."
  const match = /deno\s+(\d+\.\d+\.\d+)/.exec(out);
  return match ? match[1] : out.split("\n")[0];
}

/** Detect rustc version if available. */
async function detectRustcVersion(): Promise<string | undefined> {
  const out = await tryExec("rustc", ["--version"]);
  if (!out) return undefined;
  // `rustc --version` outputs: "rustc 1.77.0 (aedd173a2 2024-03-17)"
  const match = /rustc\s+(\d+\.\d+\.\d+)/.exec(out);
  return match ? match[1] : out.split("\n")[0];
}

/** Detect cargo version if available. */
async function detectCargoVersion(): Promise<string | undefined> {
  const out = await tryExec("cargo", ["--version"]);
  if (!out) return undefined;
  // `cargo --version` outputs: "cargo 1.77.0 (3fe68eab6 2024-02-29)"
  const match = /cargo\s+(\d+\.\d+\.\d+)/.exec(out);
  return match ? match[1] : out.split("\n")[0];
}

// ─── System Info Collection ──────────────────────────────────

/**
 * Collects comprehensive system information for benchmark reproducibility.
 * Detects OS, CPU, RAM, all available runtime versions, and bombardier version.
 */
export async function collectSystemInfo(): Promise<SystemInfo> {
  const [
    bombardierVersion,
    bunVersion,
    denoVersion,
    rustcVersion,
    cargoVersion,
  ] = await Promise.all([
    getBombardierVersion(),
    detectBunVersion(),
    detectDenoVersion(),
    detectRustcVersion(),
    detectCargoVersion(),
  ]);

  const runtimeVersions: {
    node?: string;
    bun?: string;
    deno?: string;
    rustc?: string;
  } = {
    node: process.version,
  };

  if (bunVersion) {
    runtimeVersions.bun = bunVersion;
  }
  if (denoVersion) {
    runtimeVersions.deno = denoVersion;
  }
  if (rustcVersion) {
    runtimeVersions.rustc = cargoVersion
      ? `${rustcVersion} (cargo ${cargoVersion})`
      : rustcVersion;
  }

  return {
    os: `${osType()} ${release()} ${arch()}`,
    cpu: cpus()[0]?.model ?? "unknown",
    cpuCores: cpus().length,
    ram: `${Math.round(totalmem() / (1024 * 1024 * 1024))} GB`,
    runtimeVersions,
    bombardierVersion,
  };
}

/**
 * Formats system info (or extended system info) as a JSON string suitable for stdout output.
 */
export function formatSystemInfoJson(info: Record<string, unknown>): string {
  return JSON.stringify(info, null, 2);
}

/**
 * Generates step-by-step reproduction instructions.
 */
export function formatReproduceInstructions(
  config?: {
    connections: number;
    duration: string;
    warmup: string;
    runs: number;
  },
  lastResultsFile?: string,
): string {
  const lines: string[] = [];

  lines.push("# Benchmark Reproduction Instructions");
  lines.push("");
  lines.push("## Prerequisites");
  lines.push("");
  lines.push("1. Node.js >= 24 (https://nodejs.org/)");
  lines.push("2. pnpm 10.x (https://pnpm.io/)");
  lines.push("3. (Optional) Bun >= 1.0 for Bun benchmarks (https://bun.sh/)");
  lines.push(
    "4. (Optional) Deno >= 2.0 for Deno benchmarks (https://deno.land/)",
  );
  lines.push(
    "5. (Optional) Rust/Cargo for Axum benchmarks (https://rustup.rs/)",
  );
  lines.push(
    "6. bombardier HTTP benchmark tool is auto-downloaded on first run",
  );
  lines.push("");
  lines.push("## Setup");
  lines.push("");
  lines.push("```bash");
  lines.push("git clone https://github.com/AltScore/typokit.git");
  lines.push("cd typokit");
  lines.push("git checkout ralph/benchmark-suite");
  lines.push("pnpm install");
  lines.push("pnpm nx run-many -t build");
  lines.push("```");
  lines.push("");

  if (config) {
    lines.push("## Run Benchmarks (exact reproduction)");
    lines.push("");
    lines.push("```bash");
    lines.push(
      `pnpm nx bench benchmarks -- --connections ${String(config.connections)} ` +
        `--duration ${config.duration} --warmup ${config.warmup} --runs ${String(config.runs)}`,
    );
    lines.push("```");
  } else {
    lines.push("## Run Benchmarks (default settings)");
    lines.push("");
    lines.push("```bash");
    lines.push("pnpm nx bench benchmarks");
    lines.push("```");
  }

  lines.push("");
  lines.push("## Alternative targets");
  lines.push("");
  lines.push("```bash");
  lines.push(
    "pnpm nx bench-ci benchmarks      # Quick CI mode (fewer frameworks, shorter duration)",
  );
  lines.push("pnpm nx bench-baseline benchmarks # Raw baselines only");
  lines.push("pnpm nx bench-info benchmarks     # Print system info as JSON");
  lines.push("```");
  lines.push("");
  lines.push("## Results");
  lines.push("");
  lines.push("Results are written to `packages/benchmarks/results/`:");
  lines.push("- `latest.json` — cumulative latest results (updated each run)");
  lines.push("- `<timestamp>.json` — individual run snapshots");

  if (lastResultsFile) {
    lines.push("");
    lines.push(`Last results file: ${lastResultsFile}`);
  }

  return lines.join("\n");
}
