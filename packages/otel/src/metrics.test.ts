import { describe, it, expect } from "@rstest/core";
import {
  MetricsCollector,
  ConsoleMetricExporter,
  NoopMetricExporter,
  OtlpMetricExporter,
  resolveMetricsConfig,
  createMetricExporter,
  createMetricsCollector,
} from "./metrics.js";
import type { MetricData, MetricExporter } from "./types.js";

// ─── Test Helpers ────────────────────────────────────────────

class TestMetricExporter implements MetricExporter {
  readonly exported: MetricData[][] = [];
  export(metrics: MetricData[]): void {
    this.exported.push(metrics);
  }
}

// ─── MetricsCollector Tests ──────────────────────────────────

describe("MetricsCollector", () => {
  it("should record request duration as histogram", () => {
    const exporter = new TestMetricExporter();
    const collector = new MetricsCollector({ exporter });

    collector.requestStart();
    collector.requestEnd({ route: "/users", method: "GET", status: 200 }, 42);
    collector.flush();

    expect(exporter.exported.length).toBe(1);
    const metrics = exporter.exported[0];
    const duration = metrics.find((m) => m.name === "http.server.request.duration");
    expect(duration).toBeDefined();
    expect(duration!.type).toBe("histogram");
    expect(duration!.dataPoints.length).toBe(1);
    expect(duration!.dataPoints[0].value).toBe(42);
    expect(duration!.dataPoints[0].labels).toEqual({ route: "/users", method: "GET", status: 200 });
  });

  it("should track active requests gauge", () => {
    const exporter = new TestMetricExporter();
    const collector = new MetricsCollector({ exporter });

    collector.requestStart();
    collector.requestStart();
    expect(collector.getActiveRequests()).toBe(2);

    collector.requestEnd({ route: "/a", method: "GET", status: 200 }, 10);
    expect(collector.getActiveRequests()).toBe(1);

    collector.requestEnd({ route: "/b", method: "POST", status: 201 }, 20);
    expect(collector.getActiveRequests()).toBe(0);

    collector.flush();

    const metrics = exporter.exported[0];
    const gauge = metrics.find((m) => m.name === "http.server.active_requests");
    expect(gauge).toBeDefined();
    expect(gauge!.type).toBe("gauge");
    expect(gauge!.dataPoints.length).toBe(2);
  });

  it("should count errors for status >= 400", () => {
    const exporter = new TestMetricExporter();
    const collector = new MetricsCollector({ exporter });

    collector.requestStart();
    collector.requestEnd({ route: "/users", method: "GET", status: 200 }, 10);
    collector.requestStart();
    collector.requestEnd({ route: "/users", method: "POST", status: 400 }, 15);
    collector.requestStart();
    collector.requestEnd({ route: "/admin", method: "GET", status: 500 }, 50);
    collector.flush();

    const metrics = exporter.exported[0];
    const errors = metrics.find((m) => m.name === "http.server.error_count");
    expect(errors).toBeDefined();
    expect(errors!.type).toBe("counter");
    expect(errors!.dataPoints.length).toBe(2);
    expect(errors!.dataPoints[0].labels.status).toBe(400);
    expect(errors!.dataPoints[1].labels.status).toBe(500);
  });

  it("should not count 2xx/3xx as errors", () => {
    const exporter = new TestMetricExporter();
    const collector = new MetricsCollector({ exporter });

    collector.requestStart();
    collector.requestEnd({ route: "/ok", method: "GET", status: 200 }, 5);
    collector.requestStart();
    collector.requestEnd({ route: "/redirect", method: "GET", status: 302 }, 3);
    collector.flush();

    const metrics = exporter.exported[0];
    const errors = metrics.find((m) => m.name === "http.server.error_count");
    expect(errors).toBeUndefined();
  });

  it("should apply correct labels to metrics", () => {
    const exporter = new TestMetricExporter();
    const collector = new MetricsCollector({ exporter });

    collector.requestStart();
    collector.requestEnd({ route: "/api/users/:id", method: "PUT", status: 204 }, 30);
    collector.flush();

    const metrics = exporter.exported[0];
    const duration = metrics.find((m) => m.name === "http.server.request.duration")!;
    const dp = duration.dataPoints[0];
    expect(dp.labels).toEqual({ route: "/api/users/:id", method: "PUT", status: 204 });
  });

  it("should not record when disabled", () => {
    const exporter = new TestMetricExporter();
    const collector = new MetricsCollector({ enabled: false, exporter });

    collector.requestStart();
    collector.requestEnd({ route: "/a", method: "GET", status: 200 }, 10);
    collector.flush();

    expect(exporter.exported.length).toBe(0);
    expect(collector.getActiveRequests()).toBe(0);
  });

  it("should support reset", () => {
    const exporter = new TestMetricExporter();
    const collector = new MetricsCollector({ exporter });

    collector.requestStart();
    collector.requestEnd({ route: "/a", method: "GET", status: 200 }, 10);
    collector.reset();

    expect(collector.getActiveRequests()).toBe(0);
    expect(collector.getDurations().length).toBe(0);
    expect(collector.getErrors().length).toBe(0);

    collector.flush();
    expect(exporter.exported.length).toBe(0);
  });

  it("should not export when no metrics recorded", () => {
    const exporter = new TestMetricExporter();
    const collector = new MetricsCollector({ exporter });

    collector.flush();
    expect(exporter.exported.length).toBe(0);
  });

  it("should record multiple requests with different routes", () => {
    const exporter = new TestMetricExporter();
    const collector = new MetricsCollector({ exporter });

    collector.requestStart();
    collector.requestEnd({ route: "/users", method: "GET", status: 200 }, 10);
    collector.requestStart();
    collector.requestEnd({ route: "/posts", method: "GET", status: 200 }, 20);
    collector.requestStart();
    collector.requestEnd({ route: "/users", method: "POST", status: 201 }, 30);
    collector.flush();

    const durations = exporter.exported[0].find((m) => m.name === "http.server.request.duration")!;
    expect(durations.dataPoints.length).toBe(3);
  });

  it("should store service name", () => {
    const collector = new MetricsCollector({ serviceName: "my-service" });
    expect(collector.getServiceName()).toBe("my-service");
  });

  it("should default service name to typokit", () => {
    const collector = new MetricsCollector();
    expect(collector.getServiceName()).toBe("typokit");
  });

  it("should not go below zero active requests", () => {
    const exporter = new TestMetricExporter();
    const collector = new MetricsCollector({ exporter });

    // End without start
    collector.requestEnd({ route: "/a", method: "GET", status: 200 }, 5);
    expect(collector.getActiveRequests()).toBe(0);
  });
});

