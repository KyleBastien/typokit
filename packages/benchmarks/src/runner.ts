// runner.ts — Benchmark suite runner.
// Orchestrates: start server → poll health → warmup → bombardier → collect → stop → next app.
// Usage: npx tsx src/runner.ts [options]

import type { ChildProcess } from "node:child_process";
import { execFile, spawn } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { cpus, totalmem, type as osType, release, arch } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import type {
  BenchmarkResult,
  LatencyPercentiles,
  SystemInfo,
} from "./types.ts";
import { runBombardier } from "./bombardier.ts";
import type { BombardierOutput, BombardierRunConfig } from "./bombardier.ts";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, "..");

// ─── Types ───────────────────────────────────────────────────

type Scenario = "json" | "validate" | "db" | "middleware" | "startup";

interface AppDef {
  readonly name: string;
  readonly framework: string;
  readonly platform: string;
  readonly server: string;
  readonly mode: "direct" | "bun" | "deno" | "rust";
  readonly binaryName?: string;
}

interface AppHandle {
  readonly port: number;
  readonly stop: () => Promise<void>;
}

interface AppModule {
  start: (
    dbPath?: string,
  ) => Promise<{ port: number; close: () => Promise<void> }>;
}

interface RunnerConfig {
  readonly scenarios: ReadonlyArray<Scenario>;
  readonly filter: string;
  readonly connections: number;
  readonly duration: string;
  readonly warmup: string;
  readonly runs: number;
}

