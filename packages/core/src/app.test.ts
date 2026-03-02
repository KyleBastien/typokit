// @typokit/core — App Factory Tests

import { describe, it, expect } from "@rstest/core";
import type { TypoKitRequest, TypoKitResponse, RequestContext, ErrorResponse } from "@typokit/types";
import { NotFoundError } from "@typokit/errors";
import type { ServerAdapter } from "./adapters/server.js";
import type { TypoKitPlugin, AppInstance } from "./plugin.js";
import { createApp } from "./app.js";
import { createErrorMiddleware } from "./error-middleware.js";

// ─── Helpers ─────────────────────────────────────────────────

function createMockServerAdapter(overrides?: Partial<ServerAdapter>): ServerAdapter {
  return {
    name: "mock-server",
    registerRoutes: () => {},
    listen: async (_port: number): Promise<ServerHandle> => ({
      close: async () => {},
    }),
    normalizeRequest: (_raw: unknown): TypoKitRequest => ({
      method: "GET",
      path: "/",
      headers: {},
      body: undefined,
      query: {},
      params: {},
    }),
    writeResponse: () => {},
    ...overrides,
  };
}

function createMockPlugin(overrides?: Partial<TypoKitPlugin>): TypoKitPlugin {
  return {
    name: "mock-plugin",
    ...overrides,
  };
}

// ─── App Creation ────────────────────────────────────────────

describe("createApp", () => {
  it("returns an app with listen, getNativeServer, and close", () => {
    const app = createApp({
      server: createMockServerAdapter(),
      routes: [],
    });

    expect(typeof app.listen).toBe("function");
    expect(typeof app.getNativeServer).toBe("function");
    expect(typeof app.close).toBe("function");
  });

  it("accepts routes with prefix, handlers, and optional middleware", () => {
    const app = createApp({
      server: createMockServerAdapter(),
      routes: [
        {
          prefix: "/api/users",
          handlers: { "GET /": async () => ({ users: [] }) },
        },
        {
          prefix: "/api/posts",
          handlers: { "POST /": async () => ({ id: 1 }) },
          middleware: [],
        },
      ],
    });

    expect(typeof app.listen).toBe("function");
  });

  it("accepts optional middleware, plugins, logging, and telemetry", () => {
    const app = createApp({
      server: createMockServerAdapter(),
      routes: [],
      middleware: [],
      plugins: [],
      logging: { info: () => {} },
      telemetry: { enabled: false },
    });

    expect(typeof app.listen).toBe("function");
  });

  it("auto-registers error middleware", () => {
    const app = createApp({
      server: createMockServerAdapter(),
      routes: [],
    });

    expect(typeof app.errorMiddleware).toBe("function");
  });
});

// ─── Server Delegation ──────────────────────────────────────

describe("app.listen()", () => {
  it("delegates to the server adapter", async () => {
    let listenedPort: number | undefined;
    const server = createMockServerAdapter({
      listen: async (port: number) => {
        listenedPort = port;
        return { close: async () => {} };
      },
    });

    const app = createApp({ server, routes: [] });
    await app.listen(3000);

    expect(listenedPort).toBe(3000);
  });

  it("returns a ServerHandle from the adapter", async () => {
    const handle = await createApp({
      server: createMockServerAdapter(),
      routes: [],
    }).listen(3000);

    expect(typeof handle.close).toBe("function");
  });
});

describe("app.getNativeServer()", () => {
  it("delegates to the server adapter getNativeServer()", () => {
    const nativeInstance = { framework: "test" };
    const server = createMockServerAdapter({
      getNativeServer: () => nativeInstance,
    });

    const app = createApp({ server, routes: [] });
    expect(app.getNativeServer()).toBe(nativeInstance);
  });

  it("returns null when adapter has no getNativeServer", () => {
    const server = createMockServerAdapter();
    delete (server as Record<string, unknown>).getNativeServer;

    const app = createApp({ server, routes: [] });
    expect(app.getNativeServer()).toBeNull();
  });
});

// ─── Plugin Lifecycle ────────────────────────────────────────

