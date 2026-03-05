import { describe, it, expect } from "@rstest/core";
import { OtelLogSink, createOtelLogSink } from "./log-bridge.js";
import { StructuredLogger } from "./logger.js";
import type { LogEntry, LogSink } from "./types.js";

/** Test sink that captures log entries */
class TestSink implements LogSink {
  entries: LogEntry[] = [];
  write(entry: LogEntry): void {
    this.entries.push(entry);
  }
}

describe("OtelLogSink", () => {
  it("should be constructable with default options", () => {
    const sink = new OtelLogSink();
    expect(sink).toBeDefined();
    expect(typeof sink.write).toBe("function");
  });

  it("should be constructable with custom endpoint and serviceName", () => {
    const sink = new OtelLogSink({
      endpoint: "http://collector:4318/v1/logs",
      serviceName: "my-service",
    });
    expect(sink).toBeDefined();
  });

  it("should forward log entries to OTel collector with correct OTLP format", () => {
    const fetchCalls: Array<{ url: string; init: Record<string, unknown> }> =
      [];
    const originalFetch = (globalThis as unknown as Record<string, unknown>)[
      "fetch"
    ];
    (globalThis as unknown as Record<string, unknown>)["fetch"] = (
      url: string,
      init: Record<string, unknown>,
    ) => {
      fetchCalls.push({ url, init });
      return Promise.resolve({ ok: true });
    };

    try {
      const sink = new OtelLogSink({
        endpoint: "http://test:4318/v1/logs",
        serviceName: "test-svc",
      });
      const entry: LogEntry = {
        level: "info",
        message: "test log message",
        timestamp: "2026-01-01T00:00:00.000Z",
        route: "GET /users",
        phase: "handler",
        requestId: "req-123",
      };

      sink.write(entry);

      expect(fetchCalls).toHaveLength(1);
      expect(fetchCalls[0].url).toBe("http://test:4318/v1/logs");

      const body = JSON.parse(fetchCalls[0].init["body"] as string);
      const resourceLogs = body.resourceLogs;
      expect(resourceLogs).toHaveLength(1);

      // Check resource service.name
      const resource = resourceLogs[0].resource;
      expect(resource.attributes[0].key).toBe("service.name");
      expect(resource.attributes[0].value.stringValue).toBe("test-svc");

      // Check scope
      const scopeLogs = resourceLogs[0].scopeLogs;
      expect(scopeLogs[0].scope.name).toBe("@typokit/otel");

      // Check log record
      const logRecord = scopeLogs[0].logRecords[0];
      expect(logRecord.severityNumber).toBe(9); // INFO
      expect(logRecord.severityText).toBe("INFO");
      expect(logRecord.body.stringValue).toBe("test log message");
      expect(logRecord.timeUnixNano).toBe(
        new Date("2026-01-01T00:00:00.000Z").getTime() * 1_000_000,
      );
    } finally {
      if (originalFetch !== undefined) {
        (globalThis as unknown as Record<string, unknown>)["fetch"] =
          originalFetch;
      } else {
        delete (globalThis as unknown as Record<string, unknown>)["fetch"];
      }
    }
  });

  it("should include traceId in log record for correlation", () => {
    const fetchCalls: Array<{ url: string; init: Record<string, unknown> }> =
      [];
    const originalFetch = (globalThis as unknown as Record<string, unknown>)[
      "fetch"
    ];
    (globalThis as unknown as Record<string, unknown>)["fetch"] = (
      url: string,
      init: Record<string, unknown>,
    ) => {
      fetchCalls.push({ url, init });
      return Promise.resolve({ ok: true });
    };

    try {
      const sink = new OtelLogSink();
      const entry: LogEntry = {
        level: "error",
        message: "something failed",
        timestamp: "2026-01-01T00:00:00.000Z",
        traceId: "abcdef0123456789abcdef0123456789",
      };

      sink.write(entry);

      const body = JSON.parse(fetchCalls[0].init["body"] as string);
      const logRecord = body.resourceLogs[0].scopeLogs[0].logRecords[0];
      expect(logRecord.traceId).toBe("abcdef0123456789abcdef0123456789");
    } finally {
      if (originalFetch !== undefined) {
        (globalThis as unknown as Record<string, unknown>)["fetch"] =
          originalFetch;
      } else {
        delete (globalThis as unknown as Record<string, unknown>)["fetch"];
      }
    }
  });

  it("should include spanId from data field for correlation", () => {
    const fetchCalls: Array<{ url: string; init: Record<string, unknown> }> =
      [];
    const originalFetch = (globalThis as unknown as Record<string, unknown>)[
      "fetch"
    ];
    (globalThis as unknown as Record<string, unknown>)["fetch"] = (
      url: string,
      init: Record<string, unknown>,
    ) => {
      fetchCalls.push({ url, init });
      return Promise.resolve({ ok: true });
    };

    try {
      const sink = new OtelLogSink();
      const entry: LogEntry = {
        level: "info",
        message: "in span",
        timestamp: "2026-01-01T00:00:00.000Z",
        traceId: "trace123",
        data: { spanId: "span456", userId: "u1" },
      };

      sink.write(entry);

      const body = JSON.parse(fetchCalls[0].init["body"] as string);
      const logRecord = body.resourceLogs[0].scopeLogs[0].logRecords[0];
      expect(logRecord.traceId).toBe("trace123");
      expect(logRecord.spanId).toBe("span456");

      // spanId should NOT appear in attributes (used as top-level field)
      const attrKeys = logRecord.attributes.map((a: { key: string }) => a.key);
      expect(attrKeys.includes("data.spanId")).toBe(false);
      // userId should appear in attributes
      expect(attrKeys.includes("data.userId")).toBe(true);
    } finally {
      if (originalFetch !== undefined) {
        (globalThis as unknown as Record<string, unknown>)["fetch"] =
          originalFetch;
      } else {
        delete (globalThis as unknown as Record<string, unknown>)["fetch"];
      }
    }
  });

  it("should map all log levels to correct OTel severity numbers", () => {
    const fetchCalls: Array<{ url: string; init: Record<string, unknown> }> =
      [];
    const originalFetch = (globalThis as unknown as Record<string, unknown>)[
      "fetch"
    ];
    (globalThis as unknown as Record<string, unknown>)["fetch"] = (
      url: string,
      init: Record<string, unknown>,
    ) => {
      fetchCalls.push({ url, init });
      return Promise.resolve({ ok: true });
    };

    try {
      const sink = new OtelLogSink();
      const levels = [
        { level: "trace", num: 1, text: "TRACE" },
        { level: "debug", num: 5, text: "DEBUG" },
        { level: "info", num: 9, text: "INFO" },
        { level: "warn", num: 13, text: "WARN" },
        { level: "error", num: 17, text: "ERROR" },
        { level: "fatal", num: 21, text: "FATAL" },
      ] as const;

      for (const l of levels) {
        sink.write({
          level: l.level,
          message: `msg-${l.level}`,
          timestamp: "2026-01-01T00:00:00.000Z",
        });
      }

      expect(fetchCalls).toHaveLength(6);
      for (let i = 0; i < levels.length; i++) {
        const body = JSON.parse(fetchCalls[i].init["body"] as string);
        const logRecord = body.resourceLogs[0].scopeLogs[0].logRecords[0];
        expect(logRecord.severityNumber).toBe(levels[i].num);
        expect(logRecord.severityText).toBe(levels[i].text);
      }
    } finally {
      if (originalFetch !== undefined) {
        (globalThis as unknown as Record<string, unknown>)["fetch"] =
          originalFetch;
      } else {
        delete (globalThis as unknown as Record<string, unknown>)["fetch"];
      }
    }
  });

  it("should include route, phase, requestId, serverAdapter as OTLP attributes", () => {
    const fetchCalls: Array<{ url: string; init: Record<string, unknown> }> =
      [];
    const originalFetch = (globalThis as unknown as Record<string, unknown>)[
      "fetch"
    ];
    (globalThis as unknown as Record<string, unknown>)["fetch"] = (
      url: string,
      init: Record<string, unknown>,
    ) => {
      fetchCalls.push({ url, init });
      return Promise.resolve({ ok: true });
    };

    try {
      const sink = new OtelLogSink();
      sink.write({
        level: "info",
        message: "test",
        timestamp: "2026-01-01T00:00:00.000Z",
        route: "POST /items",
        phase: "validation",
        requestId: "req-789",
        serverAdapter: "native",
      });

      const body = JSON.parse(fetchCalls[0].init["body"] as string);
      const attrs = body.resourceLogs[0].scopeLogs[0].logRecords[0].attributes;
      const attrMap = new Map(
        attrs.map((a: { key: string; value: { stringValue: string } }) => [
          a.key,
          a.value.stringValue,
        ]),
      );

      expect(attrMap.get("route")).toBe("POST /items");
      expect(attrMap.get("phase")).toBe("validation");
      expect(attrMap.get("requestId")).toBe("req-789");
      expect(attrMap.get("serverAdapter")).toBe("native");
    } finally {
      if (originalFetch !== undefined) {
        (globalThis as unknown as Record<string, unknown>)["fetch"] =
          originalFetch;
      } else {
        delete (globalThis as unknown as Record<string, unknown>)["fetch"];
      }
    }
  });

  it("should silently handle missing fetch", () => {
    const originalFetch = (globalThis as unknown as Record<string, unknown>)[
      "fetch"
    ];
    delete (globalThis as unknown as Record<string, unknown>)["fetch"];

    try {
      const sink = new OtelLogSink();
      // Should not throw
      sink.write({
        level: "info",
        message: "no fetch",
        timestamp: "2026-01-01T00:00:00.000Z",
      });
    } finally {
      if (originalFetch !== undefined) {
        (globalThis as unknown as Record<string, unknown>)["fetch"] =
          originalFetch;
      }
    }
  });
});