interface ScenarioDef {
  readonly path: string;
  readonly method?: string;
  readonly body?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

// ─── Constants ───────────────────────────────────────────────

const ALL_SCENARIOS: ReadonlyArray<Scenario> = [
  "json",
  "validate",
  "db",
  "middleware",
  "startup",
];

const DEFAULT_RUNNER_CONFIG: RunnerConfig = {
  scenarios: ALL_SCENARIOS,
  filter: "*",
  connections: 100,
  duration: "30s",
  warmup: "5s",
  runs: 3,
};

const VALID_POST_BODY = JSON.stringify({
  title: "Benchmark Item",
  status: "active",
  priority: 5,
  tags: ["benchmark"],
  author: { name: "Bench Runner", email: "bench@test.com" },
});

const SCENARIO_DEFS: Readonly<Record<Scenario, ScenarioDef>> = {
  json: { path: "/json" },
  validate: {
    path: "/validate",
    method: "POST",
    body: VALID_POST_BODY,
    headers: { "content-type": "application/json" },
  },
  db: { path: "/db/1" },
  middleware: { path: "/middleware" },
  startup: { path: "/startup" },
};

// ─── App Registry ────────────────────────────────────────────

const APP_REGISTRY: ReadonlyArray<AppDef> = [
  // TypoKit × Node.js
  {
    name: "typokit-node-native",
    framework: "typokit",
    platform: "node",
    server: "native",
    mode: "direct",
  },
  {
    name: "typokit-node-fastify",
    framework: "typokit",
    platform: "node",
    server: "fastify",
    mode: "direct",
  },
  {
    name: "typokit-node-hono",
    framework: "typokit",
    platform: "node",
    server: "hono",
    mode: "direct",
  },
  {
    name: "typokit-node-express",
    framework: "typokit",
    platform: "node",
    server: "express",
    mode: "direct",
  },

  // TypoKit × Bun
  {
    name: "typokit-bun-native",
    framework: "typokit",
    platform: "bun",
    server: "native",
    mode: "bun",
  },
  {
    name: "typokit-bun-fastify",
    framework: "typokit",
    platform: "bun",
    server: "fastify",
    mode: "bun",
  },
  {
    name: "typokit-bun-hono",
    framework: "typokit",
    platform: "bun",
    server: "hono",
    mode: "bun",
  },
  {
    name: "typokit-bun-express",
    framework: "typokit",
    platform: "bun",
    server: "express",
    mode: "bun",
  },

  // TypoKit × Deno
  {
    name: "typokit-deno-native",
    framework: "typokit",
    platform: "deno",
    server: "native",
    mode: "deno",
  },
  {
    name: "typokit-deno-fastify",
    framework: "typokit",
    platform: "deno",
    server: "fastify",
    mode: "deno",
  },
  {
    name: "typokit-deno-hono",
    framework: "typokit",
    platform: "deno",
    server: "hono",
    mode: "deno",
  },
  {
    name: "typokit-deno-express",
    framework: "typokit",
    platform: "deno",
    server: "express",
    mode: "deno",
  },

  // TypoKit × Rust/Axum
  {
    name: "typokit-rust-axum",
    framework: "typokit",
    platform: "rust",
    server: "axum",
    mode: "rust",
    binaryName: "typokit-benchmark-axum",
  },

  // Raw baselines
  {
    name: "raw-node",
    framework: "raw",
    platform: "node",
    server: "http",
    mode: "direct",
  },
  {
    name: "raw-bun",
    framework: "raw",
    platform: "bun",
    server: "bun-serve",
    mode: "bun",
  },
  {
    name: "raw-deno",
    framework: "raw",
    platform: "deno",
    server: "deno-serve",
    mode: "deno",
  },
  {
    name: "raw-axum",
    framework: "raw",
    platform: "rust",
    server: "axum",
    mode: "rust",
    binaryName: "raw-benchmark-axum",
  },

  // Competitors
  {
    name: "competitor-express",
    framework: "express",
    platform: "node",
    server: "standalone",
    mode: "direct",
  },
  {
    name: "competitor-fastify",
    framework: "fastify",
    platform: "node",
    server: "standalone",
    mode: "direct",
  },
  {
    name: "competitor-hono",
    framework: "hono",
    platform: "node",
    server: "standalone",
    mode: "direct",
  },
  {
    name: "competitor-koa",
    framework: "koa",
    platform: "node",
    server: "standalone",
    mode: "direct",
  },
  {
    name: "competitor-elysia",
    framework: "elysia",
    platform: "bun",
    server: "standalone",
    mode: "bun",
  },
  {
    name: "competitor-trpc",
    framework: "trpc",
    platform: "node",
    server: "standalone",
    mode: "direct",
  },
  {
    name: "competitor-nestjs",
    framework: "nestjs",
    platform: "node",
    server: "standalone",
    mode: "direct",
  },
  {
    name: "competitor-h3",
    framework: "h3",
    platform: "node",
    server: "standalone",
    mode: "direct",
  },
  {
    name: "competitor-adonis",
    framework: "adonis",
    platform: "node",
    server: "standalone",
    mode: "direct",
  },
];

// ─── Helpers ─────────────────────────────────────────────────

function log(msg: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function matchesFilter(name: string, filter: string): boolean {
  if (filter === "*") return true;
  const patterns = filter.split(",").map((p) => p.trim());
  return patterns.some((pattern) => {
    const regexStr =
      "^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$";
    return new RegExp(regexStr).test(name);
  });
}

function padRight(s: string, len: number): string {
  return s.length >= len ? s : s + " ".repeat(len - s.length);
}

function padLeft(s: string, len: number): string {
  return s.length >= len ? s : " ".repeat(len - s.length) + s;
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function collectSystemInfo(): SystemInfo {
  return {
    os: `${osType()} ${release()} ${arch()}`,
    cpu: cpus()[0]?.model ?? "unknown",
    cpuCores: cpus().length,
    ram: `${Math.round(totalmem() / (1024 * 1024 * 1024))} GB`,
    runtimeVersions: {
      node: process.version,
    },
  };
}

// ─── App Lifecycle: Direct ───────────────────────────────────

async function startDirectApp(appDef: AppDef): Promise<AppHandle> {
  const mod = (await import(`./apps/${appDef.name}.ts`)) as AppModule;
  const handle = await mod.start();
  return { port: handle.port, stop: handle.close };
}

// ─── App Lifecycle: Subprocess (Bun/Deno) ────────────────────

function startSubprocessApp(
  appDef: AppDef,
  runtime: string,
  runtimeArgs: ReadonlyArray<string>,
): Promise<AppHandle> {
  const entryFile = join(__dirname, "subprocess-entry.ts");
  const args = [...runtimeArgs, entryFile, appDef.name];

  return new Promise<AppHandle>((resolve, reject) => {
    const child: ChildProcess = spawn(runtime, args, {
      cwd: join(__dirname, ".."),
      stdio: ["pipe", "pipe", "pipe"],
    });

    let resolved = false;
    let stdout = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      const match = /BENCHMARK_PORT=(\d+)/.exec(stdout);
      if (match && !resolved) {
        resolved = true;
        const port = Number(match[1]);
        resolve({
          port,
          stop: () => killChild(child),
        });
      }
    });

    child.stderr?.on("data", (_chunk: Buffer) => {
      // Subprocess stderr is suppressed during benchmarking
    });

    child.on("error", (err: Error) => {
      if (!resolved) {
        resolved = true;
        reject(new Error(`Failed to start ${appDef.name}: ${err.message}`));
      }
    });

    child.on("exit", (code) => {
      if (!resolved) {
        resolved = true;
        reject(
          new Error(
            `${appDef.name} exited with code ${String(code)} before reporting port`,
          ),
        );
      }
    });

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        child.kill("SIGKILL");
        reject(new Error(`${appDef.name} timed out starting (30s)`));
      }
    }, 30_000);
  });
}

