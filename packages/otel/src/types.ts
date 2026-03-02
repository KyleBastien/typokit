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
  metrics?: boolean;
  exporter?: "console" | "otlp";
  endpoint?: string;
  serviceName?: string;
}

/** Interface for exporting completed spans */
export interface SpanExporter {
  export(spans: SpanData[]): void;
}
