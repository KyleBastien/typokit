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
export {
  MetricsCollector,
  ConsoleMetricExporter,
  OtlpMetricExporter,
  NoopMetricExporter,
  resolveMetricsConfig,
  createMetricExporter,
  createMetricsCollector,
} from "./metrics.js";
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
  MetricsConfig,
  MetricLabels,
  MetricData,
  MetricExporter,
  HistogramDataPoint,
  GaugeDataPoint,
  CounterDataPoint,
} from "./types.js";