// ─── App Lifecycle: Rust ─────────────────────────────────────

async function startRustApp(appDef: AppDef): Promise<AppHandle> {
  const cargoDir = join(__dirname, "apps", appDef.name);
  const dbPath = join(__dirname, "..", "fixtures", "benchmark.sqlite");

  log(`  Building ${appDef.name} (cargo build --release)...`);
  await execFileAsync("cargo", ["build", "--release"], {
    cwd: cargoDir,
    timeout: 180_000,
  });

  const ext = process.platform === "win32" ? ".exe" : "";
  const binaryPath = join(
    cargoDir,
    "target",
    "release",
    `${appDef.binaryName ?? appDef.name}${ext}`,
  );

  const port = 40000 + Math.floor(Math.random() * 10000);

  const child: ChildProcess = spawn(binaryPath, ["--port", String(port)], {
    cwd: join(__dirname, "..", "fixtures"),
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, DB_PATH: dbPath },
  });

  // Wait for the binary to be healthy
  const startTime = Date.now();
  while (Date.now() - startTime < 15_000) {
    try {
      const res = await fetch(`http://127.0.0.1:${String(port)}/json`);
      if (res.ok) {
        return {
          port,
          stop: () => killChild(child),
        };
      }
    } catch {
      // not ready yet
    }
    await sleep(100);
  }

  child.kill("SIGKILL");
  throw new Error(`${appDef.name} health check timed out after 15s`);
}

// ─── Process Cleanup ─────────────────────────────────────────

function killChild(child: ChildProcess): Promise<void> {
  return new Promise<void>((resolve) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }
    child.on("exit", () => resolve());
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }, 5000);
  });
}

// ─── App Start Dispatcher ────────────────────────────────────

async function startApp(appDef: AppDef): Promise<AppHandle> {
  switch (appDef.mode) {
    case "direct":
      return startDirectApp(appDef);
    case "bun":
      return startSubprocessApp(appDef, "bun", ["run"]);
    case "deno":
      return startSubprocessApp(appDef, "deno", ["run", "--allow-all"]);
    case "rust":
      return startRustApp(appDef);
  }
}

// ─── Health Check ────────────────────────────────────────────

async function pollHealth(port: number, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${String(port)}/json`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await sleep(100);
  }
  throw new Error(`Health check timed out after ${String(timeoutMs)}ms`);
}

// ─── Benchmarking ────────────────────────────────────────────

function averageOutputs(results: ReadonlyArray<BombardierOutput>): {
  reqPerSec: number;
  latency: LatencyPercentiles;
  errors: number;
} {
  const n = results.length;
  if (n === 0) throw new Error("No results to average");

  const sum = (fn: (r: BombardierOutput) => number): number =>
    results.reduce((acc, r) => acc + fn(r), 0) / n;
  const round2 = (v: number): number => Math.round(v * 100) / 100;

  return {
    reqPerSec: round2(sum((r) => r.reqPerSec)),
    latency: {
      p50: round2(sum((r) => r.latency.p50)),
      p75: round2(sum((r) => r.latency.p75)),
      p90: round2(sum((r) => r.latency.p90)),
      p95: round2(sum((r) => r.latency.p95)),
      p99: round2(sum((r) => r.latency.p99)),
    },
    errors: Math.round(sum((r) => r.errors)),
  };
}

async function benchmarkScenario(
  port: number,
  scenario: Scenario,
  config: RunnerConfig,
): Promise<{ reqPerSec: number; latency: LatencyPercentiles; errors: number }> {
  const scenarioDef = SCENARIO_DEFS[scenario];
  const url = `http://127.0.0.1:${String(port)}${scenarioDef.path}`;

  const bombardierConfig: Partial<BombardierRunConfig> = {
    connections: config.connections,
    duration: config.duration,
    method: scenarioDef.method,
    body: scenarioDef.body,
    headers: scenarioDef.headers ? { ...scenarioDef.headers } : undefined,
  };

  const runs: BombardierOutput[] = [];
  for (let i = 0; i < config.runs; i++) {
    if (config.runs > 1) {
      log(`    Run ${String(i + 1)}/${String(config.runs)}...`);
    }
    const result = await runBombardier(url, bombardierConfig);
    runs.push(result);
  }

  return averageOutputs(runs);
}