describe("createOtelLogSink", () => {
  it("should return undefined when no telemetry config", () => {
    const sink = createOtelLogSink();
    expect(sink).toBeUndefined();
  });

  it("should return undefined when tracing is disabled", () => {
    const sink = createOtelLogSink({ tracing: false });
    expect(sink).toBeUndefined();
  });

  it("should return undefined when tracing.enabled is false", () => {
    const sink = createOtelLogSink({ tracing: { enabled: false } });
    expect(sink).toBeUndefined();
  });

  it("should return OtelLogSink when tracing is true", () => {
    const sink = createOtelLogSink({ tracing: true });
    expect(sink).toBeDefined();
    expect(sink).toBeInstanceOf(OtelLogSink);
  });

  it("should return OtelLogSink when tracing is configured as object", () => {
    const sink = createOtelLogSink({
      tracing: {
        enabled: true,
        exporter: "otlp",
        endpoint: "http://collector:4318/v1/traces",
      },
    });
    expect(sink).toBeDefined();
    expect(sink).toBeInstanceOf(OtelLogSink);
  });

  it("should derive logs endpoint from traces endpoint", () => {
    const fetchCalls: Array<{ url: string; init: Record<string, unknown> }> =
      [];
    const originalFetch = (globalThis as unknown as Record<string, unknown>)[
      "fetch"
    ];
    (globalThis as unknown as Record<string, unknown>)["fetch"] = (
      url: string,
      init: Record<string, unknown>,
    ) => {
      fetchCalls.push({ url, init });
      return Promise.resolve({ ok: true });
    };

    try {
      const sink = createOtelLogSink({
        tracing: { enabled: true, endpoint: "http://collector:4318/v1/traces" },
      });
      expect(sink).toBeDefined();

      sink!.write({
        level: "info",
        message: "test endpoint",
        timestamp: "2026-01-01T00:00:00.000Z",
      });

      expect(fetchCalls[0].url).toBe("http://collector:4318/v1/logs");
    } finally {
      if (originalFetch !== undefined) {
        (globalThis as unknown as Record<string, unknown>)["fetch"] =
          originalFetch;
      } else {
        delete (globalThis as unknown as Record<string, unknown>)["fetch"];
      }
    }
  });

  it("should use serviceName from telemetry config", () => {
    const fetchCalls: Array<{ url: string; init: Record<string, unknown> }> =
      [];
    const originalFetch = (globalThis as unknown as Record<string, unknown>)[
      "fetch"
    ];
    (globalThis as unknown as Record<string, unknown>)["fetch"] = (
      url: string,
      init: Record<string, unknown>,
    ) => {
      fetchCalls.push({ url, init });
      return Promise.resolve({ ok: true });
    };

    try {
      const sink = createOtelLogSink({ tracing: true, serviceName: "my-app" });
      expect(sink).toBeDefined();

      sink!.write({
        level: "info",
        message: "test svc",
        timestamp: "2026-01-01T00:00:00.000Z",
      });

      const body = JSON.parse(fetchCalls[0].init["body"] as string);
      const svcAttr = body.resourceLogs[0].resource.attributes[0];
      expect(svcAttr.value.stringValue).toBe("my-app");
    } finally {
      if (originalFetch !== undefined) {
        (globalThis as unknown as Record<string, unknown>)["fetch"] =
          originalFetch;
      } else {
        delete (globalThis as unknown as Record<string, unknown>)["fetch"];
      }
    }
  });
});