// ─── Config Resolution Tests ─────────────────────────────────

describe("resolveMetricsConfig", () => {
  it("should return defaults when no config", () => {
    const config = resolveMetricsConfig();
    expect(config.enabled).toBe(true);
    expect(config.exporter).toBe("console");
  });

  it("should handle boolean metrics: true", () => {
    const config = resolveMetricsConfig({ metrics: true });
    expect(config.enabled).toBe(true);
    expect(config.exporter).toBe("console");
  });

  it("should handle boolean metrics: false", () => {
    const config = resolveMetricsConfig({ metrics: false });
    expect(config.enabled).toBe(false);
  });

  it("should handle object metrics config", () => {
    const config = resolveMetricsConfig({
      metrics: { enabled: true, exporter: "otlp", endpoint: "http://custom:4318", serviceName: "test-svc" },
    });
    expect(config.enabled).toBe(true);
    expect(config.exporter).toBe("otlp");
    expect(config.endpoint).toBe("http://custom:4318");
    expect(config.serviceName).toBe("test-svc");
  });

  it("should inherit top-level exporter and serviceName", () => {
    const config = resolveMetricsConfig({
      metrics: true,
      exporter: "otlp",
      serviceName: "top-level",
      endpoint: "http://top:4318",
    });
    expect(config.exporter).toBe("otlp");
    expect(config.serviceName).toBe("top-level");
    expect(config.endpoint).toBe("http://top:4318");
  });

  it("should prefer nested config over top-level", () => {
    const config = resolveMetricsConfig({
      metrics: { exporter: "otlp", serviceName: "nested" },
      exporter: "console",
      serviceName: "top-level",
    });
    expect(config.exporter).toBe("otlp");
    expect(config.serviceName).toBe("nested");
  });

  it("should default to enabled when metrics not specified", () => {
    const config = resolveMetricsConfig({ exporter: "otlp" });
    expect(config.enabled).toBe(true);
    expect(config.exporter).toBe("otlp");
  });
});