// ─── Summary Table ───────────────────────────────────────────

function printSummaryTable(results: ReadonlyArray<BenchmarkResult>): void {
  if (results.length === 0) {
    console.log("\nNo benchmark results collected.");
    return;
  }

  const W = { name: 28, scenario: 12, rps: 12, p50: 10, p99: 10, errors: 8 };

  const header = [
    padRight("Framework", W.name),
    padRight("Scenario", W.scenario),
    padLeft("req/sec", W.rps),
    padLeft("p50 (ms)", W.p50),
    padLeft("p99 (ms)", W.p99),
    padLeft("Errors", W.errors),
  ].join("  ");

  const divider = "\u2500".repeat(header.length);

  console.log("");
  console.log(header);
  console.log(divider);

  for (const r of results) {
    console.log(
      [
        padRight(r.framework, W.name),
        padRight(r.scenario, W.scenario),
        padLeft(formatNumber(r.reqPerSec), W.rps),
        padLeft(r.latency.p50.toFixed(2), W.p50),
        padLeft(r.latency.p99.toFixed(2), W.p99),
        padLeft(String(r.errors), W.errors),
      ].join("  "),
    );
  }

  console.log(divider);
  console.log(`Total: ${String(results.length)} benchmark(s)\n`);
}

// ─── Results File ────────────────────────────────────────────

async function writeResults(
  results: ReadonlyArray<BenchmarkResult>,
): Promise<string> {
  const resultsDir = join(__dirname, "..", "results");
  await mkdir(resultsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${timestamp}.json`;
  const filePath = join(resultsDir, filename);

  await writeFile(filePath, JSON.stringify(results, null, 2) + "\n");
  return filePath;
}

// ─── Runner ──────────────────────────────────────────────────

async function runSuite(config: RunnerConfig): Promise<BenchmarkResult[]> {
  const apps = APP_REGISTRY.filter((app) =>
    matchesFilter(app.name, config.filter),
  );

  if (apps.length === 0) {
    log("No apps match the filter. Exiting.");
    return [];
  }

  log(
    `Starting benchmark suite: ${String(apps.length)} app(s), ` +
      `${String(config.scenarios.length)} scenario(s), ` +
      `${String(config.runs)} run(s) each`,
  );
  log(
    `Config: ${String(config.connections)} connections, ${config.duration} duration, ${config.warmup} warmup`,
  );

  const systemInfo = collectSystemInfo();
  const benchmarkConfig = {
    connections: config.connections,
    duration: config.duration,
    warmup: config.warmup,
    runs: config.runs,
  };
  const allResults: BenchmarkResult[] = [];

  for (const app of apps) {
    log(`\n[${app.name}] Starting...`);

    let handle: AppHandle;
    try {
      handle = await startApp(app);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`  SKIP ${app.name}: ${msg}`);
      continue;
    }

    try {
      log(`  Listening on port ${String(handle.port)}`);
      await pollHealth(handle.port);
      log("  Health check passed");

      // Warmup
      if (config.warmup !== "0s") {
        log(`  Warming up (${config.warmup})...`);
        await runBombardier(`http://127.0.0.1:${String(handle.port)}/json`, {
          connections: config.connections,
          duration: config.warmup,
        });
      }

      // Run each scenario
      for (const scenario of config.scenarios) {
        log(`  Benchmarking: ${scenario}`);
        try {
          const avg = await benchmarkScenario(handle.port, scenario, config);
          const result: BenchmarkResult = {
            framework: app.name,
            platform: app.platform,
            server: app.server,
            scenario,
            reqPerSec: avg.reqPerSec,
            latency: avg.latency,
            errors: avg.errors,
            timestamp: new Date().toISOString(),
            systemInfo,
            config: benchmarkConfig,
          };
          allResults.push(result);
          log(
            `    ${formatNumber(avg.reqPerSec)} req/s, p50=${avg.latency.p50.toFixed(2)}ms, p99=${avg.latency.p99.toFixed(2)}ms`,
          );
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          log(`    ERROR in ${scenario}: ${msg}`);
        }
      }
    } finally {
      log(`  Stopping ${app.name}...`);
      await handle.stop();
    }
  }

  return allResults;
}

