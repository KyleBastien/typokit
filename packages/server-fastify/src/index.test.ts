// @typokit/server-fastify — Integration Tests

import { describe, it, expect } from "@rstest/core";
import { fastifyServer } from "./index.js";
import type {
  CompiledRouteTable,
  HandlerMap,
  MiddlewareChain,
  TypoKitRequest,
  ValidatorMap,
  RequestContext,
} from "@typokit/types";
import type { FastifyInstance } from "fastify";

// ─── Helpers ─────────────────────────────────────────────────

function makeRouteTable(overrides?: Partial<CompiledRouteTable>): CompiledRouteTable {
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
      body: [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }],
    }),
    "users#create": async (req: TypoKitRequest) => ({
      status: 201,
      headers: {},
      body: { id: 3, name: (req.body as Record<string, unknown>)?.name ?? "Unknown" },
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

// Helper to make HTTP requests to the Fastify-adapted server
async function fetchJson(port: number, path: string, options?: RequestInit): Promise<{ status: number; body: unknown }> {
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

describe("fastifyServer", () => {
  it("implements ServerAdapter interface with correct name", () => {
    const adapter = fastifyServer();
    expect(adapter.name).toBe("fastify");
    expect(typeof adapter.registerRoutes).toBe("function");
    expect(typeof adapter.listen).toBe("function");
    expect(typeof adapter.normalizeRequest).toBe("function");
    expect(typeof adapter.writeResponse).toBe("function");
    expect(typeof adapter.getNativeServer).toBe("function");
  });

  it("getNativeServer returns the Fastify instance", () => {
    const adapter = fastifyServer();
    const native = adapter.getNativeServer!();
    expect(native).toBeDefined();
    // Fastify instances have a .route method
    expect(typeof (native as Record<string, unknown>).route).toBe("function");
  });

  it("routes GET /health correctly", async () => {
    const adapter = fastifyServer({ logger: false });
    adapter.registerRoutes(makeRouteTable(), makeHandlerMap(), emptyMiddlewareChain());
    const handle = await adapter.listen(0);
    try {
      const native = adapter.getNativeServer!() as FastifyInstance;
      const addr = native.addresses()[0];
      const port = addr.port;

      const { status, body } = await fetchJson(port, "/health");
      expect(status).toBe(200);
      expect((body as Record<string, unknown>).status).toBe("ok");
    } finally {
      await handle.close();
    }
  });

  it("routes GET /users and returns list", async () => {
    const adapter = fastifyServer({ logger: false });
    adapter.registerRoutes(makeRouteTable(), makeHandlerMap(), emptyMiddlewareChain());
    const handle = await adapter.listen(0);
    try {
      const native = adapter.getNativeServer!() as FastifyInstance;
      const port = native.addresses()[0].port;

      const { status, body } = await fetchJson(port, "/users");
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      expect((body as Array<unknown>).length).toBe(2);
    } finally {
      await handle.close();
    }
  });

  it("routes POST /users with body", async () => {
    const adapter = fastifyServer({ logger: false });
    adapter.registerRoutes(makeRouteTable(), makeHandlerMap(), emptyMiddlewareChain());
    const handle = await adapter.listen(0);
    try {
      const native = adapter.getNativeServer!() as FastifyInstance;
      const port = native.addresses()[0].port;

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
    const adapter = fastifyServer({ logger: false });
    adapter.registerRoutes(makeRouteTable(), makeHandlerMap(), emptyMiddlewareChain());
    const handle = await adapter.listen(0);
    try {
      const native = adapter.getNativeServer!() as FastifyInstance;
      const port = native.addresses()[0].port;

      const { status, body } = await fetchJson(port, "/users/42");
      expect(status).toBe(200);
      expect((body as Record<string, unknown>).id).toBe("42");
      expect((body as Record<string, unknown>).name).toBe("User 42");
    } finally {
      await handle.close();
    }
  });

  it("returns 404 for unknown routes", async () => {
    const adapter = fastifyServer({ logger: false });
    adapter.registerRoutes(makeRouteTable(), makeHandlerMap(), emptyMiddlewareChain());
    const handle = await adapter.listen(0);
    try {
      const native = adapter.getNativeServer!() as FastifyInstance;
      const port = native.addresses()[0].port;

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

    const validatorMap: ValidatorMap = {
      "items#create.body": (input: unknown) => {
        const data = input as Record<string, unknown> | null;
        if (!data || typeof data.title !== "string") {
          return {
            success: false,
            errors: [{ path: "title", expected: "string", actual: typeof data?.title }],
          };
        }
        return { success: true, data };
      },
    };

    const adapter = fastifyServer({ logger: false });
    adapter.registerRoutes(routeTable, handlerMap, emptyMiddlewareChain(), validatorMap);
    const handle = await adapter.listen(0);
    try {
      const native = adapter.getNativeServer!() as FastifyInstance;
      const port = native.addresses()[0].port;

      // Send invalid body (missing title)
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

    const adapter = fastifyServer({ logger: false });
    adapter.registerRoutes(routeTable, handlerMap, emptyMiddlewareChain(), undefined, {
      "data#get.response": (input: unknown) => {
        serializerCalls.push(input);
        return JSON.stringify(input);
      },
    });
    const handle = await adapter.listen(0);
    try {
      const native = adapter.getNativeServer!() as FastifyInstance;
      const port = native.addresses()[0].port;

      const { status, body } = await fetchJson(port, "/data");
      expect(status).toBe(200);
      expect((body as Record<string, unknown>).value).toBe(42);
      expect(serializerCalls.length).toBe(1);
    } finally {
      await handle.close();
    }
  });

  it("options are passed to Fastify constructor", () => {
    const adapter = fastifyServer({ logger: false, maxParamLength: 200 });
    const native = adapter.getNativeServer!() as FastifyInstance;
    // Verify the instance was created (basic check)
    expect(native).toBeDefined();
    expect(typeof native.listen).toBe("function");
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

    const adapter = fastifyServer({ logger: false });
    adapter.registerRoutes(routeTable, handlerMap, middlewareChain);
    const handle = await adapter.listen(0);
    try {
      const native = adapter.getNativeServer!() as FastifyInstance;
      const port = native.addresses()[0].port;

      const { status } = await fetchJson(port, "/test");
      expect(status).toBe(200);
      expect(callOrder[0]).toBe("middleware");
      expect(callOrder[1]).toBe("handler");
    } finally {
      await handle.close();
    }
  });

  it("listen on port 0 assigns auto port", async () => {
    const adapter = fastifyServer({ logger: false });
    adapter.registerRoutes(makeRouteTable(), makeHandlerMap(), emptyMiddlewareChain());
    const handle = await adapter.listen(0);
    try {
      const native = adapter.getNativeServer!() as FastifyInstance;
      const port = native.addresses()[0].port;
      expect(port).toBeGreaterThan(0);
    } finally {
      await handle.close();
    }
  });
});
