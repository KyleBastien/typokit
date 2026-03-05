import { describe, it, expect } from "@rstest/core";
import {
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
import type { SpanData, SpanExporter } from "./types.js";

/** Test exporter that captures exported spans */
class TestSpanExporter implements SpanExporter {
  exported: SpanData[][] = [];
  export(spans: SpanData[]): void {
    this.exported.push(spans);
  }
}

describe("generateTraceId", () => {
  it("should generate a 32-character hex string", () => {
    const id = generateTraceId();
    expect(id).toHaveLength(32);
    expect(/^[0-9a-f]{32}$/.test(id)).toBe(true);
  });

  it("should generate unique IDs", () => {
    const ids = new Set(Array.from({ length: 10 }, () => generateTraceId()));
    expect(ids.size).toBe(10);
  });
});

describe("generateSpanId", () => {
  it("should generate a 16-character hex string", () => {
    const id = generateSpanId();
    expect(id).toHaveLength(16);
    expect(/^[0-9a-f]{16}$/.test(id)).toBe(true);
  });
});

describe("Span", () => {
  it("should create a span with traceId, name, and kind", () => {
    const span = new Span({
      traceId: "abc123",
      name: "test-span",
      kind: "server",
    });

    expect(span.traceId).toBe("abc123");
    expect(span.name).toBe("test-span");
    expect(span.kind).toBe("server");
    expect(span.startTime).toBeDefined();
    expect(span.ended).toBe(false);
    expect(span.status).toBe("unset");
  });

  it("should set attributes", () => {
    const span = new Span({ traceId: "t1", name: "s1", kind: "internal" });
    span.setAttribute("http.method", "GET");
    span.setAttribute("http.status_code", 200);
    span.setAttribute("http.ok", true);

    expect(span.attributes["http.method"]).toBe("GET");
    expect(span.attributes["http.status_code"]).toBe(200);
    expect(span.attributes["http.ok"]).toBe(true);
  });

  it("should track status: ok", () => {
    const span = new Span({ traceId: "t1", name: "s1", kind: "internal" });
    span.setOk();
    expect(span.status).toBe("ok");
  });

  it("should track status: error with message", () => {
    const span = new Span({ traceId: "t1", name: "s1", kind: "internal" });
    span.setError("something failed");
    expect(span.status).toBe("error");
    expect(span.attributes["error.message"]).toBe("something failed");
  });

  it("should end and record duration", () => {
    const span = new Span({ traceId: "t1", name: "s1", kind: "internal" });
    expect(span.ended).toBe(false);
    span.end();
    expect(span.ended).toBe(true);

    const data = span.toData();
    expect(data.endTime).toBeDefined();
    expect(typeof data.durationMs).toBe("number");
    expect(data.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("should convert to SpanData without optional fields when absent", () => {
    const span = new Span({ traceId: "t1", name: "s1", kind: "server" });
    const data = span.toData();

    expect(data.traceId).toBe("t1");
    expect(data.name).toBe("s1");
    expect(data.kind).toBe("server");
    expect(data.status).toBe("unset");
    expect("parentSpanId" in data).toBe(false);
    expect("endTime" in data).toBe(false);
    expect("durationMs" in data).toBe(false);
  });

  it("should include parentSpanId when provided", () => {
    const span = new Span({
      traceId: "t1",
      parentSpanId: "parent-1",
      name: "child",
      kind: "internal",
    });
    const data = span.toData();
    expect(data.parentSpanId).toBe("parent-1");
  });
});

describe("Tracer", () => {
  it("should create a tracer with a unique traceId", () => {
    const tracer = new Tracer();
    expect(tracer.traceId).toBeDefined();
    expect(tracer.traceId.length).toBe(32);
  });

  it("should use provided traceId", () => {
    const tracer = new Tracer({ traceId: "custom-trace-id" });
    expect(tracer.traceId).toBe("custom-trace-id");
  });

  it("should start a root span for a request", () => {
    const exporter = new TestSpanExporter();
    const tracer = new Tracer({ exporter, enabled: true });

    const rootSpan = tracer.startRootSpan("POST /users", {
      "http.method": "POST",
      "http.target": "/users",
    });

    expect(rootSpan.name).toBe("POST /users");
    expect(rootSpan.kind).toBe("server");
    expect(rootSpan.attributes["http.method"]).toBe("POST");
    expect(rootSpan.traceId).toBe(tracer.traceId);
  });

  it("should create child spans under the root span", () => {
    const exporter = new TestSpanExporter();
    const tracer = new Tracer({ exporter, enabled: true });

    const root = tracer.startRootSpan("GET /items");
    const child = tracer.startSpan("middleware:auth");

    expect(child.traceId).toBe(tracer.traceId);
    expect(child.kind).toBe("internal");

    const childData = child.toData();
    expect(childData.parentSpanId).toBe(root.spanId);
  });

  it("should create span hierarchy: root → middleware → validation → handler → serialization", () => {
    const exporter = new TestSpanExporter();
    const tracer = new Tracer({ exporter, enabled: true });

    const root = tracer.startRootSpan("POST /users");
    const mw = tracer.startSpan("middleware:logging");
    mw.setOk();
    mw.end();
    const auth = tracer.startSpan("middleware:auth");
    auth.setOk();
    auth.end();
    const validation = tracer.startSpan("validation:body");
    validation.setAttribute("validation.result", "pass");
    validation.setOk();
    validation.end();
    const handler = tracer.startSpan("handler");
    handler.setOk();
    handler.end();
    const serialization = tracer.startSpan("serialization");
    serialization.setOk();
    serialization.end();
    root.setOk();
    root.setAttribute("http.status_code", 200);
    root.end();

    const spans = tracer.getSpans();
    expect(spans).toHaveLength(6);

    // Root span
    expect(spans[0].name).toBe("POST /users");
    expect(spans[0].kind).toBe("server");

    // All children reference root
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i].parentSpanId).toBe(spans[0].spanId);
      expect(spans[i].kind).toBe("internal");
    }

    // Verify span names
    expect(spans.map((s) => s.name)).toEqual([
      "POST /users",
      "middleware:logging",
      "middleware:auth",
      "validation:body",
      "handler",
      "serialization",
    ]);
  });

  it("should propagate traceId across all spans", () => {
    const tracer = new Tracer({ enabled: true });
    tracer.startRootSpan("request");
    const s1 = tracer.startSpan("phase1");
    const s2 = tracer.startSpan("phase2");
    s1.end();
    s2.end();

    const spans = tracer.getSpans();
    for (const span of spans) {
      expect(span.traceId).toBe(tracer.traceId);
    }
  });

  it("should flush and export all spans", () => {
    const exporter = new TestSpanExporter();
    const tracer = new Tracer({ exporter, enabled: true });

    tracer.startRootSpan("request");
    tracer.startSpan("child1");
    tracer.startSpan("child2");

    tracer.flush();

    expect(exporter.exported).toHaveLength(1);
    expect(exporter.exported[0]).toHaveLength(3);

    // All spans should be ended after flush
    for (const span of exporter.exported[0]) {
      expect(span.endTime).toBeDefined();
    }
  });

  it("should not export when disabled", () => {
    const exporter = new TestSpanExporter();
    const tracer = new Tracer({ exporter, enabled: false });

    tracer.startRootSpan("request");
    tracer.startSpan("child");
    tracer.flush();

    expect(exporter.exported).toHaveLength(0);
  });

  it("should include service.name attribute on root span", () => {
    const exporter = new TestSpanExporter();
    const tracer = new Tracer({
      exporter,
      serviceName: "my-api",
      enabled: true,
    });

    tracer.startRootSpan("request");
    tracer.flush();

    const rootSpan = exporter.exported[0][0];
    expect(rootSpan.attributes["service.name"]).toBe("my-api");
  });

  it("should default serviceName to 'typokit'", () => {
    const exporter = new TestSpanExporter();
    const tracer = new Tracer({ exporter, enabled: true });

    tracer.startRootSpan("request");
    tracer.flush();

    expect(exporter.exported[0][0].attributes["service.name"]).toBe("typokit");
  });
});

describe("resolveTracingConfig", () => {
  it("should default to enabled with console exporter when no config", () => {
    const config = resolveTracingConfig();
    expect(config.enabled).toBe(true);
    expect(config.exporter).toBe("console");
  });

  it("should handle tracing: true in telemetry config", () => {
    const config = resolveTracingConfig({
      tracing: true,
      exporter: "otlp",
      endpoint: "http://collector:4318",
    });
    expect(config.enabled).toBe(true);
    expect(config.exporter).toBe("otlp");
    expect(config.endpoint).toBe("http://collector:4318");
  });

  it("should handle tracing: false", () => {
    const config = resolveTracingConfig({ tracing: false });
    expect(config.enabled).toBe(false);
  });

  it("should handle tracing as object config", () => {
    const config = resolveTracingConfig({
      tracing: {
        enabled: true,
        exporter: "otlp",
        endpoint: "http://custom:4318",
        serviceName: "my-svc",
      },
    });
    expect(config.enabled).toBe(true);
    expect(config.exporter).toBe("otlp");
    expect(config.endpoint).toBe("http://custom:4318");
    expect(config.serviceName).toBe("my-svc");
  });

  it("should inherit top-level exporter/endpoint when tracing is boolean", () => {
    const config = resolveTracingConfig({
      tracing: true,
      exporter: "otlp",
      endpoint: "http://otel:4318",
      serviceName: "top-svc",
    });
    expect(config.exporter).toBe("otlp");
    expect(config.endpoint).toBe("http://otel:4318");
    expect(config.serviceName).toBe("top-svc");
  });
});

describe("createExporter", () => {
  it("should create NoopSpanExporter when disabled", () => {
    const exp = createExporter({ enabled: false });
    expect(exp).toBeInstanceOf(NoopSpanExporter);
  });

  it("should create ConsoleSpanExporter for console exporter", () => {
    const exp = createExporter({ enabled: true, exporter: "console" });
    expect(exp).toBeInstanceOf(ConsoleSpanExporter);
  });

  it("should create OtlpSpanExporter for otlp exporter", () => {
    const exp = createExporter({
      enabled: true,
      exporter: "otlp",
      endpoint: "http://collector:4318",
    });
    expect(exp).toBeInstanceOf(OtlpSpanExporter);
  });
});

describe("createRequestTracer", () => {
  it("should create a tracer with default config", () => {
    const tracer = createRequestTracer();
    expect(tracer.traceId).toBeDefined();
    expect(tracer.traceId.length).toBe(32);
  });

  it("should create a tracer with telemetry config", () => {
    const tracer = createRequestTracer({
      tracing: true,
      serviceName: "test-api",
    });
    expect(tracer.traceId).toBeDefined();
  });

  it("should accept exporter override", () => {
    const exporter = new TestSpanExporter();
    const tracer = createRequestTracer({ tracing: true }, exporter);

    tracer.startRootSpan("request");
    tracer.flush();

    expect(exporter.exported).toHaveLength(1);
  });

  it("should disable tracing when config says false", () => {
    const exporter = new TestSpanExporter();
    const tracer = createRequestTracer({ tracing: false }, exporter);

    tracer.startRootSpan("request");
    tracer.flush();

    expect(exporter.exported).toHaveLength(0);
  });
});

describe("ConsoleSpanExporter", () => {
  it("should be constructable", () => {
    const exp = new ConsoleSpanExporter();
    expect(typeof exp.export).toBe("function");
  });
});

describe("OtlpSpanExporter", () => {
  it("should be constructable with default endpoint", () => {
    const exp = new OtlpSpanExporter();
    expect(typeof exp.export).toBe("function");
  });

  it("should be constructable with custom endpoint", () => {
    const exp = new OtlpSpanExporter("http://custom:4318");
    expect(typeof exp.export).toBe("function");
  });
});

describe("NoopSpanExporter", () => {
  it("should silently discard spans", () => {
    const exp = new NoopSpanExporter();
    exp.export([
      {
        traceId: "t1",
        spanId: "s1",
        name: "test",
        kind: "server",
        startTime: new Date().toISOString(),
        status: "ok",
        attributes: {},
      },
    ]);
    // No error thrown
  });
});