describe("plugin lifecycle hooks", () => {
  it("calls onStart hooks before the server starts listening", async () => {
    const callOrder: string[] = [];

    const server = createMockServerAdapter({
      listen: async (_port: number) => {
        callOrder.push("server.listen");
        return { close: async () => {} };
      },
    });

    const plugin = createMockPlugin({
      onStart: async (_app: AppInstance) => {
        callOrder.push("plugin.onStart");
      },
    });

    const app = createApp({ server, routes: [], plugins: [plugin] });
    await app.listen(3000);

    expect(callOrder[0]).toBe("plugin.onStart");
    expect(callOrder[1]).toBe("server.listen");
  });

  it("calls onReady hooks after the server is listening", async () => {
    const callOrder: string[] = [];

    const server = createMockServerAdapter({
      listen: async (_port: number) => {
        callOrder.push("server.listen");
        return { close: async () => {} };
      },
    });

    const plugin = createMockPlugin({
      onReady: async (_app: AppInstance) => {
        callOrder.push("plugin.onReady");
      },
    });

    const app = createApp({ server, routes: [], plugins: [plugin] });
    await app.listen(3000);

    expect(callOrder[0]).toBe("server.listen");
    expect(callOrder[1]).toBe("plugin.onReady");
  });

  it("calls onStop hooks during app.close()", async () => {
    let stopCalled = false;

    const plugin = createMockPlugin({
      onStop: async (_app: AppInstance) => {
        stopCalled = true;
      },
    });

    const app = createApp({
      server: createMockServerAdapter(),
      routes: [],
      plugins: [plugin],
    });

    await app.listen(3000);
    await app.close();

    expect(stopCalled).toBe(true);
  });

  it("calls plugin hooks in correct order: onStart → listen → onReady", async () => {
    const callOrder: string[] = [];

    const server = createMockServerAdapter({
      listen: async (_port: number) => {
        callOrder.push("listen");
        return { close: async () => {} };
      },
    });

    const plugin = createMockPlugin({
      onStart: async () => { callOrder.push("onStart"); },
      onReady: async () => { callOrder.push("onReady"); },
      onStop: async () => { callOrder.push("onStop"); },
    });

    const app = createApp({ server, routes: [], plugins: [plugin] });
    await app.listen(3000);
    await app.close();

    expect(callOrder).toEqual(["onStart", "listen", "onReady", "onStop"]);
  });

  it("calls multiple plugin hooks in registration order", async () => {
    const callOrder: string[] = [];

    const pluginA = createMockPlugin({
      name: "plugin-a",
      onStart: async () => { callOrder.push("a.onStart"); },
      onReady: async () => { callOrder.push("a.onReady"); },
    });

    const pluginB = createMockPlugin({
      name: "plugin-b",
      onStart: async () => { callOrder.push("b.onStart"); },
      onReady: async () => { callOrder.push("b.onReady"); },
    });

    const app = createApp({
      server: createMockServerAdapter(),
      routes: [],
      plugins: [pluginA, pluginB],
    });

    await app.listen(3000);

    expect(callOrder).toEqual([
      "a.onStart", "b.onStart",
      "a.onReady", "b.onReady",
    ]);
  });

  it("passes AppInstance to plugin hooks", async () => {
    let receivedApp: AppInstance | undefined;

    const plugin = createMockPlugin({
      onStart: async (app: AppInstance) => {
        receivedApp = app;
      },
    });

    const app = createApp({
      server: createMockServerAdapter(),
      routes: [],
      plugins: [plugin],
    });

    await app.listen(3000);

    expect(receivedApp).toBeDefined();
    expect(receivedApp!.name).toBe("mock-server");
    expect(receivedApp!.plugins).toEqual([plugin]);
    expect(receivedApp!.services).toEqual({});
  });
});

// ─── app.close() ─────────────────────────────────────────────

describe("app.close()", () => {
  it("closes the server handle", async () => {
    let closed = false;
    const server = createMockServerAdapter({
      listen: async () => ({
        close: async () => { closed = true; },
      }),
    });

    const app = createApp({ server, routes: [] });
    await app.listen(3000);
    await app.close();

    expect(closed).toBe(true);
  });

  it("calls onStop before closing the server", async () => {
    const callOrder: string[] = [];

    const server = createMockServerAdapter({
      listen: async () => ({
        close: async () => { callOrder.push("server.close"); },
      }),
    });

    const plugin = createMockPlugin({
      onStop: async () => { callOrder.push("onStop"); },
    });

    const app = createApp({ server, routes: [], plugins: [plugin] });
    await app.listen(3000);
    await app.close();

    expect(callOrder[0]).toBe("onStop");
    expect(callOrder[1]).toBe("server.close");
  });

  it("is safe to call close() without listen()", async () => {
    const app = createApp({
      server: createMockServerAdapter(),
      routes: [],
    });

    // Should not throw
    await app.close();
  });
});

// ─── Error Middleware ────────────────────────────────────────

describe("createErrorMiddleware", () => {
  const dummyReq: TypoKitRequest = {
    method: "GET",
    path: "/",
    headers: {},
    body: undefined,
    query: {},
    params: {},
  };

  const dummyCtx: RequestContext = {
    log: { trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, fatal: () => {} },
    fail: () => { throw new Error("fail"); },
    services: {},
    requestId: "test-id",
  };

  it("passes through successful responses", async () => {
    const mw = createErrorMiddleware();
    const response: TypoKitResponse = {
      status: 200,
      headers: {},
      body: { ok: true },
    };

    const result = await mw(dummyReq, dummyCtx, async () => response);
    expect(result).toBe(response);
  });

  it("catches AppError and serializes to ErrorResponse", async () => {
    const mw = createErrorMiddleware();
    const error = new NotFoundError("USER_NOT_FOUND", "User not found");

    const result = await mw(dummyReq, dummyCtx, async () => {
      throw error;
    });

    expect(result.status).toBe(404);
    expect(result.headers["content-type"]).toBe("application/json");
    const body = result.body as ErrorResponse;
    expect(body.error.code).toBe("USER_NOT_FOUND");
    expect(body.error.message).toBe("User not found");
  });

  it("converts unknown errors to 500 Internal Server Error", async () => {
    const mw = createErrorMiddleware();

    const result = await mw(dummyReq, dummyCtx, async () => {
      throw new Error("something broke");
    });

    expect(result.status).toBe(500);
    expect(result.headers["content-type"]).toBe("application/json");
    const body = result.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe("INTERNAL_SERVER_ERROR");
    expect(body.error.message).toBe("Internal Server Error");
  });
});
