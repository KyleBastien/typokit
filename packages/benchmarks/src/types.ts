/** Latency percentile breakdown in milliseconds */
export interface LatencyPercentiles {
  readonly p50: number;
  readonly p75: number;
  readonly p90: number;
  readonly p95: number;
  readonly p99: number;
}

/** Runtime version information */
export interface RuntimeVersions {
  readonly node?: string;
  readonly bun?: string;
  readonly deno?: string;
  readonly rustc?: string;
}

/** System information for benchmark reproducibility */
export interface SystemInfo {
  readonly os: string;
  readonly cpu: string;
  readonly cpuCores: number;
  readonly ram: string;
  readonly runtimeVersions: RuntimeVersions;
  readonly bombardierVersion?: string;
}

/** Configuration for a benchmark run */
export interface BenchmarkConfig {
  readonly connections: number;
  readonly duration: string;
  readonly warmup: string;
  readonly runs: number;
}

/** Result of a single benchmark run */
export interface BenchmarkResult {
  readonly framework: string;
  readonly platform: string;
  readonly server: string;
  readonly scenario: string;
  readonly reqPerSec: number;
  readonly latency: LatencyPercentiles;
  readonly errors: number;
  readonly timestamp: string;
  readonly systemInfo: SystemInfo;
  readonly config: BenchmarkConfig;
}

/** Result of a single microbenchmark (non-HTTP, in-process) */
export interface MicrobenchmarkResult {
  readonly name: string;
  readonly serializer: string;
  readonly iterations: number;
  readonly opsPerSec: number;
  readonly meanTimeNs: number;
  readonly p99TimeNs: number;
  readonly timestamp: string;
}

/** Validation overhead analysis entry computed from validate/passthrough/handwritten scenarios */
export interface ValidationAnalysisEntry {
  readonly framework: string;
  readonly platform: string;
  readonly server: string;
  readonly passthroughReqPerSec: number;
  readonly handwrittenReqPerSec: number;
  readonly typokitReqPerSec: number;
  /** % overhead of TypoKit validation vs passthrough (negative = slower) */
  readonly vsPassthroughPct: number;
  /** % difference of TypoKit validation vs handwritten (negative = slower) */
  readonly vsHandwrittenPct: number;
}
