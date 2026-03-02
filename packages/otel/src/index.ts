// @typokit/otel — Structured Logger & Observability

export { StructuredLogger } from "./logger.js";
export { redactFields } from "./redact.js";
export {
  Tracer,
  Span,
  ConsoleSpanExporter,
  OtlpSpanExporter,
  NoopSpanExporter,
  createRequestTracer,
  resolveTracingConfig,
  createExporter,
  generateTraceId,
  generateSpanId,
} from "./tracing.js";
export type {
  LogLevel,
  LogEntry,
  LoggingConfig,
  LogSink,
  LogMetadata,
  SpanData,
  SpanStatus,
  SpanExporter,
  TracingConfig,
  TelemetryConfig,
} from "./types.js";

