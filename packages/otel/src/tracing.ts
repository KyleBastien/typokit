import type { SpanData, SpanStatus, SpanExporter, TracingConfig, TelemetryConfig } from "./types.js";

// ─── ID Generation ───────────────────────────────────────────

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  const cryptoObj = (globalThis as unknown as { crypto?: { getRandomValues(a: Uint8Array): Uint8Array } }).crypto;
  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(arr);
  } else {
    for (let i = 0; i < bytes; i++) {
      arr[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Generate a 32-char hex trace ID */
export function generateTraceId(): string {
  return randomHex(16);
}

/** Generate a 16-char hex span ID */
export function generateSpanId(): string {
  return randomHex(8);
}

// ─── Console Span Exporter ───────────────────────────────────

/** Exports spans to stdout as structured JSON (dev mode) */
export class ConsoleSpanExporter implements SpanExporter {
  export(spans: SpanData[]): void {
    const proc = (globalThis as unknown as { process?: { stdout?: { write(s: string): void } } }).process;
    for (const span of spans) {
      const output = JSON.stringify({ type: "span", ...span });
      if (proc?.stdout?.write) {
        proc.stdout.write(output + "\n");
      }
    }
  }
}

/** No-op exporter that silently discards spans */
export class NoopSpanExporter implements SpanExporter {
  export(_spans: SpanData[]): void {
    // intentionally empty
  }
}

/** Exports spans to an OTLP-compatible HTTP endpoint */
export class OtlpSpanExporter implements SpanExporter {
  private readonly endpoint: string;

  constructor(endpoint?: string) {
    this.endpoint = endpoint ?? "http://localhost:4318/v1/traces";
  }

  export(spans: SpanData[]): void {
    // Best-effort fire-and-forget POST to OTLP endpoint
    const fetchFn = (globalThis as unknown as { fetch?: (url: string, init: unknown) => Promise<unknown> }).fetch;
    if (fetchFn) {
      const payload = {
        resourceSpans: [{
          resource: { attributes: [] },
          scopeSpans: [{
            scope: { name: "@typokit/otel" },
            spans: spans.map((s) => ({
              traceId: s.traceId,
              spanId: s.spanId,
              parentSpanId: s.parentSpanId,
              name: s.name,
              kind: s.kind === "server" ? 2 : 1,
              startTimeUnixNano: new Date(s.startTime).getTime() * 1_000_000,
              endTimeUnixNano: s.endTime ? new Date(s.endTime).getTime() * 1_000_000 : undefined,
              status: { code: s.status === "ok" ? 1 : s.status === "error" ? 2 : 0 },
              attributes: Object.entries(s.attributes).map(([key, value]) => ({
                key,
                value: typeof value === "string" ? { stringValue: value }
                  : typeof value === "number" ? { intValue: value }
                  : { boolValue: value },
              })),
            })),
          }],
        }],
      };

      fetchFn(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => {
        // Silently ignore export failures
      });
    }
  }
}

// ─── Span ────────────────────────────────────────────────────

/** A mutable span representing one phase of request processing */
export class Span {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly kind: "server" | "internal";
  readonly startTime: string;
  readonly attributes: Record<string, string | number | boolean>;
  private _endTime?: string;
  private _durationMs?: number;
  private _status: SpanStatus = "unset";

  constructor(options: {
    traceId: string;
    spanId?: string;
    parentSpanId?: string;
    name: string;
    kind: "server" | "internal";
    attributes?: Record<string, string | number | boolean>;
  }) {
    this.traceId = options.traceId;
    this.spanId = options.spanId ?? generateSpanId();
    this.parentSpanId = options.parentSpanId;
    this.name = options.name;
    this.kind = options.kind;
    this.startTime = new Date().toISOString();
    this.attributes = { ...options.attributes };
  }

  /** Set a key-value attribute on the span */
  setAttribute(key: string, value: string | number | boolean): void {
    this.attributes[key] = value;
  }

  /** Mark the span as successful and end it */
  setOk(): void {
    this._status = "ok";
  }

  /** Mark the span as errored with an optional message */
  setError(message?: string): void {
    this._status = "error";
    if (message) {
      this.attributes["error.message"] = message;
    }
  }

  /** End the span and record its duration */
  end(): void {
    this._endTime = new Date().toISOString();
    this._durationMs = new Date(this._endTime).getTime() - new Date(this.startTime).getTime();
  }

  /** Whether this span has been ended */
  get ended(): boolean {
    return this._endTime !== undefined;
  }

  get status(): SpanStatus {
    return this._status;
  }

  /** Convert to a plain data object for export */
  toData(): SpanData {
    return {
      traceId: this.traceId,
      spanId: this.spanId,
      ...(this.parentSpanId !== undefined ? { parentSpanId: this.parentSpanId } : {}),
      name: this.name,
      kind: this.kind,
      startTime: this.startTime,
      ...(this._endTime !== undefined ? { endTime: this._endTime } : {}),
      ...(this._durationMs !== undefined ? { durationMs: this._durationMs } : {}),
      status: this._status,
      attributes: { ...this.attributes },
    };
  }
}

// ─── Tracer ──────────────────────────────────────────────────

/** Resolves a TelemetryConfig into a normalized TracingConfig */
export function resolveTracingConfig(telemetry?: TelemetryConfig): TracingConfig {
  if (!telemetry) {
    return { enabled: true, exporter: "console" };
  }

  if (typeof telemetry.tracing === "boolean") {
    return {
      enabled: telemetry.tracing,
      exporter: telemetry.exporter ?? "console",
      endpoint: telemetry.endpoint,
      serviceName: telemetry.serviceName,
    };
  }

  if (typeof telemetry.tracing === "object") {
    return {
      enabled: telemetry.tracing.enabled ?? true,
      exporter: telemetry.tracing.exporter ?? telemetry.exporter ?? "console",
      endpoint: telemetry.tracing.endpoint ?? telemetry.endpoint,
      serviceName: telemetry.tracing.serviceName ?? telemetry.serviceName,
    };
  }

  return {
    enabled: true,
    exporter: telemetry.exporter ?? "console",
    endpoint: telemetry.endpoint,
    serviceName: telemetry.serviceName,
  };
}

/** Creates the appropriate SpanExporter from config */
export function createExporter(config: TracingConfig): SpanExporter {
  if (!config.enabled) {
    return new NoopSpanExporter();
  }
  if (config.exporter === "otlp") {
    return new OtlpSpanExporter(config.endpoint);
  }
  return new ConsoleSpanExporter();
}

/**
 * Tracer creates and manages spans for a single request trace.
 * Each request gets its own Tracer instance with a unique traceId.
 */
export class Tracer {
  readonly traceId: string;
  private readonly spans: Span[] = [];
  private readonly exporter: SpanExporter;
  private readonly serviceName: string;
  private readonly enabled: boolean;
  private rootSpan?: Span;

  constructor(options?: {
    traceId?: string;
    exporter?: SpanExporter;
    serviceName?: string;
    enabled?: boolean;
  }) {
    this.traceId = options?.traceId ?? generateTraceId();
    this.exporter = options?.exporter ?? new NoopSpanExporter();
    this.serviceName = options?.serviceName ?? "typokit";
    this.enabled = options?.enabled ?? true;
  }

  /** Start a root span for the incoming request */
  startRootSpan(name: string, attributes?: Record<string, string | number | boolean>): Span {
    const span = new Span({
      traceId: this.traceId,
      name,
      kind: "server",
      attributes: {
        "service.name": this.serviceName,
        ...attributes,
      },
    });
    this.rootSpan = span;
    this.spans.push(span);
    return span;
  }

  /** Start a child span under the root (or specified parent) */
  startSpan(name: string, options?: {
    parentSpanId?: string;
    attributes?: Record<string, string | number | boolean>;
  }): Span {
    if (!this.enabled) {
      // Return a no-op span that won't be exported
      return new Span({
        traceId: this.traceId,
        name,
        kind: "internal",
      });
    }

    const parentId = options?.parentSpanId ?? this.rootSpan?.spanId;
    const span = new Span({
      traceId: this.traceId,
      parentSpanId: parentId,
      name,
      kind: "internal",
      attributes: options?.attributes,
    });
    this.spans.push(span);
    return span;
  }

  /** End all open spans and export them */
  flush(): void {
    // End any spans that haven't been ended
    for (const span of this.spans) {
      if (!span.ended) {
        span.end();
      }
    }

    if (this.enabled && this.spans.length > 0) {
      this.exporter.export(this.spans.map((s) => s.toData()));
    }
  }

  /** Get all collected spans as data objects */
  getSpans(): SpanData[] {
    return this.spans.map((s) => s.toData());
  }

  /** Get the root span if one was started */
  getRootSpan(): Span | undefined {
    return this.rootSpan;
  }
}

/**
 * Creates a Tracer for an incoming request, configured from TelemetryConfig.
 * This is the main entry point for request-level tracing.
 */
export function createRequestTracer(
  telemetry?: TelemetryConfig,
  exporterOverride?: SpanExporter,
): Tracer {
  const config = resolveTracingConfig(telemetry);
  const exporter = exporterOverride ?? createExporter(config);

  return new Tracer({
    exporter,
    serviceName: config.serviceName,
    enabled: config.enabled,
  });
}
