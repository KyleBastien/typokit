// Log levels ordered by severity
export const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

/** Metadata automatically attached to every log entry */
export interface LogMetadata {
  traceId?: string;
  route?: string;
  phase?: string;
  requestId?: string;
  serverAdapter?: string;
}

/** A single structured log entry */
export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  data?: Record<string, unknown>;
  traceId?: string;
  route?: string;
  phase?: string;
  requestId?: string;
  serverAdapter?: string;
}

/** Configuration for the logging system */
export interface LoggingConfig {
  /** Minimum log level (default: "info" in production, "debug" in development) */
  level?: LogLevel;
  /** Glob-style paths to redact from log output (e.g., "*.password", "authorization") */
  redact?: string[];
}

/** A sink that receives structured log entries */
export interface LogSink {
  write(entry: LogEntry): void;
}

// ─── Tracing Types ───────────────────────────────────────────

/** Status of a span */
export type SpanStatus = "ok" | "error" | "unset";

/** A single span representing a phase of request processing */
export interface SpanData {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: "server" | "internal";
  startTime: string;
  endTime?: string;
  durationMs?: number;
  status: SpanStatus;
  attributes: Record<string, string | number | boolean>;
}

/** Configuration for the tracing system */
export interface TracingConfig {
  /** Enable tracing (default: true in dev) */
  enabled?: boolean;
  /** Exporter type: 'console' for dev, 'otlp' for collectors */
  exporter?: "console" | "otlp";
  /** OTel Collector endpoint (default: http://localhost:4318) */
  endpoint?: string;
  /** Service name for OTel resource */
  serviceName?: string;
}

/** Full telemetry configuration for createApp() */
export interface TelemetryConfig {
  tracing?: boolean | TracingConfig;
  metrics?: boolean | MetricsConfig;
  exporter?: "console" | "otlp";
  endpoint?: string;
  serviceName?: string;
}

/** Interface for exporting completed spans */
export interface SpanExporter {
  export(spans: SpanData[]): void;
}

// ─── Metrics Types ───────────────────────────────────────────

/** Configuration for the metrics system */
export interface MetricsConfig {
  /** Enable metrics collection (default: true) */
  enabled?: boolean;
  /** Exporter type: 'console' for dev, 'otlp' for collectors */
  exporter?: "console" | "otlp";
  /** OTel Collector endpoint (default: http://localhost:4318) */
  endpoint?: string;
  /** Service name for OTel resource */
  serviceName?: string;
}

/** Labels applied to all request metrics */
export interface MetricLabels {
  route: string;
  method: string;
  status: number;
}

/** A single histogram data point */
export interface HistogramDataPoint {
  labels: MetricLabels;
  value: number;
  timestamp: string;
}

/** A single gauge data point */
export interface GaugeDataPoint {
  labels: Partial<MetricLabels>;
  value: number;
  timestamp: string;
}

/** A single counter data point */
export interface CounterDataPoint {
  labels: MetricLabels;
  value: number;
  timestamp: string;
}

/** Collected metric data for export */
export interface MetricData {
  name: string;
  type: "histogram" | "gauge" | "counter";
  dataPoints: (HistogramDataPoint | GaugeDataPoint | CounterDataPoint)[];
}

/** Interface for exporting collected metrics */
export interface MetricExporter {
  export(metrics: MetricData[]): void;
}
