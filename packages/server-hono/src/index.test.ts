// @typokit/server-hono — Integration Tests

import { describe, it, expect } from "@rstest/core";
import { honoServer } from "./index.js";
import type {
  CompiledRouteTable,
  HandlerMap,
  MiddlewareChain,
  TypoKitRequest,
  RawValidatorMap,
  RequestContext,
} from "@typokit/types";
import type { Server } from "node:http";

// ─── Helpers ─────────────────────────────────────────────────

function makeRouteTable(
  overrides?: Partial<CompiledRouteTable>,
): CompiledRouteTable {
  return {
    segment: "",
    children: {
      users: {
        segment: "users",
        handlers: {
          GET: { ref: "users#list", middleware: [] },
          POST: { ref: "users#create", middleware: [] },
        },
        paramChild: {
          segment: ":id",
          paramName: "id",
          handlers: {
            GET: { ref: "users#get", middleware: [] },
          },
        },
      },
      health: {
        segment: "health",
        handlers: {
          GET: { ref: "health#check", middleware: [] },
        },
      },
    },
    ...overrides,
  };
}

function makeHandlerMap(): HandlerMap {
  return {
    "users#list": async () => ({
      status: 200,
      headers: {},
      body: [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
      ],
    }),
    "users#create": async (req: TypoKitRequest) => ({
      status: 201,
      headers: {},
      body: {
        id: 3,
        name: (req.body as Record<string, unknown>)?.name ?? "Unknown",
      },
    }),
    "users#get": async (req: TypoKitRequest) => ({
      status: 200,
      headers: {},
      body: { id: req.params.id, name: "User " + req.params.id },
    }),
    "health#check": async () => ({
      status: 200,
      headers: {},
      body: { status: "ok" },
    }),
  };
}

function emptyMiddlewareChain(): MiddlewareChain {
  return { entries: [] };
}

function getPort(handle: { _server: Server }): number {
  const addr = handle._server.address();
  if (addr && typeof addr === "object") {
    return addr.port;
  }
  throw new Error("Could not get port from server handle");
}

async function fetchJson(
  port: number,
  path: string,
  options?: RequestInit,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options?.headers as Record<string, string> | undefined),
    },
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

// ─── Tests ───────────────────────────────────────────────────