// ─── Exporter Factory Tests ──────────────────────────────────

describe("createMetricExporter", () => {
  it("should create NoopMetricExporter when disabled", () => {
    const exporter = createMetricExporter({ enabled: false });
    expect(exporter).toBeInstanceOf(NoopMetricExporter);
  });

  it("should create ConsoleMetricExporter by default", () => {
    const exporter = createMetricExporter({ enabled: true, exporter: "console" });
    expect(exporter).toBeInstanceOf(ConsoleMetricExporter);
  });

  it("should create OtlpMetricExporter for otlp", () => {
    const exporter = createMetricExporter({ enabled: true, exporter: "otlp" });
    expect(exporter).toBeInstanceOf(OtlpMetricExporter);
  });
});

// ─── createMetricsCollector Tests ────────────────────────────

describe("createMetricsCollector", () => {
  it("should create collector from TelemetryConfig", () => {
    const collector = createMetricsCollector({ metrics: true, serviceName: "test" });
    expect(collector.getServiceName()).toBe("test");
  });

  it("should accept exporter override", () => {
    const exporter = new TestMetricExporter();
    const collector = createMetricsCollector({ metrics: true }, exporter);
    collector.requestStart();
    collector.requestEnd({ route: "/a", method: "GET", status: 200 }, 5);
    collector.flush();
    expect(exporter.exported.length).toBe(1);
  });

  it("should be disabled when metrics: false", () => {
    const exporter = new TestMetricExporter();
    const collector = createMetricsCollector({ metrics: false }, exporter);
    collector.requestStart();
    collector.requestEnd({ route: "/a", method: "GET", status: 200 }, 5);
    collector.flush();
    expect(exporter.exported.length).toBe(0);
  });
});

// ─── Exporter Behavior Tests ─────────────────────────────────

describe("ConsoleMetricExporter", () => {
  it("should write JSON to stdout", () => {
    const written: string[] = [];
    const originalProcess = (globalThis as unknown as Record<string, unknown>).process;
    (globalThis as unknown as Record<string, unknown>).process = {
      stdout: { write: (s: string) => { written.push(s); } },
      env: {},
    };

    const exporter = new ConsoleMetricExporter();
    exporter.export([{
      name: "http.server.request.duration",
      type: "histogram",
      dataPoints: [{ labels: { route: "/a", method: "GET", status: 200 }, value: 42, timestamp: "2026-01-01T00:00:00Z" }],
    }]);

    (globalThis as unknown as Record<string, unknown>).process = originalProcess;

    expect(written.length).toBe(1);
    const parsed = JSON.parse(written[0].trim());
    expect(parsed.exportKind).toBe("metric");
    expect(parsed.name).toBe("http.server.request.duration");
  });
});

describe("NoopMetricExporter", () => {
  it("should not throw", () => {
    const exporter = new NoopMetricExporter();
    exporter.export([{
      name: "test",
      type: "counter",
      dataPoints: [],
    }]);
  });
});
