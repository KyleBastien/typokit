// @typokit/plugin-debug — Integration Tests

import { describe, it, expect } from "@rstest/core";
import { debugPlugin } from "./index.js";
import type { TypoKitPlugin, AppInstance } from "@typokit/core";
import type { CompiledRouteTable, SchemaChange } from "@typokit/types";
import type { HistogramDataPoint, LogEntry, SpanData } from "@typokit/otel";

// ─── Helpers ─────────────────────────────────────────────────

function createTestApp(plugins: TypoKitPlugin[]): AppInstance {
  return {
    name: "test-app",
    plugins,
    services: {},
  };
}

const sampleRouteTable: CompiledRouteTable = {
  segment: "",
  children: {
    users: {
      segment: "users",
      handlers: {
        GET: { ref: "users#list", middleware: ["auth"] },
        POST: { ref: "users#create", middleware: ["auth", "validate"] },
      },
      paramChild: {
        segment: ":id",
        paramName: "id",
        handlers: {
          GET: {
            ref: "users#get",
            middleware: ["auth"],
            validators: { params: "userId" },
          },
        },
      },
    },
  },
};

interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
}

async function fetchDebug(
  port: number,
  path: string,
  options: FetchOptions = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const fetchFn = globalThis.fetch;
  const resp = await fetchFn(`http://127.0.0.1:${port}${path}`, {
    method: options.method ?? "GET",
    headers: options.headers ?? {},
  });
  const body = (await resp.json()) as Record<string, unknown>;
  return { status: resp.status, body };
}

// ─── Tests ───────────────────────────────────────────────────

describe("debugPlugin", () => {
  it("should create a plugin with the correct name", () => {
    const plugin = debugPlugin();
    expect(plugin.name).toBe("plugin-debug");
  });

  it("should implement TypoKitPlugin lifecycle hooks", () => {
    const plugin = debugPlugin();
    expect(typeof plugin.onStart).toBe("function");
    expect(typeof plugin.onReady).toBe("function");
    expect(typeof plugin.onStop).toBe("function");
    expect(typeof plugin.onError).toBe("function");
    expect(typeof plugin.onSchemaChange).toBe("function");
  });

  it("should start and stop the sidecar server", async () => {
    const plugin = debugPlugin({ port: 0 });
    const app = createTestApp([plugin]);

    await plugin.onStart!(app);
    // Use a random port for tests
    // onReady starts the server
    await plugin.onReady!(app);

    // Server should be running — stop it
    await plugin.onStop!(app);
  });

  it("should clear cached routes on schema change", () => {
    const plugin = debugPlugin();
    const changes: SchemaChange[] = [
      { type: "add", entity: "User", field: "email" },
    ];
    // Should not throw
    plugin.onSchemaChange!(changes);
  });
});