describe("OtelLogSink + StructuredLogger integration", () => {
  it("should work alongside StdoutSink (both active simultaneously)", () => {
    const testSink = new TestSink();
    const otelCalls: Array<{ url: string; init: Record<string, unknown> }> = [];
    const originalFetch = (globalThis as unknown as Record<string, unknown>)[
      "fetch"
    ];
    (globalThis as unknown as Record<string, unknown>)["fetch"] = (
      url: string,
      init: Record<string, unknown>,
    ) => {
      otelCalls.push({ url, init });
      return Promise.resolve({ ok: true });
    };

    try {
      const otelSink = new OtelLogSink({ serviceName: "integration-test" });
      // Both sinks active on the same logger
      const logger = new StructuredLogger(
        { level: "trace" },
        { traceId: "trace-abc", route: "GET /health" },
        [testSink, otelSink],
      );

      logger.info("health check", { status: "ok" });

      // TestSink received the entry
      expect(testSink.entries).toHaveLength(1);
      expect(testSink.entries[0].message).toBe("health check");
      expect(testSink.entries[0].traceId).toBe("trace-abc");

      // OtelLogSink sent to collector
      expect(otelCalls).toHaveLength(1);
      const body = JSON.parse(otelCalls[0].init["body"] as string);
      const logRecord = body.resourceLogs[0].scopeLogs[0].logRecords[0];
      expect(logRecord.body.stringValue).toBe("health check");
      expect(logRecord.traceId).toBe("trace-abc");
      expect(logRecord.severityText).toBe("INFO");
    } finally {
      if (originalFetch !== undefined) {
        (globalThis as unknown as Record<string, unknown>)["fetch"] =
          originalFetch;
      } else {
        delete (globalThis as unknown as Record<string, unknown>)["fetch"];
      }
    }
  });

  it("should forward log entries with correct trace context from logger metadata", () => {
    const otelCalls: Array<{ url: string; init: Record<string, unknown> }> = [];
    const originalFetch = (globalThis as unknown as Record<string, unknown>)[
      "fetch"
    ];
    (globalThis as unknown as Record<string, unknown>)["fetch"] = (
      url: string,
      init: Record<string, unknown>,
    ) => {
      otelCalls.push({ url, init });
      return Promise.resolve({ ok: true });
    };

    try {
      const otelSink = new OtelLogSink();
      const logger = new StructuredLogger(
        { level: "trace" },
        {
          traceId: "aaaa1111bbbb2222cccc3333dddd4444",
          route: "POST /orders",
          phase: "handler",
        },
        [otelSink],
      );

      logger.error("order failed", { orderId: "ord-1", spanId: "span-9876" });

      const body = JSON.parse(otelCalls[0].init["body"] as string);
      const logRecord = body.resourceLogs[0].scopeLogs[0].logRecords[0];

      // Trace context for correlation
      expect(logRecord.traceId).toBe("aaaa1111bbbb2222cccc3333dddd4444");
      expect(logRecord.spanId).toBe("span-9876");
      expect(logRecord.severityNumber).toBe(17); // ERROR

      // Attributes should include route and phase
      const attrs = logRecord.attributes;
      const attrMap = new Map(
        attrs.map((a: { key: string; value: { stringValue: string } }) => [
          a.key,
          a.value.stringValue,
        ]),
      );
      expect(attrMap.get("route")).toBe("POST /orders");
      expect(attrMap.get("phase")).toBe("handler");
      expect(attrMap.get("data.orderId")).toBe("ord-1");
    } finally {
      if (originalFetch !== undefined) {
        (globalThis as unknown as Record<string, unknown>)["fetch"] =
          originalFetch;
      } else {
        delete (globalThis as unknown as Record<string, unknown>)["fetch"];
      }
    }
  });
});
