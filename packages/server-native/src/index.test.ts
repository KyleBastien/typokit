// @typokit/server-native — Integration Tests

import { describe, it, expect } from "@rstest/core";
import type {
  CompiledRoute,
  CompiledRouteTable,
  HandlerMap,
  MiddlewareChain,
  TypoKitRequest,
} from "@typokit/types";
import type { Server } from "node:http";
import { nativeServer } from "./index.js";

// ─── Test Helpers ────────────────────────────────────────────

function makeRouteTable(): CompiledRouteTable {
  // Route tree:
  //   /           -> GET
  //   /users      -> GET, POST
  //   /users/:id  -> GET, PUT, DELETE
  //   /posts/:id/comments -> GET
  const root: CompiledRoute = {
    segment: "",
    handlers: {
      GET: { ref: "root#index", middleware: [] },
    },
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
            PUT: { ref: "users#update", middleware: [] },
            DELETE: { ref: "users#delete", middleware: [] },
          },
        },
      },
      posts: {
        segment: "posts",
        paramChild: {
          segment: ":id",
          paramName: "id",
          children: {
            comments: {
              segment: "comments",
              handlers: {
                GET: { ref: "comments#list", middleware: [] },
              },
            },
          },
        },
      },
    },
  };
  return root;
}

function makeHandlerMap(): HandlerMap {
  return {
    "root#index": async () => ({
      status: 200,
      headers: {},
      body: { message: "Welcome" },
    }),
    "users#list": async () => ({
      status: 200,
      headers: {},
      body: { users: [] },
    }),
    "users#create": async (req: TypoKitRequest) => ({
      status: 201,
      headers: {},
      body: { created: true, data: req.body },
    }),
    "users#get": async (req: TypoKitRequest) => ({
      status: 200,
      headers: {},
      body: { id: req.params.id },
    }),
    "users#update": async (req: TypoKitRequest) => ({
      status: 200,
      headers: {},
      body: { updated: req.params.id, data: req.body },
    }),
    "users#delete": async (_req: TypoKitRequest) => ({
      status: 204,
      headers: {},
      body: null,
    }),
    "comments#list": async (req: TypoKitRequest) => ({
      status: 200,
      headers: {},
      body: { postId: req.params.id, comments: [] },
    }),
  };
}

const emptyMiddleware: MiddlewareChain = { entries: [] };

async function fetchJson(port: number, path: string, options: { method?: string; body?: unknown } = {}): Promise<{ status: number; headers: Record<string, string>; body: unknown }> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {};
  let bodyStr: string | undefined;

  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
    bodyStr = JSON.stringify(options.body);
  }

  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers,
    body: bodyStr,
  });

  const resHeaders: Record<string, string> = {};
  res.headers.forEach((v, k) => { resHeaders[k] = v; });

  let body: unknown;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    body = await res.json();
  } else {
    const text = await res.text();
    body = text || null;
  }

  return { status: res.status, headers: resHeaders, body };
}

// ─── Tests ───────────────────────────────────────────────────

describe("nativeServer", () => {
  it("creates a server adapter with correct name", () => {
    const adapter = nativeServer();
    expect(adapter.name).toBe("native");
  });

  it("implements the ServerAdapter interface", () => {
    const adapter = nativeServer();
    expect(typeof adapter.registerRoutes).toBe("function");
    expect(typeof adapter.listen).toBe("function");
    expect(typeof adapter.normalizeRequest).toBe("function");
    expect(typeof adapter.writeResponse).toBe("function");
    expect(typeof adapter.getNativeServer).toBe("function");
  });
});

