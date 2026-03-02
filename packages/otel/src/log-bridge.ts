import type { LogEntry, LogSink, TelemetryConfig } from "./types.js";
import { resolveTracingConfig } from "./tracing.js";

// OTel severity numbers per spec (https://opentelemetry.io/docs/specs/otel/logs/data-model/#severity-fields)
const SEVERITY_NUMBER: Record<string, number> = {
  trace: 1,
  debug: 5,
  info: 9,
  warn: 13,
  error: 17,
  fatal: 21,
};

const SEVERITY_TEXT: Record<string, string> = {
  trace: "TRACE",
  debug: "DEBUG",
  info: "INFO",
  warn: "WARN",
  error: "ERROR",
  fatal: "FATAL",
};

/**
 * OTel log sink that pushes structured log entries to an OTLP-compatible
 * collector via HTTP POST. Includes trace context (traceId, spanId) for
 * correlation with distributed traces.
 */
export class OtelLogSink implements LogSink {
  private readonly endpoint: string;
  private readonly serviceName: string;

  constructor(options?: { endpoint?: string; serviceName?: string }) {
    this.endpoint = options?.endpoint ?? "http://localhost:4318/v1/logs";
    this.serviceName = options?.serviceName ?? "typokit";
  }

  write(entry: LogEntry): void {
    const fetchFn = (globalThis as unknown as { fetch?: (url: string, init: unknown) => Promise<unknown> }).fetch;
    if (!fetchFn) return;

    const timeUnixNano = new Date(entry.timestamp).getTime() * 1_000_000;
    const attributes = this.buildAttributes(entry);

    const logRecord: Record<string, unknown> = {
      timeUnixNano,
      severityNumber: SEVERITY_NUMBER[entry.level] ?? 9,
      severityText: SEVERITY_TEXT[entry.level] ?? "INFO",
      body: { stringValue: entry.message },
      attributes,
    };

    // Include trace context for correlation
    if (entry.traceId) {
      logRecord["traceId"] = entry.traceId;
    }
    if (entry.data?.["spanId"]) {
      logRecord["spanId"] = String(entry.data["spanId"]);
    }

    const payload = {
      resourceLogs: [{
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: this.serviceName } },
          ],
        },
        scopeLogs: [{
          scope: { name: "@typokit/otel" },
          logRecords: [logRecord],
        }],
      }],
    };

    // Fire-and-forget POST to OTLP endpoint
    fetchFn(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {
      // Silently ignore export failures
    });
  }

  private buildAttributes(entry: LogEntry): Array<{ key: string; value: { stringValue: string } }> {
    const attrs: Array<{ key: string; value: { stringValue: string } }> = [];

    if (entry.route) {
      attrs.push({ key: "route", value: { stringValue: entry.route } });
    }
    if (entry.phase) {
      attrs.push({ key: "phase", value: { stringValue: entry.phase } });
    }
    if (entry.requestId) {
      attrs.push({ key: "requestId", value: { stringValue: entry.requestId } });
    }
    if (entry.serverAdapter) {
      attrs.push({ key: "serverAdapter", value: { stringValue: entry.serverAdapter } });
    }

    // Include any extra data fields as attributes
    if (entry.data) {
      for (const [key, val] of Object.entries(entry.data)) {
        if (key === "spanId") continue; // Already used as top-level field
        if (val !== undefined && val !== null) {
          attrs.push({ key: `data.${key}`, value: { stringValue: String(val) } });
        }
      }
    }

    return attrs;
  }
}

/**
 * Creates an OtelLogSink if tracing is configured and enabled.
 * Returns undefined if tracing is not configured (opt-in behavior).
 */
export function createOtelLogSink(telemetry?: TelemetryConfig): OtelLogSink | undefined {
  if (!telemetry) return undefined;

  const tracingConfig = resolveTracingConfig(telemetry);
  if (!tracingConfig.enabled) return undefined;

  const endpoint = tracingConfig.endpoint
    ? tracingConfig.endpoint.replace(/\/v1\/traces\/?$/, "/v1/logs")
    : "http://localhost:4318/v1/logs";

  return new OtelLogSink({
    endpoint,
    serviceName: tracingConfig.serviceName,
  });
}
