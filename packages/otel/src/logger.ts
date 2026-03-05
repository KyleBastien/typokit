import type { Logger } from "@typokit/types";
import type {
  LogLevel,
  LogEntry,
  LoggingConfig,
  LogMetadata,
  LogSink,
} from "./types.js";
import { LOG_LEVELS } from "./types.js";
import { redactFields } from "./redact.js";

/** Default sink: writes structured JSON to stdout */
export class StdoutSink implements LogSink {
  write(entry: LogEntry): void {
    const output = JSON.stringify(entry);
    // Use globalThis to avoid @types/node dependency
    const proc = (
      globalThis as unknown as {
        process?: { stdout?: { write(s: string): void } };
      }
    ).process;
    if (proc?.stdout?.write) {
      proc.stdout.write(output + "\n");
    }
  }
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  fatal: 5,
};

function isProduction(): boolean {
  const proc = (
    globalThis as unknown as {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process;
  return proc?.env?.["NODE_ENV"] === "production";
}

/**
 * StructuredLogger implements the Logger interface from @typokit/types.
 * Automatically enriches log entries with request metadata and supports
 * field redaction and configurable log levels.
 */
export class StructuredLogger implements Logger {
  private readonly minLevel: number;
  private readonly redactPatterns: string[];
  private readonly metadata: LogMetadata;
  private readonly sinks: LogSink[];

  constructor(
    config?: LoggingConfig,
    metadata?: LogMetadata,
    sinks?: LogSink[],
  ) {
    const defaultLevel: LogLevel = isProduction() ? "info" : "debug";
    this.minLevel = LEVEL_PRIORITY[config?.level ?? defaultLevel];
    this.redactPatterns = config?.redact ?? [];
    this.metadata = metadata ?? {};
    this.sinks = sinks ?? [new StdoutSink()];
  }

  trace(message: string, data?: Record<string, unknown>): void {
    this.log("trace", message, data);
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log("debug", message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log("info", message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log("warn", message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.log("error", message, data);
  }

  fatal(message: string, data?: Record<string, unknown>): void {
    this.log("fatal", message, data);
  }

  /** Create a child logger with additional/overridden metadata */
  child(metadata: Partial<LogMetadata>): StructuredLogger {
    return new StructuredLogger(
      {
        level: LOG_LEVELS[this.minLevel],
        redact: this.redactPatterns,
      },
      { ...this.metadata, ...metadata },
      this.sinks,
    );
  }

  private log(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    if (LEVEL_PRIORITY[level] < this.minLevel) return;

    const redactedData =
      data && this.redactPatterns.length > 0
        ? redactFields(data, this.redactPatterns)
        : data;

    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...(redactedData !== undefined ? { data: redactedData } : {}),
      ...(this.metadata.traceId !== undefined
        ? { traceId: this.metadata.traceId }
        : {}),
      ...(this.metadata.route !== undefined
        ? { route: this.metadata.route }
        : {}),
      ...(this.metadata.phase !== undefined
        ? { phase: this.metadata.phase }
        : {}),
      ...(this.metadata.requestId !== undefined
        ? { requestId: this.metadata.requestId }
        : {}),
      ...(this.metadata.serverAdapter !== undefined
        ? { serverAdapter: this.metadata.serverAdapter }
        : {}),
    };

    for (const sink of this.sinks) {
      sink.write(entry);
    }
  }
}
