// compare-baseline.ts — Compare benchmark results against baseline for regression detection.
//
// Usage: npx tsx src/compare-baseline.ts [baseline-path] [results-path] [output-path]
// Defaults: baseline.json, results/latest.json
// Exit code 1 if any TypoKit combination degrades by more than 10% in req/s.

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { BenchmarkResult } from "./types.ts";

// ─── Types ───────────────────────────────────────────────────

interface ResultsFileShape {
  readonly results: ReadonlyArray<BenchmarkResult>;
}

interface ComparisonEntry {
  readonly framework: string;
  readonly platform: string;
  readonly server: string;
  readonly scenario: string;
  readonly baselineReqPerSec: number;
  readonly currentReqPerSec: number;
  readonly changePct: number;
  readonly regressed: boolean;
}

// ─── Constants ───────────────────────────────────────────────

/** Fail threshold: TypoKit results degraded by more than this % trigger failure */
const REGRESSION_THRESHOLD = -10;

// ─── Helpers ─────────────────────────────────────────────────

function formatNumber(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function resultKey(r: BenchmarkResult): string {
  return `${r.framework}|${r.platform}|${r.server}|${r.scenario}`;
}

async function loadResults(
  path: string,
): Promise<ReadonlyArray<BenchmarkResult>> {
  const raw = await readFile(path, "utf-8");
  const parsed: unknown = JSON.parse(raw);

  if (Array.isArray(parsed)) {
    return parsed as BenchmarkResult[];
  }
  if (parsed !== null && typeof parsed === "object" && "results" in parsed) {
    return (parsed as ResultsFileShape).results;
  }
  return [];
}

// ─── Comparison ──────────────────────────────────────────────

function buildComparisons(
  baseline: ReadonlyArray<BenchmarkResult>,
  current: ReadonlyArray<BenchmarkResult>,
): ComparisonEntry[] {
  const baselineMap = new Map<string, BenchmarkResult>();
  for (const r of baseline) {
    baselineMap.set(resultKey(r), r);
  }

  const comparisons: ComparisonEntry[] = [];

  for (const r of current) {
    const b = baselineMap.get(resultKey(r));
    if (!b) continue;

    const changePct =
      b.reqPerSec > 0
        ? Math.round(((r.reqPerSec - b.reqPerSec) / b.reqPerSec) * 10000) / 100
        : 0;

    comparisons.push({
      framework: r.framework,
      platform: r.platform,
      server: r.server,
      scenario: r.scenario,
      baselineReqPerSec: b.reqPerSec,
      currentReqPerSec: r.reqPerSec,
      changePct,
      regressed:
        r.framework.startsWith("typokit-") && changePct < REGRESSION_THRESHOLD,
    });
  }

  return comparisons.sort((a, b) => a.changePct - b.changePct);
}

// ─── Markdown Output ─────────────────────────────────────────

function formatMarkdown(comparisons: ReadonlyArray<ComparisonEntry>): string {
  const lines: string[] = [];
  lines.push("## Benchmark Results vs Baseline");
  lines.push("");

  if (comparisons.length === 0) {
    lines.push("No comparable results found (no matching baseline entries).");
    lines.push("");
    lines.push("### ✅ No regressions detected");
    return lines.join("\n");
  }

  lines.push(
    "| Framework | Platform | Server | Scenario | Baseline (req/s) | Current (req/s) | Change |",
  );
  lines.push("| --- | --- | --- | --- | ---: | ---: | ---: |");

  for (const c of comparisons) {
    const emoji = c.regressed ? "🔴" : c.changePct >= 0 ? "🟢" : "🟡";
    const sign = c.changePct >= 0 ? "+" : "";
    const changeStr = `${emoji} ${sign}${c.changePct.toFixed(1)}%`;

    lines.push(
      `| ${c.framework} | ${c.platform} | ${c.server} | ${c.scenario} | ${formatNumber(c.baselineReqPerSec)} | ${formatNumber(c.currentReqPerSec)} | ${changeStr} |`,
    );
  }

  const regressions = comparisons.filter((c) => c.regressed);
  lines.push("");

  if (regressions.length > 0) {
    lines.push(
      `### ⚠️ ${String(regressions.length)} TypoKit regression(s) detected (>${String(Math.abs(REGRESSION_THRESHOLD))}% degradation)`,
    );
    for (const r of regressions) {
      lines.push(
        `- **${r.platform}/${r.server}** ${r.scenario}: ${r.changePct.toFixed(1)}%`,
      );
    }
  } else {
    lines.push("### ✅ No regressions detected");
  }

  return lines.join("\n");
}

// ─── Main ────────────────────────────────────────────────────

async function main(): Promise<void> {
  const baselinePath = resolve(process.argv[2] ?? "baseline.json");
  const resultsPath = resolve(process.argv[3] ?? "results/latest.json");
  const outputPath = process.argv[4] ? resolve(process.argv[4]) : undefined;

  // Load baseline — if missing, skip comparison (no regression possible)
  let baseline: ReadonlyArray<BenchmarkResult>;
  try {
    baseline = await loadResults(baselinePath);
  } catch {
    const msg =
      "## Benchmark Results vs Baseline\n\nNo baseline found — skipping regression check.\n\n### ✅ No regressions detected";
    console.log(msg);
    if (outputPath) {
      await writeFile(outputPath, msg + "\n");
    }
    return;
  }

  // Load current results — must exist
  let current: ReadonlyArray<BenchmarkResult>;
  try {
    current = await loadResults(resultsPath);
  } catch {
    console.error(`No current results found at ${resultsPath}`);
    process.exit(1);
  }

  const comparisons = buildComparisons(baseline, current);
  const markdown = formatMarkdown(comparisons);

  console.log(markdown);

  if (outputPath) {
    await writeFile(outputPath, markdown + "\n");
  }

  const regressions = comparisons.filter((c) => c.regressed);
  if (regressions.length > 0) {
    process.exit(1);
  }
}

void main();
