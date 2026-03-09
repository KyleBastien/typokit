/**
 * Standard JSON response shape used by all benchmark apps.
 * Contains 8+ fields including nested object, array, enum, and optional field.
 */
export interface BenchmarkResponseShape {
  readonly id: number;
  readonly title: string;
  readonly status: "active" | "archived" | "draft";
  readonly priority: number;
  readonly tags: readonly string[];
  readonly author: {
    readonly name: string;
    readonly email: string;
  };
  readonly metadata: {
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly version: number;
  };
  readonly description?: string;
}

/** Static fixture response used by all benchmark endpoints */
export const BENCHMARK_RESPONSE: BenchmarkResponseShape = {
  id: 1,
  title: "Benchmark Test Item",
  status: "active",
  priority: 5,
  tags: ["performance", "benchmark", "test"],
  author: {
    name: "TypoKit Benchmarks",
    email: "bench@typokit.dev",
  },
  metadata: {
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
  },
  description:
    "A standard benchmark test item used across all framework comparisons.",
};

/**
 * Static list response with multiple items for list-endpoint benchmarks.
 */
export const BENCHMARK_LIST_RESPONSE: readonly BenchmarkResponseShape[] = [
  BENCHMARK_RESPONSE,
  {
    id: 2,
    title: "Second Benchmark Item",
    status: "draft",
    priority: 3,
    tags: ["performance"],
    author: {
      name: "TypoKit Benchmarks",
      email: "bench@typokit.dev",
    },
    metadata: {
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      version: 1,
    },
  },
  {
    id: 3,
    title: "Third Benchmark Item",
    status: "archived",
    priority: 1,
    tags: ["legacy", "benchmark"],
    author: {
      name: "TypoKit Benchmarks",
      email: "bench@typokit.dev",
    },
    metadata: {
      createdAt: "2026-01-03T00:00:00.000Z",
      updatedAt: "2026-01-03T00:00:00.000Z",
      version: 2,
    },
    description: "An archived benchmark item for testing.",
  },
];
