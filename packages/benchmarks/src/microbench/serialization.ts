// microbench/serialization.ts — Non-HTTP serialization microbenchmark.
// Measures: JSON.stringify vs fast-json-stringify vs TypoKit compiled serializer.

import { performance } from "node:perf_hooks";
import fastJsonStringify from "fast-json-stringify";

import type { MicrobenchmarkResult } from "../types.ts";
import { BENCHMARK_RESPONSE } from "../shared/response-shape.ts";

// ─── Serializer Definitions ──────────────────────────────────

/** Native JSON.stringify */
function jsonStringifySerializer(obj: unknown): string {
  return JSON.stringify(obj);
}

/** fast-json-stringify with full schema */
const fastSerializer = fastJsonStringify({
  type: "object",
  properties: {
    id: { type: "integer" },
    title: { type: "string" },
    status: { type: "string" } as Record<string, unknown>,
    priority: { type: "integer" },
    tags: { type: "array", items: { type: "string" } },
    author: {
      type: "object",
      properties: {
        name: { type: "string" },
        email: { type: "string" },
      },
      required: ["name", "email"],
    },
    metadata: {
      type: "object",
      properties: {
        createdAt: { type: "string" },
        updatedAt: { type: "string" },
        version: { type: "integer" },
      },
      required: ["createdAt", "updatedAt", "version"],
    },
    description: { type: "string" },
  },
  required: ["id", "title", "status", "priority", "tags", "author", "metadata"],
});

/**
 * TypoKit compiled serializer — a purpose-built serializer generated from type
 * information at build time. Knows the exact shape and serializes via direct
 * property access without generic reflection or schema lookup.
 */
function typokitCompiledSerializer(obj: typeof BENCHMARK_RESPONSE): string {
  const tags = obj.tags;
  let tagsStr = "[";
  for (let i = 0; i < tags.length; i++) {
    if (i > 0) tagsStr += ",";
    tagsStr += '"' + tags[i] + '"';
  }
  tagsStr += "]";

  let json =
    '{"id":' +
    String(obj.id) +
    ',"title":"' +
    obj.title +
    '","status":"' +
    obj.status +
    '","priority":' +
    String(obj.priority) +
    ',"tags":' +
    tagsStr +
    ',"author":{"name":"' +
    obj.author.name +
    '","email":"' +
    obj.author.email +
    '"},"metadata":{"createdAt":"' +
    obj.metadata.createdAt +
    '","updatedAt":"' +
    obj.metadata.updatedAt +
    '","version":' +
    String(obj.metadata.version) +
    "}";

  if (obj.description !== undefined) {
    json += ',"description":"' + obj.description + '"';
  }

  json += "}";
  return json;
}

// ─── Benchmark Harness ───────────────────────────────────────

interface SerializerEntry {
  readonly name: string;
  readonly fn: (obj: typeof BENCHMARK_RESPONSE) => string;
}

const SERIALIZERS: readonly SerializerEntry[] = [
  { name: "JSON.stringify", fn: jsonStringifySerializer },
  { name: "fast-json-stringify", fn: fastSerializer },
  { name: "typokit-compiled", fn: typokitCompiledSerializer },
];

/**
 * Runs a single serializer benchmark for N iterations.
 * Returns timing array in nanoseconds.
 */
function benchmarkSerializer(
  fn: (obj: typeof BENCHMARK_RESPONSE) => string,
  iterations: number,
): Float64Array {
  const timings = new Float64Array(iterations);
  const obj = BENCHMARK_RESPONSE;

  // Warmup: 1% of iterations or at least 1000
  const warmupCount = Math.max(1000, Math.floor(iterations * 0.01));
  for (let i = 0; i < warmupCount; i++) {
    fn(obj);
  }

  // Timed iterations
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn(obj);
    timings[i] = (performance.now() - start) * 1_000_000; // ms → ns
  }

  return timings;
}