// ─── System Info Mode ────────────────────────────────────────

function printSystemInfo(): void {
  const info = collectSystemInfo();
  console.log("\nSystem Information:");
  console.log(`  OS:       ${info.os}`);
  console.log(`  CPU:      ${info.cpu}`);
  console.log(`  Cores:    ${String(info.cpuCores)}`);
  console.log(`  RAM:      ${info.ram}`);
  console.log(`  Node.js:  ${info.runtimeVersions.node ?? "N/A"}`);
  console.log(`\nRegistered apps: ${String(APP_REGISTRY.length)}`);
  console.log(`Available scenarios: ${ALL_SCENARIOS.join(", ")}\n`);
}

// ─── Reproduce Mode ──────────────────────────────────────────

async function printReproduceInfo(): Promise<void> {
  const resultsDir = join(__dirname, "..", "results");
  let files: string[];
  try {
    files = await readdir(resultsDir);
  } catch {
    console.log("No results directory found. Run benchmarks first.");
    return;
  }

  const jsonFiles = files.filter((f) => f.endsWith(".json")).sort();
  if (jsonFiles.length === 0) {
    console.log("No result files found. Run benchmarks first.");
    return;
  }

  const latestFile = jsonFiles[jsonFiles.length - 1];
  const filePath = join(resultsDir, latestFile);
  const raw = await readFile(filePath, "utf-8");
  const results = JSON.parse(raw) as ReadonlyArray<BenchmarkResult>;

  if (results.length === 0) {
    console.log("Latest results file is empty.");
    return;
  }

  const cfg = results[0].config;
  console.log("\nTo reproduce the last benchmark results:");
  console.log(
    `  npx tsx src/runner.ts --connections ${String(cfg.connections)} ` +
      `--duration ${cfg.duration} --warmup ${cfg.warmup} --runs ${String(cfg.runs)}`,
  );
  console.log(`\nLast results: results/${latestFile}`);
  console.log(`Timestamp: ${results[0].timestamp}\n`);
}

// ─── CLI ─────────────────────────────────────────────────────

function parseArgs(): {
  mode: "run" | "info" | "reproduce";
  config: RunnerConfig;
} {
  const args = process.argv.slice(2);
  let mode: "run" | "info" | "reproduce" = "run";
  const overrides: Partial<RunnerConfig> = {};
  const scenarios: Scenario[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case "--info":
        mode = "info";
        break;
      case "--reproduce":
        mode = "reproduce";
        break;
      case "--scenario":
        if (next && ALL_SCENARIOS.includes(next as Scenario)) {
          scenarios.push(next as Scenario);
          i++;
        }
        break;
      case "--filter":
        if (next) {
          overrides.filter = next;
          i++;
        }
        break;
      case "--connections":
        if (next) {
          overrides.connections = Number(next);
          i++;
        }
        break;
      case "--duration":
        if (next) {
          overrides.duration = next;
          i++;
        }
        break;
      case "--warmup":
        if (next) {
          overrides.warmup = next;
          i++;
        }
        break;
      case "--runs":
        if (next) {
          overrides.runs = Number(next);
          i++;
        }
        break;
    }
  }

  if (scenarios.length > 0) {
    overrides.scenarios = scenarios;
  }

  return {
    mode,
    config: { ...DEFAULT_RUNNER_CONFIG, ...overrides },
  };
}

async function main(): Promise<void> {
  const { mode, config } = parseArgs();

  switch (mode) {
    case "info":
      printSystemInfo();
      return;
    case "reproduce":
      await printReproduceInfo();
      return;
    case "run":
      break;
  }

  console.log(
    "\n\u2500\u2500\u2500 TypoKit Benchmark Suite \u2500\u2500\u2500\n",
  );

  const results = await runSuite(config);

  if (results.length > 0) {
    printSummaryTable(results);

    const filePath = await writeResults(results);
    log(`Results written to ${filePath}`);
  }

  console.log("\nDone.\n");
}

void main();