describe("honoServer", () => {
  it("implements ServerAdapter interface with correct name", () => {
    const adapter = honoServer();
    expect(adapter.name).toBe("hono");
    expect(typeof adapter.registerRoutes).toBe("function");
    expect(typeof adapter.listen).toBe("function");
    expect(typeof adapter.normalizeRequest).toBe("function");
    expect(typeof adapter.writeResponse).toBe("function");
    expect(typeof adapter.getNativeServer).toBe("function");
  });

  it("getNativeServer returns the Hono instance", () => {
    const adapter = honoServer();
    const native = adapter.getNativeServer!();
    expect(native).toBeDefined();
    // Hono instances have a .fetch method
    expect(typeof (native as Record<string, unknown>).fetch).toBe("function");
  });

  it("routes GET /health correctly", async () => {
    const adapter = honoServer();
    adapter.registerRoutes(
      makeRouteTable(),
      makeHandlerMap(),
      emptyMiddlewareChain(),
    );
    const handle = (await adapter.listen(0)) as unknown as {
      close(): Promise<void>;
      _server: Server;
    };
    try {
      const port = getPort(handle);

      const { status, body } = await fetchJson(port, "/health");
      expect(status).toBe(200);
      expect((body as Record<string, unknown>).status).toBe("ok");
    } finally {
      await handle.close();
    }
  });

  it("routes GET /users and returns list", async () => {
    const adapter = honoServer();
    adapter.registerRoutes(
      makeRouteTable(),
      makeHandlerMap(),
      emptyMiddlewareChain(),
    );
    const handle = (await adapter.listen(0)) as unknown as {
      close(): Promise<void>;
      _server: Server;
    };
    try {
      const port = getPort(handle);

      const { status, body } = await fetchJson(port, "/users");
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      expect((body as Array<unknown>).length).toBe(2);
    } finally {
      await handle.close();
    }
  });

  it("routes POST /users with body", async () => {
    const adapter = honoServer();
    adapter.registerRoutes(
      makeRouteTable(),
      makeHandlerMap(),
      emptyMiddlewareChain(),
    );
    const handle = (await adapter.listen(0)) as unknown as {
      close(): Promise<void>;
      _server: Server;
    };
    try {
      const port = getPort(handle);

      const { status, body } = await fetchJson(port, "/users", {
        method: "POST",
        body: JSON.stringify({ name: "Charlie" }),
      });
      expect(status).toBe(201);
      expect((body as Record<string, unknown>).name).toBe("Charlie");
    } finally {
      await handle.close();
    }
  });

  it("routes GET /users/:id with params", async () => {
    const adapter = honoServer();
    adapter.registerRoutes(
      makeRouteTable(),
      makeHandlerMap(),
      emptyMiddlewareChain(),
    );
    const handle = (await adapter.listen(0)) as unknown as {
      close(): Promise<void>;
      _server: Server;
    };
    try {
      const port = getPort(handle);

      const { status, body } = await fetchJson(port, "/users/42");
      expect(status).toBe(200);
      expect((body as Record<string, unknown>).id).toBe("42");
      expect((body as Record<string, unknown>).name).toBe("User 42");
    } finally {
      await handle.close();
    }
  });

  it("returns 404 for unknown routes", async () => {
    const adapter = honoServer();
    adapter.registerRoutes(
      makeRouteTable(),
      makeHandlerMap(),
      emptyMiddlewareChain(),
    );
    const handle = (await adapter.listen(0)) as unknown as {
      close(): Promise<void>;
      _server: Server;
    };
    try {
      const port = getPort(handle);

      const res = await fetch(`http://127.0.0.1:${port}/nonexistent`);
      expect(res.status).toBe(404);
    } finally {
      await handle.close();
    }
  });

  it("runs request validation and returns 400 on failure", async () => {
    const routeTable: CompiledRouteTable = {
      segment: "",
      children: {
        items: {
          segment: "items",
          handlers: {
            POST: {
              ref: "items#create",
              middleware: [],
              validators: { body: "items#create.body" },
            },
          },
        },
      },
    };

    const handlerMap: HandlerMap = {
      "items#create": async (req: TypoKitRequest) => ({
        status: 201,
        headers: {},
        body: req.body,
      }),
    };

    const validatorMap: RawValidatorMap = {
      "items#create.body": (input: unknown) => {
        const data = input as Record<string, unknown> | null;
        if (!data || typeof data.title !== "string") {
          return {
            success: false,
            errors: [
              { path: "title", expected: "string", actual: typeof data?.title },
            ],
          };
        }
        return { success: true, data };
      },
    };

    const adapter = honoServer();
    adapter.registerRoutes(
      routeTable,
      handlerMap,
      emptyMiddlewareChain(),
      validatorMap,
    );
    const handle = (await adapter.listen(0)) as unknown as {
      close(): Promise<void>;
      _server: Server;
    };
    try {
      const port = getPort(handle);

      const { status, body } = await fetchJson(port, "/items", {
        method: "POST",
        body: JSON.stringify({ invalid: true }),
      });
      expect(status).toBe(400);
      expect((body as Record<string, unknown>).error).toBeDefined();
    } finally {
      await handle.close();
    }
  });

  it("runs response serialization with custom serializer", async () => {
    const routeTable: CompiledRouteTable = {
      segment: "",
      children: {
        data: {
          segment: "data",
          handlers: {
            GET: {
              ref: "data#get",
              middleware: [],
              serializer: "data#get.response",
            },
          },
        },
      },
    };

    const serializerCalls: unknown[] = [];
    const handlerMap: HandlerMap = {
      "data#get": async () => ({
        status: 200,
        headers: {},
        body: { value: 42 },
      }),
    };

    const adapter = honoServer();
    adapter.registerRoutes(
      routeTable,
      handlerMap,
      emptyMiddlewareChain(),
      undefined,
      {
        "data#get.response": (input: unknown) => {
          serializerCalls.push(input);
          return JSON.stringify(input);
        },
      },
    );
    const handle = (await adapter.listen(0)) as unknown as {
      close(): Promise<void>;
      _server: Server;
    };
    try {
      const port = getPort(handle);

      const { status, body } = await fetchJson(port, "/data");
      expect(status).toBe(200);
      expect((body as Record<string, unknown>).value).toBe(42);
      expect(serializerCalls.length).toBe(1);
    } finally {
      await handle.close();
    }
  });

  it("middleware chain runs before handler", async () => {
    const callOrder: string[] = [];

    const routeTable: CompiledRouteTable = {
      segment: "",
      children: {
        test: {
          segment: "test",
          handlers: {
            GET: { ref: "test#handler", middleware: ["mw1"] },
          },
        },
      },
    };

    const handlerMap: HandlerMap = {
      "test#handler": async (_req: TypoKitRequest, ctx: RequestContext) => {
        callOrder.push("handler");
        return {
          status: 200,
          headers: {},
          body: { requestId: ctx.requestId },
        };
      },
    };

    const middlewareChain: MiddlewareChain = {
      entries: [
        {
          name: "mw1",
          handler: async (_req, _ctx, next) => {
            callOrder.push("middleware");
            return next();
          },
        },
      ],
    };

    const adapter = honoServer();
    adapter.registerRoutes(routeTable, handlerMap, middlewareChain);
    const handle = (await adapter.listen(0)) as unknown as {
      close(): Promise<void>;
      _server: Server;
    };
    try {
      const port = getPort(handle);

      const { status } = await fetchJson(port, "/test");
      expect(status).toBe(200);
      expect(callOrder[0]).toBe("middleware");
      expect(callOrder[1]).toBe("handler");
    } finally {
      await handle.close();
    }
  });

  it("listen on port 0 assigns auto port", async () => {
    const adapter = honoServer();
    adapter.registerRoutes(
      makeRouteTable(),
      makeHandlerMap(),
      emptyMiddlewareChain(),
    );
    const handle = (await adapter.listen(0)) as unknown as {
      close(): Promise<void>;
      _server: Server;
    };
    try {
      const port = getPort(handle);
      expect(port).toBeGreaterThan(0);
    } finally {
      await handle.close();
    }
  });

  it("honoServer accepts options", () => {
    const adapter = honoServer({ basePath: "/api" });
    const native = adapter.getNativeServer!();
    expect(native).toBeDefined();
    expect(typeof (native as Record<string, unknown>).fetch).toBe("function");
  });
});
