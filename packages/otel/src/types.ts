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