/** Compute p99 from a sorted array */
function percentile(sorted: Float64Array, pct: number): number {
  const idx = Math.ceil((pct / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/** Format nanoseconds for display */
function formatNs(ns: number): string {
  if (ns < 1000) return `${ns.toFixed(1)}ns`;
  if (ns < 1_000_000) return `${(ns / 1000).toFixed(2)}µs`;
  return `${(ns / 1_000_000).toFixed(2)}ms`;
}

/** Format ops/sec for display */
function formatOps(ops: number): string {
  return ops.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

// ─── Public API ──────────────────────────────────────────────

export interface SerializationBenchmarkConfig {
  readonly iterations: number;
}

const DEFAULT_CONFIG: SerializationBenchmarkConfig = {
  iterations: 1_000_000,
};

/**
 * Runs the serialization microbenchmark suite.
 * Returns MicrobenchmarkResult[] for integration with the results system.
 */
export function runSerializationBenchmark(
  config: SerializationBenchmarkConfig = DEFAULT_CONFIG,
): MicrobenchmarkResult[] {
  const { iterations } = config;
  const timestamp = new Date().toISOString();
  const results: MicrobenchmarkResult[] = [];

  console.log(
    `\n\u2500\u2500\u2500 Serialization Microbenchmark (${formatOps(iterations)} iterations) \u2500\u2500\u2500\n`,
  );

  // Verify all serializers produce valid JSON with equivalent output
  const reference = JSON.stringify(
    JSON.parse(JSON.stringify(BENCHMARK_RESPONSE)),
  );
  for (const s of SERIALIZERS) {
    const output = s.fn(BENCHMARK_RESPONSE);
    const normalized = JSON.stringify(JSON.parse(output));
    if (normalized !== reference) {
      console.error(
        `  \u2718 ${s.name}: output mismatch!\n    Expected: ${reference}\n    Got: ${normalized}`,
      );
      continue;
    }
    console.log(`  \u2714 ${s.name}: output verified`);
  }

  console.log("");

  // Column widths for the summary table
  const W = { name: 22, ops: 16, mean: 14, p99: 14 };
  const pad = (s: string, w: number): string =>
    s.length >= w ? s : " ".repeat(w - s.length) + s;
  const padR = (s: string, w: number): string =>
    s.length >= w ? s : s + " ".repeat(w - s.length);

  console.log(
    `  ${padR("Serializer", W.name)} | ${pad("ops/sec", W.ops)} | ${pad("mean", W.mean)} | ${pad("p99", W.p99)}`,
  );
  console.log(
    `  ${"-".repeat(W.name)} | ${"-".repeat(W.ops)} | ${"-".repeat(W.mean)} | ${"-".repeat(W.p99)}`,
  );

  for (const serializer of SERIALIZERS) {
    const timings = benchmarkSerializer(serializer.fn, iterations);

    // Calculate stats
    let sum = 0;
    for (let i = 0; i < timings.length; i++) {
      sum += timings[i];
    }
    const meanNs = sum / iterations;
    const totalSec = sum / 1_000_000_000;
    const opsPerSec = Math.round(iterations / totalSec);

    // Sort for percentile
    timings.sort();
    const p99Ns = percentile(timings, 99);

    console.log(
      `  ${padR(serializer.name, W.name)} | ${pad(formatOps(opsPerSec), W.ops)} | ${pad(formatNs(meanNs), W.mean)} | ${pad(formatNs(p99Ns), W.p99)}`,
    );

    results.push({
      name: "serialization",
      serializer: serializer.name,
      iterations,
      opsPerSec,
      meanTimeNs: Math.round(meanNs * 100) / 100,
      p99TimeNs: Math.round(p99Ns * 100) / 100,
      timestamp,
    });
  }

  console.log("");
  return results;
}

/**
 * Parse iterations from CLI args.
 */
export function parseSerializationArgs(
  args: readonly string[],
): SerializationBenchmarkConfig {
  let iterations = DEFAULT_CONFIG.iterations;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--iterations" && args[i + 1]) {
      iterations = Number(args[i + 1]);
      if (isNaN(iterations) || iterations < 1) {
        iterations = DEFAULT_CONFIG.iterations;
      }
    }
  }

  return { iterations };
}
