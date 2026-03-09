// results.ts — Benchmark result aggregation, summary tables, and cumulative merging.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

import type { BenchmarkResult, LatencyPercentiles } from "./types.ts";
import { getBombardierPath } from "./bombardier.ts";

const execFileAsync = promisify(execFile);

// ─── Types ───────────────────────────────────────────────────

/** Full results file with metadata and individual results */
export interface ResultsFile {
  readonly version: 1;
  readonly generatedAt: string;
  readonly results: ReadonlyArray<BenchmarkResult>;
}

/** A row in the summary table, enriched with ranking data */
interface SummaryRow {
  readonly rank: number;
  readonly framework: string;
  readonly platform: string;
  readonly server: string;
  readonly reqPerSec: number;
  readonly latency: LatencyPercentiles;
  readonly vsFastest: number;
}

// ─── Helpers ─────────────────────────────────────────────────

function padRight(s: string, len: number): string {
  return s.length >= len ? s : s + " ".repeat(len - s.length);
}

function padLeft(s: string, len: number): string {
  return s.length >= len ? s : " ".repeat(len - s.length) + s;
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/** Composite key for matching results across runs */
function resultKey(r: BenchmarkResult): string {
  return `${r.framework}|${r.platform}|${r.server}|${r.scenario}`;
}

// ─── Bombardier Version ──────────────────────────────────────

/** Fetches the bombardier binary version string */
export async function getBombardierVersion(): Promise<string> {
  try {
    const bombardierPath = await getBombardierPath();
    const { stdout } = await execFileAsync(bombardierPath, ["--version"], {
      timeout: 5000,
    });
    const match = /v?\d+\.\d+\.\d+/.exec(stdout.trim());
    return match ? match[0] : stdout.trim().split("\n")[0];
  } catch {
    return "unknown";
  }
}

// ─── Summary Table ───────────────────────────────────────────

/**
 * Generates a markdown-formatted summary table grouped by scenario.
 * Columns: Rank, Framework, Platform, Server, Req/s, p50, p95, p99, vs. Fastest (%)
 */
export function formatSummaryTable(
  results: ReadonlyArray<BenchmarkResult>,
): string {
  if (results.length === 0) {
    return "No benchmark results collected.";
  }

  // Group by scenario
  const byScenario = new Map<string, BenchmarkResult[]>();
  for (const r of results) {
    const existing = byScenario.get(r.scenario);
    if (existing) {
      existing.push(r);
    } else {
      byScenario.set(r.scenario, [r]);
    }
  }

  const lines: string[] = [];

  for (const [scenario, scenarioResults] of byScenario) {
    // Sort by req/s descending
    const sorted = [...scenarioResults].sort(
      (a, b) => b.reqPerSec - a.reqPerSec,
    );
    const fastest = sorted[0].reqPerSec;

    // Build ranked rows
    const rows: SummaryRow[] = sorted.map((r, i) => ({
      rank: i + 1,
      framework: r.framework,
      platform: r.platform,
      server: r.server,
      reqPerSec: r.reqPerSec,
      latency: r.latency,
      vsFastest:
        fastest > 0
          ? Math.round(((fastest - r.reqPerSec) / fastest) * 10000) / 100
          : 0,
    }));

    // Column widths
    const W = {
      rank: 4,
      framework: 28,
      platform: 8,
      server: 12,
      rps: 12,
      p50: 10,
      p95: 10,
      p99: 10,
      vs: 12,
    };

    lines.push(`\n### ${scenario}`);
    lines.push("");

    const header = [
      padLeft("#", W.rank),
      padRight("Framework", W.framework),
      padRight("Platform", W.platform),
      padRight("Server", W.server),
      padLeft("Req/s", W.rps),
      padLeft("p50 (ms)", W.p50),
      padLeft("p95 (ms)", W.p95),
      padLeft("p99 (ms)", W.p99),
      padLeft("vs Fastest", W.vs),
    ].join(" | ");

    const separator = [
      "-".repeat(W.rank),
      "-".repeat(W.framework),
      "-".repeat(W.platform),
      "-".repeat(W.server),
      "-".repeat(W.rps),
      "-".repeat(W.p50),
      "-".repeat(W.p95),
      "-".repeat(W.p99),
      "-".repeat(W.vs),
    ].join(" | ");

    lines.push(`| ${header} |`);
    lines.push(`| ${separator} |`);

    for (const row of rows) {
      const vsFastestStr =
        row.rank === 1 ? "\u2500" : `-${row.vsFastest.toFixed(1)}%`;

      lines.push(
        `| ${[
          padLeft(String(row.rank), W.rank),
          padRight(row.framework, W.framework),
          padRight(row.platform, W.platform),
          padRight(row.server, W.server),
          padLeft(formatNumber(row.reqPerSec), W.rps),
          padLeft(row.latency.p50.toFixed(2), W.p50),
          padLeft(row.latency.p95.toFixed(2), W.p95),
          padLeft(row.latency.p99.toFixed(2), W.p99),
          padLeft(vsFastestStr, W.vs),
        ].join(" | ")} |`,
      );
    }
  }

  return lines.join("\n");
}

/**
 * Prints the summary table to console with formatting.
 */
export function printSummaryTable(
  results: ReadonlyArray<BenchmarkResult>,
): void {
  if (results.length === 0) {
    console.log("\nNo benchmark results collected.");
    return;
  }

  console.log(
    "\n\u2500\u2500\u2500 Benchmark Results Summary \u2500\u2500\u2500",
  );
  console.log(formatSummaryTable(results));
  console.log(
    `\nTotal: ${String(results.length)} benchmark(s) across ${String(new Set(results.map((r) => r.scenario)).size)} scenario(s)`,
  );
}

// ─── Results File I/O ────────────────────────────────────────

/**
 * Writes benchmark results to a timestamped JSON file.
 * Returns the file path.
 */
export async function writeTimestampedResults(
  results: ReadonlyArray<BenchmarkResult>,
  resultsDir: string,
): Promise<string> {
  await mkdir(resultsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${timestamp}.json`;
  const filePath = join(resultsDir, filename);

  const file: ResultsFile = {
    version: 1,
    generatedAt: new Date().toISOString(),
    results,
  };

  await writeFile(filePath, JSON.stringify(file, null, 2) + "\n");
  return filePath;
}

// ─── Cumulative latest.json Merge ────────────────────────────

/**
 * Merges new benchmark results into latest.json with cumulative semantics:
 * - New results overwrite matching framework+platform+server+scenario entries
 * - Unmatched entries from existing latest.json are preserved
 * - Returns the merged results array
 */
export async function mergeLatestResults(
  newResults: ReadonlyArray<BenchmarkResult>,
  resultsDir: string,
): Promise<ReadonlyArray<BenchmarkResult>> {
  await mkdir(resultsDir, { recursive: true });
  const latestPath = join(resultsDir, "latest.json");

  // Load existing results if available
  let existing: BenchmarkResult[] = [];
  try {
    const raw = await readFile(latestPath, "utf-8");
    const parsed: unknown = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      // Legacy format: raw array
      existing = parsed as BenchmarkResult[];
    } else if (
      parsed !== null &&
      typeof parsed === "object" &&
      "results" in parsed
    ) {
      // ResultsFile format
      existing = [...(parsed as ResultsFile).results] as BenchmarkResult[];
    }
  } catch {
    // No existing file or invalid JSON — start fresh
  }

  // Build a map of existing results keyed by composite key
  const merged = new Map<string, BenchmarkResult>();
  for (const r of existing) {
    merged.set(resultKey(r), r);
  }

  // Overwrite with new results
  for (const r of newResults) {
    merged.set(resultKey(r), r);
  }

  const mergedArray = [...merged.values()];

  const file: ResultsFile = {
    version: 1,
    generatedAt: new Date().toISOString(),
    results: mergedArray,
  };

  await writeFile(latestPath, JSON.stringify(file, null, 2) + "\n");
  return mergedArray;
}

// ─── Average Multiple Runs ───────────────────────────────────

/**
 * Averages multiple BenchmarkResult arrays (from N complete runs of the suite)
 * into a single array of results. Groups by composite key and averages numeric fields.
 */
export function averageSuiteRuns(
  runs: ReadonlyArray<ReadonlyArray<BenchmarkResult>>,
): BenchmarkResult[] {
  if (runs.length === 0) return [];
  if (runs.length === 1) return [...runs[0]];

  // Group all results by composite key
  const groups = new Map<string, BenchmarkResult[]>();
  for (const run of runs) {
    for (const r of run) {
      const key = resultKey(r);
      const existing = groups.get(key);
      if (existing) {
        existing.push(r);
      } else {
        groups.set(key, [r]);
      }
    }
  }

  const round2 = (v: number): number => Math.round(v * 100) / 100;
  const averaged: BenchmarkResult[] = [];

  for (const items of groups.values()) {
    const n = items.length;
    const base = items[0];

    const avgReqPerSec = round2(
      items.reduce((sum, r) => sum + r.reqPerSec, 0) / n,
    );

    const avgLatency: LatencyPercentiles = {
      p50: round2(items.reduce((sum, r) => sum + r.latency.p50, 0) / n),
      p75: round2(items.reduce((sum, r) => sum + r.latency.p75, 0) / n),
      p90: round2(items.reduce((sum, r) => sum + r.latency.p90, 0) / n),
      p95: round2(items.reduce((sum, r) => sum + r.latency.p95, 0) / n),
      p99: round2(items.reduce((sum, r) => sum + r.latency.p99, 0) / n),
    };

    const avgErrors = Math.round(
      items.reduce((sum, r) => sum + r.errors, 0) / n,
    );

    averaged.push({
      framework: base.framework,
      platform: base.platform,
      server: base.server,
      scenario: base.scenario,
      reqPerSec: avgReqPerSec,
      latency: avgLatency,
      errors: avgErrors,
      timestamp: base.timestamp,
      systemInfo: base.systemInfo,
      config: base.config,
    });
  }

  return averaged;
}