describe("debug endpoints", () => {
  let plugin: TypoKitPlugin;
  let app: AppInstance;
  const port = 19800; // Use non-default port for tests

  // Start the debug server before tests
  it("should start the debug sidecar", async () => {
    plugin = debugPlugin({ port });
    app = createTestApp([plugin]);
    await plugin.onStart!(app);

    // Set up test data via the services API
    const debug = app.services["_debug"] as {
      setRouteTable: (rt: CompiledRouteTable) => void;
      setMiddleware: (names: string[]) => void;
      recordError: (
        error: {
          code: string;
          status: number;
          message: string;
          details?: Record<string, unknown>;
        },
        route?: string,
      ) => void;
      recordTrace: (spans: SpanData[]) => void;
      recordLog: (entry: LogEntry) => void;
      recordPerformance: (dp: HistogramDataPoint) => void;
    };

    debug.setRouteTable(sampleRouteTable);
    debug.setMiddleware(["auth", "cors", "logging"]);
    debug.recordError(
      { code: "NOT_FOUND", status: 404, message: "User not found" },
      "GET /users/999",
    );
    debug.recordTrace([
      {
        traceId: "abc123",
        spanId: "span1",
        name: "GET /users",
        kind: "server",
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        durationMs: 42,
        status: "ok",
        attributes: { "http.method": "GET" },
      },
    ]);
    debug.recordLog({
      level: "info",
      message: "Request processed",
      timestamp: new Date().toISOString(),
      data: { userId: "123" },
    });
    debug.recordPerformance({
      labels: { route: "GET /users", method: "GET", status: 200 },
      value: 42,
      timestamp: new Date().toISOString(),
    });

    await plugin.onReady!(app);
  });

  it("GET /_debug/routes should return registered routes", async () => {
    const { status, body } = await fetchDebug(port, "/_debug/routes");
    expect(status).toBe(200);
    const routes = body["routes"] as Array<{ method: string; ref: string }>;
    expect(Array.isArray(routes)).toBe(true);
    expect(routes.length).toBeGreaterThan(0);
    // Should have the users routes
    const listRoute = routes.find((r) => r.ref === "users#list");
    expect(listRoute).toBeDefined();
    expect(listRoute!.method).toBe("GET");
  });

  it("GET /_debug/middleware should return middleware chain", async () => {
    const { status, body } = await fetchDebug(port, "/_debug/middleware");
    expect(status).toBe(200);
    const mw = body["middleware"] as string[];
    expect(Array.isArray(mw)).toBe(true);
    expect(mw).toContain("auth");
    expect(mw).toContain("cors");
  });

  it("GET /_debug/performance should return latency percentiles", async () => {
    const { status, body } = await fetchDebug(
      port,
      "/_debug/performance?window=5m",
    );
    expect(status).toBe(200);
    expect(typeof body["p50"]).toBe("number");
    expect(typeof body["p95"]).toBe("number");
    expect(typeof body["p99"]).toBe("number");
    expect(typeof body["count"]).toBe("number");
  });

  it("GET /_debug/errors should return recent errors", async () => {
    const { status, body } = await fetchDebug(port, "/_debug/errors?since=5m");
    expect(status).toBe(200);
    const errors = body["errors"] as Array<{ code: string }>;
    expect(Array.isArray(errors)).toBe(true);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].code).toBe("NOT_FOUND");
  });

  it("GET /_debug/health should return health status", async () => {
    const { status, body } = await fetchDebug(port, "/_debug/health");
    expect(status).toBe(200);
    expect(body["status"]).toBe("ok");
    expect(body["memory"]).toBeDefined();
  });

  it("GET /_debug/dependencies should return dependency graph", async () => {
    const { status, body } = await fetchDebug(port, "/_debug/dependencies");
    expect(status).toBe(200);
    expect(body["dependencies"]).toBeDefined();
  });

  it("GET /_debug/traces should return recent traces", async () => {
    const { status, body } = await fetchDebug(port, "/_debug/traces");
    expect(status).toBe(200);
    const traces = body["traces"] as SpanData[][];
    expect(Array.isArray(traces)).toBe(true);
    expect(traces.length).toBeGreaterThan(0);
  });

  it("GET /_debug/logs should return recent logs", async () => {
    const { status, body } = await fetchDebug(port, "/_debug/logs?since=5m");
    expect(status).toBe(200);
    const logs = body["logs"] as LogEntry[];
    expect(Array.isArray(logs)).toBe(true);
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0].message).toBe("Request processed");
  });

  it("POST should be rejected (read-only)", async () => {
    const { status } = await fetchDebug(port, "/_debug/routes", {
      method: "POST",
    });
    expect(status).toBe(405);
  });

  it("unknown endpoint should return 404", async () => {
    const { status } = await fetchDebug(port, "/_debug/unknown");
    expect(status).toBe(404);
  });

  it("should stop the sidecar", async () => {
    await plugin.onStop!(app);
  });
});

describe("production mode security", () => {
  it("should require API key in production mode", async () => {
    const testPort = 19801;
    const plugin = debugPlugin({
      port: testPort,
      production: true,
      security: { apiKey: "test-secret-key" },
    });
    const app = createTestApp([plugin]);
    await plugin.onStart!(app);
    await plugin.onReady!(app);

    // Request without key should fail
    const { status: noKeyStatus } = await fetchDebug(
      testPort,
      "/_debug/health",
    );
    expect(noKeyStatus).toBe(401);

    // Request with correct key should succeed
    const { status: withKeyStatus } = await fetchDebug(
      testPort,
      "/_debug/health",
      {
        headers: { "x-debug-key": "test-secret-key" },
      },
    );
    expect(withKeyStatus).toBe(200);

    // Request with wrong key should fail
    const { status: wrongKeyStatus } = await fetchDebug(
      testPort,
      "/_debug/health",
      {
        headers: { "x-debug-key": "wrong-key" },
      },
    );
    expect(wrongKeyStatus).toBe(401);

    await plugin.onStop!(app);
  });
});

describe("redaction", () => {
  it("should redact sensitive fields from error details", async () => {
    const testPort = 19802;
    const plugin = debugPlugin({
      port: testPort,
      security: { redact: ["password", "*.secret"] },
    });
    const app = createTestApp([plugin]);
    await plugin.onStart!(app);

    const debug = app.services["_debug"] as {
      recordError: (
        error: {
          code: string;
          status: number;
          message: string;
          details?: Record<string, unknown>;
        },
        route?: string,
      ) => void;
    };

    debug.recordError({
      code: "AUTH_FAILED",
      status: 401,
      message: "Auth failed",
      details: { password: "hunter2", username: "admin" },
    });

    await plugin.onReady!(app);

    const { status, body } = await fetchDebug(
      testPort,
      "/_debug/errors?since=5m",
    );
    expect(status).toBe(200);
    const errors = body["errors"] as Array<{
      details?: Record<string, unknown>;
    }>;
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].details?.["password"]).toBe("[REDACTED]");
    expect(errors[0].details?.["username"]).toBe("admin");

    await plugin.onStop!(app);
  });
});