describe("nativeServer integration", () => {
  it("routes GET / to root handler", async () => {
    const adapter = nativeServer();
    adapter.registerRoutes(makeRouteTable(), makeHandlerMap(), emptyMiddleware);
    const handle = await adapter.listen(0);
    try {
      const server = adapter.getNativeServer!() as Server;
      const addr = server.address() as { port: number };
      const res = await fetchJson(addr.port, "/");
      expect(res.status).toBe(200);
      expect((res.body as Record<string, unknown>).message).toBe("Welcome");
    } finally {
      await handle.close();
    }
  });

  it("routes GET /users to list handler", async () => {
    const adapter = nativeServer();
    adapter.registerRoutes(makeRouteTable(), makeHandlerMap(), emptyMiddleware);
    const handle = await adapter.listen(0);
    try {
      const server = adapter.getNativeServer!() as Server;
      const addr = server.address() as { port: number };
      const res = await fetchJson(addr.port, "/users");
      expect(res.status).toBe(200);
      expect((res.body as Record<string, unknown>).users).toEqual([]);
    } finally {
      await handle.close();
    }
  });

  it("extracts route params from /users/:id", async () => {
    const adapter = nativeServer();
    adapter.registerRoutes(makeRouteTable(), makeHandlerMap(), emptyMiddleware);
    const handle = await adapter.listen(0);
    try {
      const server = adapter.getNativeServer!() as Server;
      const addr = server.address() as { port: number };
      const res = await fetchJson(addr.port, "/users/42");
      expect(res.status).toBe(200);
      expect((res.body as Record<string, unknown>).id).toBe("42");
    } finally {
      await handle.close();
    }
  });

  it("handles POST /users with body", async () => {
    const adapter = nativeServer();
    adapter.registerRoutes(makeRouteTable(), makeHandlerMap(), emptyMiddleware);
    const handle = await adapter.listen(0);
    try {
      const server = adapter.getNativeServer!() as Server;
      const addr = server.address() as { port: number };
      const res = await fetchJson(addr.port, "/users", {
        method: "POST",
        body: { name: "Alice" },
      });
      expect(res.status).toBe(201);
      const b = res.body as Record<string, unknown>;
      expect(b.created).toBe(true);
      expect((b.data as Record<string, unknown>).name).toBe("Alice");
    } finally {
      await handle.close();
    }
  });

  it("handles nested param routes: /posts/:id/comments", async () => {
    const adapter = nativeServer();
    adapter.registerRoutes(makeRouteTable(), makeHandlerMap(), emptyMiddleware);
    const handle = await adapter.listen(0);
    try {
      const server = adapter.getNativeServer!() as Server;
      const addr = server.address() as { port: number };
      const res = await fetchJson(addr.port, "/posts/99/comments");
      expect(res.status).toBe(200);
      const b = res.body as Record<string, unknown>;
      expect(b.postId).toBe("99");
      expect(b.comments).toEqual([]);
    } finally {
      await handle.close();
    }
  });

  it("returns 404 for unknown routes", async () => {
    const adapter = nativeServer();
    adapter.registerRoutes(makeRouteTable(), makeHandlerMap(), emptyMiddleware);
    const handle = await adapter.listen(0);
    try {
      const server = adapter.getNativeServer!() as Server;
      const addr = server.address() as { port: number };
      const res = await fetchJson(addr.port, "/nonexistent");
      expect(res.status).toBe(404);
      expect((res.body as Record<string, unknown>).error).toBe("Not Found");
    } finally {
      await handle.close();
    }
  });

  it("returns 405 with Allow header for wrong method", async () => {
    const adapter = nativeServer();
    adapter.registerRoutes(makeRouteTable(), makeHandlerMap(), emptyMiddleware);
    const handle = await adapter.listen(0);
    try {
      const server = adapter.getNativeServer!() as Server;
      const addr = server.address() as { port: number };
      const res = await fetchJson(addr.port, "/users", { method: "PATCH" });
      expect(res.status).toBe(405);
      expect(res.headers["allow"]).toBeDefined();
      expect(res.headers["allow"]).toContain("GET");
      expect(res.headers["allow"]).toContain("POST");
    } finally {
      await handle.close();
    }
  });

  it("normalizes trailing slashes: /users/ matches /users", async () => {
    const adapter = nativeServer();
    adapter.registerRoutes(makeRouteTable(), makeHandlerMap(), emptyMiddleware);
    const handle = await adapter.listen(0);
    try {
      const server = adapter.getNativeServer!() as Server;
      const addr = server.address() as { port: number };
      const res = await fetchJson(addr.port, "/users/");
      expect(res.status).toBe(200);
      expect((res.body as Record<string, unknown>).users).toEqual([]);
    } finally {
      await handle.close();
    }
  });

  it("getNativeServer returns the underlying http.Server", async () => {
    const adapter = nativeServer();
    adapter.registerRoutes(makeRouteTable(), makeHandlerMap(), emptyMiddleware);
    const handle = await adapter.listen(0);
    try {
      const server = adapter.getNativeServer!();
      expect(server).toBeDefined();
      expect(typeof (server as Record<string, unknown>).listen).toBe("function");
    } finally {
      await handle.close();
    }
  });

  it("normalizeRequest creates TypoKitRequest from raw object", () => {
    const adapter = nativeServer();
    const raw = {
      method: "GET" as const,
      path: "/test",
      headers: { "x-foo": "bar" },
      body: null,
      query: { q: "hello" },
      params: { id: "1" },
    };
    const req = adapter.normalizeRequest(raw);
    expect(req.method).toBe("GET");
    expect(req.path).toBe("/test");
    expect(req.headers["x-foo"]).toBe("bar");
    expect(req.query.q).toBe("hello");
    expect(req.params.id).toBe("1");
  });

  it("handles DELETE /users/:id", async () => {
    const adapter = nativeServer();
    adapter.registerRoutes(makeRouteTable(), makeHandlerMap(), emptyMiddleware);
    const handle = await adapter.listen(0);
    try {
      const server = adapter.getNativeServer!() as Server;
      const addr = server.address() as { port: number };
      const res = await fetchJson(addr.port, "/users/5", { method: "DELETE" });
      expect(res.status).toBe(204);
    } finally {
      await handle.close();
    }
  });

  it("handles PUT /users/:id with body", async () => {
    const adapter = nativeServer();
    adapter.registerRoutes(makeRouteTable(), makeHandlerMap(), emptyMiddleware);
    const handle = await adapter.listen(0);
    try {
      const server = adapter.getNativeServer!() as Server;
      const addr = server.address() as { port: number };
      const res = await fetchJson(addr.port, "/users/7", {
        method: "PUT",
        body: { name: "Updated" },
      });
      expect(res.status).toBe(200);
      const b = res.body as Record<string, unknown>;
      expect(b.updated).toBe("7");
      expect((b.data as Record<string, unknown>).name).toBe("Updated");
    } finally {
      await handle.close();
    }
  });
});
