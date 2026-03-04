import type {
  MetricsConfig,
  MetricLabels,
  MetricData,
  MetricExporter,
  HistogramDataPoint,
  GaugeDataPoint,
  CounterDataPoint,
  TelemetryConfig,
} from "./types.js";

// ─── Metric Exporters ────────────────────────────────────────

/** Exports metrics to stdout as structured JSON (dev mode) */
export class ConsoleMetricExporter implements MetricExporter {
  export(metrics: MetricData[]): void {
    const proc = (globalThis as unknown as { process?: { stdout?: { write(s: string): void } } }).process;
    for (const metric of metrics) {
      const output = JSON.stringify({ ...metric, exportKind: "metric" });
      if (proc?.stdout?.write) {
        proc.stdout.write(output + "\n");
      }
    }
  }
}

/** No-op exporter that silently discards metrics */
export class NoopMetricExporter implements MetricExporter {
  export(_metrics: MetricData[]): void {
    // intentionally empty
  }
}

/** Exports metrics to an OTLP-compatible HTTP endpoint */
export class OtlpMetricExporter implements MetricExporter {
  private readonly endpoint: string;

  constructor(endpoint?: string) {
    this.endpoint = endpoint ?? "http://localhost:4318/v1/metrics";
  }

  export(metrics: MetricData[]): void {
    const fetchFn = (globalThis as unknown as { fetch?: (url: string, init: unknown) => Promise<unknown> }).fetch;
    if (fetchFn) {
      const payload = {
        resourceMetrics: [{
          resource: { attributes: [] },
          scopeMetrics: [{
            scope: { name: "@typokit/otel" },
            metrics: metrics.map((m) => ({
              name: m.name,
              ...(m.type === "histogram" ? {
                histogram: {
                  dataPoints: m.dataPoints.map((dp) => ({
                    attributes: labelsToAttributes(dp.labels as MetricLabels),
                    startTimeUnixNano: new Date(dp.timestamp).getTime() * 1_000_000,
                    timeUnixNano: new Date(dp.timestamp).getTime() * 1_000_000,
                    sum: dp.value,
                    count: 1,
                  })),
                },
              } : m.type === "gauge" ? {
                gauge: {
                  dataPoints: m.dataPoints.map((dp) => ({
                    attributes: labelsToAttributes(dp.labels as Partial<MetricLabels>),
                    timeUnixNano: new Date(dp.timestamp).getTime() * 1_000_000,
                    asInt: dp.value,
                  })),
                },
              } : {
                sum: {
                  dataPoints: m.dataPoints.map((dp) => ({
                    attributes: labelsToAttributes(dp.labels as MetricLabels),
                    startTimeUnixNano: new Date(dp.timestamp).getTime() * 1_000_000,
                    timeUnixNano: new Date(dp.timestamp).getTime() * 1_000_000,
                    asInt: dp.value,
                  })),
                  isMonotonic: true,
                },
              }),
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

function labelsToAttributes(labels: Partial<MetricLabels>): Array<{ key: string; value: { stringValue?: string; intValue?: number } }> {
  const attrs: Array<{ key: string; value: { stringValue?: string; intValue?: number } }> = [];
  if (labels.route !== undefined) {
    attrs.push({ key: "http.route", value: { stringValue: labels.route } });
  }
  if (labels.method !== undefined) {
    attrs.push({ key: "http.method", value: { stringValue: labels.method } });
  }
  if (labels.status !== undefined) {
    attrs.push({ key: "http.status_code", value: { intValue: labels.status } });
  }
  return attrs;
}

// ─── Metrics Collector ───────────────────────────────────────

/**
 * MetricsCollector records and stores request metrics.
 * It manages three metric instruments:
 * - http.server.request.duration (histogram) — request latency in ms
 * - http.server.active_requests (gauge) — currently in-flight requests
 * - http.server.error_count (counter) — error responses (status >= 400)
 */
export class MetricsCollector {
  private readonly enabled: boolean;
  private readonly exporter: MetricExporter;
  private readonly serviceName: string;

  private readonly durations: HistogramDataPoint[] = [];
  private readonly errors: CounterDataPoint[] = [];
  private activeRequests = 0;
  private readonly activeGaugeSnapshots: GaugeDataPoint[] = [];

  constructor(options?: {
    enabled?: boolean;
    exporter?: MetricExporter;
    serviceName?: string;
  }) {
    this.enabled = options?.enabled ?? true;
    this.exporter = options?.exporter ?? new NoopMetricExporter();
    this.serviceName = options?.serviceName ?? "typokit";
  }

  /** Record the start of a request (increments active_requests gauge) */
  requestStart(): void {
    if (!this.enabled) return;
    this.activeRequests++;
  }

  /** Record the end of a request with its duration and labels */
  requestEnd(labels: MetricLabels, durationMs: number): void {
    if (!this.enabled) return;

    this.activeRequests = Math.max(0, this.activeRequests - 1);

    const timestamp = new Date().toISOString();

    // Record duration histogram data point
    this.durations.push({
      labels,
      value: durationMs,
      timestamp,
    });

    // Record active requests gauge snapshot
    this.activeGaugeSnapshots.push({
      labels: {},
      value: this.activeRequests,
      timestamp,
    });

    // Record error counter if status >= 400
    if (labels.status >= 400) {
      this.errors.push({
        labels,
        value: 1,
        timestamp,
      });
    }
  }

  /** Get current active request count */
  getActiveRequests(): number {
    return this.activeRequests;
  }

  /** Get the service name */
  getServiceName(): string {
    return this.serviceName;
  }

  /** Get all recorded duration data points */
  getDurations(): HistogramDataPoint[] {
    return [...this.durations];
  }

  /** Get all recorded error counter data points */
  getErrors(): CounterDataPoint[] {
    return [...this.errors];
  }

  /** Flush all collected metrics to the exporter */
  flush(): void {
    if (!this.enabled) return;

    const metrics: MetricData[] = [];

    if (this.durations.length > 0) {
      metrics.push({
        name: "http.server.request.duration",
        type: "histogram",
        dataPoints: [...this.durations],
      });
    }

    if (this.activeGaugeSnapshots.length > 0) {
      metrics.push({
        name: "http.server.active_requests",
        type: "gauge",
        dataPoints: [...this.activeGaugeSnapshots],
      });
    }

    if (this.errors.length > 0) {
      metrics.push({
        name: "http.server.error_count",
        type: "counter",
        dataPoints: [...this.errors],
      });
    }

    if (metrics.length > 0) {
      this.exporter.export(metrics);
    }
  }

  /** Reset all collected metrics */
  reset(): void {
    this.durations.length = 0;
    this.errors.length = 0;
    this.activeGaugeSnapshots.length = 0;
    this.activeRequests = 0;
  }
}

// ─── Config Resolution ───────────────────────────────────────

/** Resolves a TelemetryConfig into a normalized MetricsConfig */
export function resolveMetricsConfig(telemetry?: TelemetryConfig): MetricsConfig {
  if (!telemetry) {
    return { enabled: true, exporter: "console" };
  }

  if (typeof telemetry.metrics === "boolean") {
    return {
      enabled: telemetry.metrics,
      exporter: telemetry.exporter ?? "console",
      endpoint: telemetry.endpoint,
      serviceName: telemetry.serviceName,
    };
  }

  if (typeof telemetry.metrics === "object") {
    return {
      enabled: telemetry.metrics.enabled ?? true,
      exporter: telemetry.metrics.exporter ?? telemetry.exporter ?? "console",
      endpoint: telemetry.metrics.endpoint ?? telemetry.endpoint,
      serviceName: telemetry.metrics.serviceName ?? telemetry.serviceName,
    };
  }

  return {
    enabled: true,
    exporter: telemetry.exporter ?? "console",
    endpoint: telemetry.endpoint,
    serviceName: telemetry.serviceName,
  };
}

/** Creates the appropriate MetricExporter from config */
export function createMetricExporter(config: MetricsConfig): MetricExporter {
  if (!config.enabled) {
    return new NoopMetricExporter();
  }
  if (config.exporter === "otlp") {
    return new OtlpMetricExporter(config.endpoint);
  }
  return new ConsoleMetricExporter();
}

/**
 * Creates a MetricsCollector configured from TelemetryConfig.
 * This is the main entry point for request-level metrics.
 */
export function createMetricsCollector(
  telemetry?: TelemetryConfig,
  exporterOverride?: MetricExporter,
): MetricsCollector {
  const config = resolveMetricsConfig(telemetry);
  const exporter = exporterOverride ?? createMetricExporter(config);

  return new MetricsCollector({
    exporter,
    serviceName: config.serviceName,
    enabled: config.enabled,
  });
}
