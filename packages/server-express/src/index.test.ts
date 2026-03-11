// @typokit/server-express — Integration tests
import { describe, it, expect } from "@rstest/core";
import { expressServer } from "./index.js";
import type {
  CompiledRouteTable,
  HandlerMap,
  MiddlewareChain,
  RawValidatorMap,
  TypoKitRequest,
  TypoKitResponse,
  RequestContext,
  ServerHandle,
} from "@typokit/types";
import type { Server } from "node:http";

// ─── Test Helpers ────────────────────────────────────────────

function makeRouteTable(
  routes: {
    method: string;
    path: string;
    ref: string;
    validators?: { params?: string; query?: string; body?: string };
  }[],
): CompiledRouteTable {
  const root: CompiledRouteTable = {
    segment: "",
    children: {},
  };

  for (const route of routes) {
    const segments = route.path.split("/").filter(Boolean);
    let current: CompiledRouteTable = root;

    for (const seg of segments) {
      if (seg.startsWith(":")) {
        if (!current.paramChild) {
          current.paramChild = {
            segment: seg.slice(1),
            paramName: seg.slice(1),
            children: {},
          };
        }
        current = current.paramChild;
      } else {
        if (!current.children![seg]) {
          current.children![seg] = { segment: seg, children: {} };
        }
        current = current.children![seg];
      }
    }

    if (!current.handlers) {
      current.handlers = {};
    }
    (current.handlers as Record<string, unknown>)[route.method] = {
      ref: route.ref,
      validators: route.validators,
      middleware: [],
    };
  }

  return root;
}

function makeMiddlewareChain(): MiddlewareChain {
  return { entries: [] };
}

async function fetchJson(port: number, path: string, options?: RequestInit) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, options);
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return {
    status: res.status,
    body,
    headers: Object.fromEntries(res.headers.entries()),
  };
}

// ─── Tests ───────────────────────────────────────────────────

describe("expressServer", () => {
  it("creates an adapter with correct name", () => {
    const adapter = expressServer();
    expect(adapter.name).toBe("express");
  });

  it("getNativeServer returns Express app", () => {
    const adapter = expressServer();
    const app = adapter.getNativeServer!();
    expect(app).toBeDefined();
    expect(typeof (app as Record<string, unknown>).use).toBe("function");
  });

  it("normalizeRequest converts Express request shape", () => {
    const adapter = expressServer();
    const mockReq = {
      method: "GET",
      path: "/test",
      headers: { "content-type": "application/json" },
      body: undefined,
      query: { page: "1" },
      params: { id: "42" },
    };
    const normalized = adapter.normalizeRequest(mockReq);
    expect(normalized.method).toBe("GET");
    expect(normalized.path).toBe("/test");
    expect(normalized.params.id).toBe("42");
  });
});

describe("expressServer integration", () => {
  let handle: ServerHandle & { _server?: Server };
  let port: number;

  it("starts server, handles GET, and shuts down", async () => {
    const routeTable = makeRouteTable([
      { method: "GET", path: "/health", ref: "getHealth" },
    ]);

    const handlerMap: HandlerMap = {
      getHealth: async (
        _req: TypoKitRequest,
        _ctx: RequestContext,
      ): Promise<TypoKitResponse> => ({
        status: 200,
        headers: {},
        body: { status: "ok" },
      }),
    };

    const adapter = expressServer();
    adapter.registerRoutes(routeTable, handlerMap, makeMiddlewareChain());
    handle = (await adapter.listen(0)) as ServerHandle & { _server?: Server };

    const addr = handle._server!.address();
    port = typeof addr === "object" && addr !== null ? addr.port : 0;

    const res = await fetchJson(port, "/health");
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).status).toBe("ok");

    await handle.close();
  });

  it("handles POST with JSON body", async () => {
    const routeTable = makeRouteTable([
      { method: "POST", path: "/items", ref: "createItem" },
    ]);

    const handlerMap: HandlerMap = {
      createItem: async (
        req: TypoKitRequest,
        _ctx: RequestContext,
      ): Promise<TypoKitResponse> => ({
        status: 201,
        headers: {},
        body: {
          created: true,
          name: (req.body as Record<string, unknown>)?.name,
        },
      }),
    };

    const adapter = expressServer();
    adapter.registerRoutes(routeTable, handlerMap, makeMiddlewareChain());
    handle = (await adapter.listen(0)) as ServerHandle & { _server?: Server };

    const addr = handle._server!.address();
    port = typeof addr === "object" && addr !== null ? addr.port : 0;

    const res = await fetchJson(port, "/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "test-item" }),
    });
    expect(res.status).toBe(201);
    expect((res.body as Record<string, unknown>).name).toBe("test-item");

    await handle.close();
  });

  it("handles parameterized routes", async () => {
    const routeTable = makeRouteTable([
      { method: "GET", path: "/items/:id", ref: "getItem" },
    ]);

    const handlerMap: HandlerMap = {
      getItem: async (
        req: TypoKitRequest,
        _ctx: RequestContext,
      ): Promise<TypoKitResponse> => ({
        status: 200,
        headers: {},
        body: { id: req.params.id },
      }),
    };

    const adapter = expressServer();
    adapter.registerRoutes(routeTable, handlerMap, makeMiddlewareChain());
    handle = (await adapter.listen(0)) as ServerHandle & { _server?: Server };

    const addr = handle._server!.address();
    port = typeof addr === "object" && addr !== null ? addr.port : 0;

    const res = await fetchJson(port, "/items/abc123");
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).id).toBe("abc123");

    await handle.close();
  });

  it("runs validation and returns 400 on failure", async () => {
    const routeTable = makeRouteTable([
      {
        method: "POST",
        path: "/validated",
        ref: "validatedHandler",
        validators: { body: "validateBody" },
      },
    ]);

    const handlerMap: HandlerMap = {
      validatedHandler: async (
        _req: TypoKitRequest,
        _ctx: RequestContext,
      ): Promise<TypoKitResponse> => ({
        status: 200,
        headers: {},
        body: { ok: true },
      }),
    };

    const validatorMap: RawValidatorMap = {
      validateBody: (data: unknown) => {
        const body = data as Record<string, unknown>;
        if (!body || !body.name) {
          return {
            success: false,
            errors: [{ path: "name", expected: "string", actual: "undefined" }],
          };
        }
        return { success: true };
      },
    };

    const adapter = expressServer();
    adapter.registerRoutes(
      routeTable,
      handlerMap,
      makeMiddlewareChain(),
      validatorMap,
    );
    handle = (await adapter.listen(0)) as ServerHandle & { _server?: Server };

    const addr = handle._server!.address();
    port = typeof addr === "object" && addr !== null ? addr.port : 0;

    // Send invalid body
    const res = await fetchJson(port, "/validated", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = res.body as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");

    await handle.close();
  });

  it("returns 500 for missing handler", async () => {
    const routeTable = makeRouteTable([
      { method: "GET", path: "/missing", ref: "nonExistentHandler" },
    ]);

    const handlerMap: HandlerMap = {};

    const adapter = expressServer();
    adapter.registerRoutes(routeTable, handlerMap, makeMiddlewareChain());
    handle = (await adapter.listen(0)) as ServerHandle & { _server?: Server };

    const addr = handle._server!.address();
    port = typeof addr === "object" && addr !== null ? addr.port : 0;

    const res = await fetchJson(port, "/missing");
    expect(res.status).toBe(500);

    await handle.close();
  });
});
