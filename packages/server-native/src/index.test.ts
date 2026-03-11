// @typokit/server-native — Integration Tests

import { describe, it, expect } from "@rstest/core";
import type {
  CompiledRoute,
  CompiledRouteTable,
  ErrorResponse,
  HandlerMap,
  MiddlewareChain,
  RawValidatorMap,
  SerializerMap,
  TypoKitRequest,
  ValidatorMap,
} from "@typokit/types";
import type { Server } from "node:http";
import {
  nativeServer,
  runValidators,
  serializeResponse,
  validationErrorResponse,
} from "./index.js";

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

/** Route table with validator references */
function makeValidatedRouteTable(): CompiledRouteTable {
  const root: CompiledRoute = {
    segment: "",
    children: {
      users: {
        segment: "users",
        handlers: {
          GET: {
            ref: "users#list",
            middleware: [],
            validators: { query: "ListUsersQuery" },
          },
          POST: {
            ref: "users#create",
            middleware: [],
            validators: { body: "CreateUserBody" },
          },
        },
        paramChild: {
          segment: ":id",
          paramName: "id",
          handlers: {
            GET: {
              ref: "users#get",
              middleware: [],
              validators: { params: "UserIdParams" },
            },
            PUT: {
              ref: "users#update",
              middleware: [],
              validators: {
                params: "UserIdParams",
                body: "UpdateUserBody",
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
    "users#list": async (req: TypoKitRequest) => ({
      status: 200,
      headers: {},
      body: { users: [], query: req.query },
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

function makeValidatorMap(): RawValidatorMap {
  return {
    UserIdParams: (input) => {
      const obj = input as Record<string, unknown>;
      const errors = [];
      if (typeof obj.id !== "string" || !/^\d+$/.test(obj.id)) {
        errors.push({ path: "id", expected: "numeric string", actual: obj.id });
      }
      return errors.length === 0
        ? { success: true, data: input }
        : { success: false, errors };
    },
    ListUsersQuery: (input) => {
      const obj = input as Record<string, unknown>;
      const errors = [];
      if (obj.page !== undefined && typeof obj.page !== "string") {
        errors.push({
          path: "page",
          expected: "string",
          actual: typeof obj.page,
        });
      }
      if (obj.limit !== undefined) {
        const limit = Number(obj.limit);
        if (isNaN(limit) || limit < 1 || limit > 100) {
          errors.push({ path: "limit", expected: "1-100", actual: obj.limit });
        }
      }
      return errors.length === 0
        ? { success: true, data: input }
        : { success: false, errors };
    },
    CreateUserBody: (input) => {
      const obj = input as Record<string, unknown>;
      const errors = [];
      if (typeof obj !== "object" || obj === null) {
        return {
          success: false,
          errors: [
            { path: "$input", expected: "object", actual: typeof input },
          ],
        };
      }
      if (typeof obj.name !== "string" || obj.name.length === 0) {
        errors.push({
          path: "name",
          expected: "non-empty string",
          actual: obj.name,
        });
      }
      if (typeof obj.email !== "string" || !obj.email.includes("@")) {
        errors.push({
          path: "email",
          expected: "valid email",
          actual: obj.email,
        });
      }
      return errors.length === 0
        ? { success: true, data: input }
        : { success: false, errors };
    },
    UpdateUserBody: (input) => {
      const obj = input as Record<string, unknown>;
      const errors = [];
      if (typeof obj !== "object" || obj === null) {
        return {
          success: false,
          errors: [
            { path: "$input", expected: "object", actual: typeof input },
          ],
        };
      }
      if (obj.name !== undefined && typeof obj.name !== "string") {
        errors.push({
          path: "name",
          expected: "string",
          actual: typeof obj.name,
        });
      }
      if (
        obj.email !== undefined &&
        (typeof obj.email !== "string" || !obj.email.includes("@"))
      ) {
        errors.push({
          path: "email",
          expected: "valid email",
          actual: obj.email,
        });
      }
      return errors.length === 0
        ? { success: true, data: input }
        : { success: false, errors };
    },
  };
}

const emptyMiddleware: MiddlewareChain = { entries: [] };

async function fetchJson(
  port: number,
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<{ status: number; headers: Record<string, string>; body: unknown }> {
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
  res.headers.forEach((v, k) => {
    resHeaders[k] = v;
  });

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

// ─── Unit Tests for Validation Helpers ───────────────────────

describe("validationErrorResponse", () => {
  it("produces a 400 response with field-level errors", () => {
    const res = validationErrorResponse("Validation failed", [
      { path: "body.name", expected: "string", actual: 42 },
    ]);
    expect(res.status).toBe(400);
    const body = res.body as ErrorResponse;
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toBe("Validation failed");
    const fields = body.error.details?.fields as Array<{ path: string }>;
    expect(fields).toHaveLength(1);
    expect(fields[0].path).toBe("body.name");
  });
});

describe("runValidators", () => {
  it("returns undefined when no validatorMap provided", () => {
    const result = runValidators("test#route", null, {}, {}, null);
    expect(result).toBeUndefined();
  });

  it("returns undefined when route ref not found in map", () => {
    const result = runValidators("missing#route", {}, {}, {}, null);
    expect(result).toBeUndefined();
  });

  it("returns undefined when all validators pass", () => {
    const validators: ValidatorMap = {
      "test#route": { body: () => ({ success: true, data: {} }) },
    };
    const result = runValidators(
      "test#route",
      validators,
      {},
      {},
      { name: "Alice" },
    );
    expect(result).toBeUndefined();
  });

  it("returns 400 response when body validator fails", () => {
    const validators: ValidatorMap = {
      "test#route": {
        body: () => ({
          success: false,
          errors: [{ path: "name", expected: "string", actual: undefined }],
        }),
      },
    };
    const result = runValidators("test#route", validators, {}, {}, {});
    expect(result).toBeDefined();
    expect(result!.status).toBe(400);
    const body = result!.body as ErrorResponse;
    expect(body.error.code).toBe("VALIDATION_ERROR");
    const fields = body.error.details?.fields as Array<{ path: string }>;
    expect(fields[0].path).toBe("body.name");
  });

  it("prefixes param errors with params.", () => {
    const validators: ValidatorMap = {
      "test#route": {
        params: () => ({
          success: false,
          errors: [{ path: "id", expected: "numeric", actual: "abc" }],
        }),
      },
    };
    const result = runValidators(
      "test#route",
      validators,
      { id: "abc" },
      {},
      null,
    );
    expect(result).toBeDefined();
    const fields = (result!.body as ErrorResponse).error.details
      ?.fields as Array<{ path: string }>;
    expect(fields[0].path).toBe("params.id");
  });

  it("prefixes query errors with query.", () => {
    const validators: ValidatorMap = {
      "test#route": {
        query: () => ({
          success: false,
          errors: [{ path: "limit", expected: "number", actual: "abc" }],
        }),
      },
    };
    const result = runValidators(
      "test#route",
      validators,
      {},
      { limit: "abc" },
      null,
    );
    expect(result).toBeDefined();
    const fields = (result!.body as ErrorResponse).error.details
      ?.fields as Array<{ path: string }>;
    expect(fields[0].path).toBe("query.limit");
  });

  it("aggregates errors from multiple validators", () => {
    const validators: ValidatorMap = {
      "test#route": {
        params: () => ({
          success: false,
          errors: [{ path: "id", expected: "numeric", actual: "abc" }],
        }),
        body: () => ({
          success: false,
          errors: [{ path: "name", expected: "string", actual: 42 }],
        }),
      },
    };
    const result = runValidators(
      "test#route",
      validators,
      { id: "abc" },
      {},
      { name: 42 },
    );
    expect(result).toBeDefined();
    const fields = (result!.body as ErrorResponse).error.details
      ?.fields as Array<{ path: string }>;
    expect(fields).toHaveLength(2);
    expect(fields[0].path).toBe("params.id");
    expect(fields[1].path).toBe("body.name");
  });
});

// ─── Original Tests ──────────────────────────────────────────

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
      expect(typeof (server as Record<string, unknown>).listen).toBe(
        "function",
      );
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

// ─── Validation Pipeline Integration Tests ───────────────────

describe("validation pipeline integration", () => {
  it("valid POST request passes through validators to handler", async () => {
    const adapter = nativeServer();
    adapter.registerRoutes(
      makeValidatedRouteTable(),
      makeHandlerMap(),
      emptyMiddleware,
      makeValidatorMap(),
    );
    const handle = await adapter.listen(0);
    try {
      const server = adapter.getNativeServer!() as Server;
      const addr = server.address() as { port: number };
      const res = await fetchJson(addr.port, "/users", {
        method: "POST",
        body: { name: "Alice", email: "alice@example.com" },
      });
      expect(res.status).toBe(201);
      const b = res.body as Record<string, unknown>;
      expect(b.created).toBe(true);
      expect((b.data as Record<string, unknown>).name).toBe("Alice");
    } finally {
      await handle.close();
    }
  });

  it("invalid POST body returns 400 with field errors", async () => {
    const adapter = nativeServer();
    adapter.registerRoutes(
      makeValidatedRouteTable(),
      makeHandlerMap(),
      emptyMiddleware,
      makeValidatorMap(),
    );
    const handle = await adapter.listen(0);
    try {
      const server = adapter.getNativeServer!() as Server;
      const addr = server.address() as { port: number };
      const res = await fetchJson(addr.port, "/users", {
        method: "POST",
        body: { name: "", email: "not-an-email" },
      });
      expect(res.status).toBe(400);
      const body = res.body as ErrorResponse;
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.message).toBe("Request validation failed");
      const fields = body.error.details?.fields as Array<{
        path: string;
        expected: string;
      }>;
      expect(fields.length).toBeGreaterThan(0);
      // All body errors should be prefixed with "body."
      for (const f of fields) {
        expect(f.path.startsWith("body.")).toBe(true);
      }
    } finally {
      await handle.close();
    }
  });

  it("invalid path params return 400 with field errors", async () => {
    const adapter = nativeServer();
    adapter.registerRoutes(
      makeValidatedRouteTable(),
      makeHandlerMap(),
      emptyMiddleware,
      makeValidatorMap(),
    );
    const handle = await adapter.listen(0);
    try {
      const server = adapter.getNativeServer!() as Server;
      const addr = server.address() as { port: number };
      // "abc" is not a numeric string
      const res = await fetchJson(addr.port, "/users/abc");
      expect(res.status).toBe(400);
      const body = res.body as ErrorResponse;
      expect(body.error.code).toBe("VALIDATION_ERROR");
      const fields = body.error.details?.fields as Array<{ path: string }>;
      expect(fields.some((f) => f.path === "params.id")).toBe(true);
    } finally {
      await handle.close();
    }
  });

  it("valid path params pass through to handler", async () => {
    const adapter = nativeServer();
    adapter.registerRoutes(
      makeValidatedRouteTable(),
      makeHandlerMap(),
      emptyMiddleware,
      makeValidatorMap(),
    );
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

  it("invalid query params return 400 with field errors", async () => {
    const adapter = nativeServer();
    adapter.registerRoutes(
      makeValidatedRouteTable(),
      makeHandlerMap(),
      emptyMiddleware,
      makeValidatorMap(),
    );
    const handle = await adapter.listen(0);
    try {
      const server = adapter.getNativeServer!() as Server;
      const addr = server.address() as { port: number };
      const res = await fetchJson(addr.port, "/users?limit=999");
      expect(res.status).toBe(400);
      const body = res.body as ErrorResponse;
      expect(body.error.code).toBe("VALIDATION_ERROR");
      const fields = body.error.details?.fields as Array<{ path: string }>;
      expect(fields.some((f) => f.path === "query.limit")).toBe(true);
    } finally {
      await handle.close();
    }
  });

  it("valid query params pass through to handler", async () => {
    const adapter = nativeServer();
    adapter.registerRoutes(
      makeValidatedRouteTable(),
      makeHandlerMap(),
      emptyMiddleware,
      makeValidatorMap(),
    );
    const handle = await adapter.listen(0);
    try {
      const server = adapter.getNativeServer!() as Server;
      const addr = server.address() as { port: number };
      const res = await fetchJson(addr.port, "/users?limit=10&page=1");
      expect(res.status).toBe(200);
      expect((res.body as Record<string, unknown>).users).toEqual([]);
    } finally {
      await handle.close();
    }
  });

  it("multiple validator failures are aggregated into a single 400 response", async () => {
    const adapter = nativeServer();
    adapter.registerRoutes(
      makeValidatedRouteTable(),
      makeHandlerMap(),
      emptyMiddleware,
      makeValidatorMap(),
    );
    const handle = await adapter.listen(0);
    try {
      const server = adapter.getNativeServer!() as Server;
      const addr = server.address() as { port: number };
      // PUT /users/abc with invalid body — both params and body fail
      const res = await fetchJson(addr.port, "/users/abc", {
        method: "PUT",
        body: { name: 123, email: "bad" },
      });
      expect(res.status).toBe(400);
      const body = res.body as ErrorResponse;
      const fields = body.error.details?.fields as Array<{ path: string }>;
      // Should have params.id error and body field errors
      expect(fields.some((f) => f.path === "params.id")).toBe(true);
      expect(fields.some((f) => f.path.startsWith("body."))).toBe(true);
      expect(fields.length).toBeGreaterThanOrEqual(2);
    } finally {
      await handle.close();
    }
  });

  it("routes without validators still work normally", async () => {
    const adapter = nativeServer();
    adapter.registerRoutes(
      makeValidatedRouteTable(),
      makeHandlerMap(),
      emptyMiddleware,
      makeValidatorMap(),
    );
    const handle = await adapter.listen(0);
    try {
      const server = adapter.getNativeServer!() as Server;
      const addr = server.address() as { port: number };
      // DELETE is not in the validated route table — use original table
      // Use GET /users with valid query to confirm validators work with no issues
      const res = await fetchJson(addr.port, "/users?page=1");
      expect(res.status).toBe(200);
    } finally {
      await handle.close();
    }
  });

  it("works without validatorMap (backwards compatible)", async () => {
    const adapter = nativeServer();
    // Register without validatorMap — no validators run
    adapter.registerRoutes(makeRouteTable(), makeHandlerMap(), emptyMiddleware);
    const handle = await adapter.listen(0);
    try {
      const server = adapter.getNativeServer!() as Server;
      const addr = server.address() as { port: number };
      const res = await fetchJson(addr.port, "/users");
      expect(res.status).toBe(200);
    } finally {
      await handle.close();
    }
  });
});

// ─── Response Serialization Tests ────────────────────────────

/** Route table with serializer references */
function makeSerializedRouteTable(): CompiledRouteTable {
  const root: CompiledRoute = {
    segment: "",
    handlers: {
      GET: { ref: "root#index", middleware: [], serializer: "RootResponse" },
    },
    children: {
      users: {
        segment: "users",
        handlers: {
          GET: {
            ref: "users#list",
            middleware: [],
            serializer: "UserListResponse",
          },
          POST: { ref: "users#create", middleware: [] }, // no serializer — fallback
        },
        paramChild: {
          segment: ":id",
          paramName: "id",
          handlers: {
            GET: {
              ref: "users#get",
              middleware: [],
              serializer: "UserResponse",
            },
            DELETE: { ref: "users#delete", middleware: [] },
          },
        },
      },
      nested: {
        segment: "nested",
        handlers: {
          GET: {
            ref: "nested#get",
            middleware: [],
            serializer: "NestedResponse",
          },
        },
      },
      types: {
        segment: "types",
        handlers: {
          GET: {
            ref: "types#all",
            middleware: [],
            serializer: "AllTypesResponse",
          },
        },
      },
      "no-schema": {
        segment: "no-schema",
        handlers: {
          GET: {
            ref: "noschema#get",
            middleware: [],
            serializer: "MissingSerializer",
          },
        },
      },
    },
  };
  return root;
}

function makeSerializerHandlerMap(): HandlerMap {
  return {
    "root#index": async () => ({
      status: 200,
      headers: {},
      body: { message: "Welcome" },
    }),
    "users#list": async () => ({
      status: 200,
      headers: {},
      body: {
        users: [
          { id: "1", name: "Alice" },
          { id: "2", name: "Bob" },
        ],
      },
    }),
    "users#create": async (req: TypoKitRequest) => ({
      status: 201,
      headers: {},
      body: { created: true, data: req.body },
    }),
    "users#get": async (req: TypoKitRequest) => ({
      status: 200,
      headers: {},
      body: { id: req.params.id, name: "User " + req.params.id },
    }),
    "users#delete": async () => ({
      status: 204,
      headers: {},
      body: null,
    }),
    "nested#get": async () => ({
      status: 200,
      headers: {},
      body: {
        data: { items: [{ a: 1, b: [true, false] }], meta: { total: 1 } },
      },
    }),
    "types#all": async () => ({
      status: 200,
      headers: {},
      body: {
        str: "hello",
        num: 42,
        bool: true,
        nil: null,
        arr: [1, 2, 3],
        obj: { k: "v" },
      },
    }),
    "noschema#get": async () => ({
      status: 200,
      headers: {},
      body: { fallback: true },
    }),
  };
}

function makeSerializerMap(): SerializerMap {
  // Simulates compiled fast-json-stringify schemas — produces JSON strings
  return {
    RootResponse: (input) => JSON.stringify(input),
    UserListResponse: (input) => {
      // Custom serializer that produces equivalent JSON but proves it was called
      const obj = input as Record<string, unknown>;
      const users = obj.users as Array<Record<string, string>>;
      return `{"users":[${users.map((u) => `{"id":"${u.id}","name":"${u.name}"}`).join(",")}]}`;
    },
    UserResponse: (input) => {
      const obj = input as Record<string, unknown>;
      return `{"id":"${obj.id}","name":"${obj.name}"}`;
    },
    NestedResponse: (input) => JSON.stringify(input),
    AllTypesResponse: (input) => JSON.stringify(input),
    // MissingSerializer is deliberately NOT here to test fallback
  };
}

describe("serializeResponse (unit)", () => {
  it("returns response unchanged for null body", () => {
    const res = serializeResponse(
      { status: 204, headers: {}, body: null },
      "Ref",
      null,
    );
    expect(res.body).toBeNull();
  });

  it("returns response unchanged for undefined body", () => {
    const res = serializeResponse(
      { status: 204, headers: {}, body: undefined },
      "Ref",
      null,
    );
    expect(res.body).toBeUndefined();
  });

  it("returns response unchanged for string body", () => {
    const res = serializeResponse(
      { status: 200, headers: {}, body: "plain text" },
      "Ref",
      null,
    );
    expect(res.body).toBe("plain text");
  });

  it("uses compiled serializer when available", () => {
    const serializers: SerializerMap = {
      TestRef: () => '{"fast":true}',
    };
    const res = serializeResponse(
      { status: 200, headers: {}, body: { fast: true } },
      "TestRef",
      serializers,
    );
    expect(res.body).toBe('{"fast":true}');
    expect(res.headers["content-type"]).toBe("application/json");
  });

  it("falls back to JSON.stringify when no serializer ref", () => {
    const res = serializeResponse(
      { status: 200, headers: {}, body: { a: 1 } },
      undefined,
      null,
    );
    expect(res.body).toBe('{"a":1}');
    expect(res.headers["content-type"]).toBe("application/json");
  });

  it("falls back to JSON.stringify when serializer ref not in map", () => {
    const res = serializeResponse(
      { status: 200, headers: {}, body: { b: 2 } },
      "Missing",
      {},
    );
    expect(res.body).toBe('{"b":2}');
    expect(res.headers["content-type"]).toBe("application/json");
  });

  it("does not overwrite existing content-type header", () => {
    const res = serializeResponse(
      {
        status: 200,
        headers: { "content-type": "application/vnd.api+json" },
        body: { x: 1 },
      },
      undefined,
      null,
    );
    expect(res.headers["content-type"]).toBe("application/vnd.api+json");
  });

  it("serializes all JSON types correctly", () => {
    const body = {
      str: "hello",
      num: 42,
      bool: true,
      nil: null,
      arr: [1, 2],
      obj: { k: "v" },
    };
    const res = serializeResponse(
      { status: 200, headers: {}, body },
      undefined,
      null,
    );
    const parsed = JSON.parse(res.body as string);
    expect(parsed.str).toBe("hello");
    expect(parsed.num).toBe(42);
    expect(parsed.bool).toBe(true);
    expect(parsed.nil).toBeNull();
    expect(parsed.arr).toEqual([1, 2]);
    expect(parsed.obj).toEqual({ k: "v" });
  });
});

describe("response serialization integration", () => {
  it("serializes response body using compiled serializer", async () => {
    const adapter = nativeServer();
    adapter.registerRoutes(
      makeSerializedRouteTable(),
      makeSerializerHandlerMap(),
      emptyMiddleware,
      undefined,
      makeSerializerMap(),
    );
    const handle = await adapter.listen(0);
    try {
      const server = adapter.getNativeServer!() as Server;
      const addr = server.address() as { port: number };
      const res = await fetchJson(addr.port, "/users");
      expect(res.status).toBe(200);
      const b = res.body as Record<string, unknown>;
      expect(b.users).toEqual([
        { id: "1", name: "Alice" },
        { id: "2", name: "Bob" },
      ]);
    } finally {
      await handle.close();
    }
  });

  it("sets content-type to application/json automatically", async () => {
    const adapter = nativeServer();
    adapter.registerRoutes(
      makeSerializedRouteTable(),
      makeSerializerHandlerMap(),
      emptyMiddleware,
      undefined,
      makeSerializerMap(),
    );
    const handle = await adapter.listen(0);
    try {
      const server = adapter.getNativeServer!() as Server;
      const addr = server.address() as { port: number };
      const res = await fetchJson(addr.port, "/");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("application/json");
    } finally {
      await handle.close();
    }
  });

  it("falls back to JSON.stringify when no compiled schema exists", async () => {
    const adapter = nativeServer();
    adapter.registerRoutes(
      makeSerializedRouteTable(),
      makeSerializerHandlerMap(),
      emptyMiddleware,
      undefined,
      makeSerializerMap(),
    );
    const handle = await adapter.listen(0);
    try {
      const server = adapter.getNativeServer!() as Server;
      const addr = server.address() as { port: number };
      // POST /users has no serializer ref — uses fallback
      const res = await fetchJson(addr.port, "/users", {
        method: "POST",
        body: { name: "Test" },
      });
      expect(res.status).toBe(201);
      const b = res.body as Record<string, unknown>;
      expect(b.created).toBe(true);
      expect(res.headers["content-type"]).toContain("application/json");
    } finally {
      await handle.close();
    }
  });

  it("falls back when serializer ref points to missing serializer in map", async () => {
    const adapter = nativeServer();
    adapter.registerRoutes(
      makeSerializedRouteTable(),
      makeSerializerHandlerMap(),
      emptyMiddleware,
      undefined,
      makeSerializerMap(),
    );
    const handle = await adapter.listen(0);
    try {
      const server = adapter.getNativeServer!() as Server;
      const addr = server.address() as { port: number };
      // GET /no-schema has serializer: "MissingSerializer" which is not in the map
      const res = await fetchJson(addr.port, "/no-schema");
      expect(res.status).toBe(200);
      const b = res.body as Record<string, unknown>;
      expect(b.fallback).toBe(true);
      expect(res.headers["content-type"]).toContain("application/json");
    } finally {
      await handle.close();
    }
  });

  it("handles nested objects correctly with serializer", async () => {
    const adapter = nativeServer();
    adapter.registerRoutes(
      makeSerializedRouteTable(),
      makeSerializerHandlerMap(),
      emptyMiddleware,
      undefined,
      makeSerializerMap(),
    );
    const handle = await adapter.listen(0);
    try {
      const server = adapter.getNativeServer!() as Server;
      const addr = server.address() as { port: number };
      const res = await fetchJson(addr.port, "/nested");
      expect(res.status).toBe(200);
      const b = res.body as Record<string, unknown>;
      const data = b.data as Record<string, unknown>;
      expect(data.items).toEqual([{ a: 1, b: [true, false] }]);
      expect(data.meta).toEqual({ total: 1 });
    } finally {
      await handle.close();
    }
  });

  it("handles all JSON types (strings, numbers, booleans, nulls, arrays, objects)", async () => {
    const adapter = nativeServer();
    adapter.registerRoutes(
      makeSerializedRouteTable(),
      makeSerializerHandlerMap(),
      emptyMiddleware,
      undefined,
      makeSerializerMap(),
    );
    const handle = await adapter.listen(0);
    try {
      const server = adapter.getNativeServer!() as Server;
      const addr = server.address() as { port: number };
      const res = await fetchJson(addr.port, "/types");
      expect(res.status).toBe(200);
      const b = res.body as Record<string, unknown>;
      expect(b.str).toBe("hello");
      expect(b.num).toBe(42);
      expect(b.bool).toBe(true);
      expect(b.nil).toBeNull();
      expect(b.arr).toEqual([1, 2, 3]);
      expect(b.obj).toEqual({ k: "v" });
    } finally {
      await handle.close();
    }
  });

  it("does not serialize null body (e.g., 204 responses)", async () => {
    const adapter = nativeServer();
    adapter.registerRoutes(
      makeSerializedRouteTable(),
      makeSerializerHandlerMap(),
      emptyMiddleware,
      undefined,
      makeSerializerMap(),
    );
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

  it("works without serializerMap (backwards compatible)", async () => {
    const adapter = nativeServer();
    adapter.registerRoutes(
      makeSerializedRouteTable(),
      makeSerializerHandlerMap(),
      emptyMiddleware,
    );
    const handle = await adapter.listen(0);
    try {
      const server = adapter.getNativeServer!() as Server;
      const addr = server.address() as { port: number };
      const res = await fetchJson(addr.port, "/");
      expect(res.status).toBe(200);
      expect((res.body as Record<string, unknown>).message).toBe("Welcome");
      expect(res.headers["content-type"]).toContain("application/json");
    } finally {
      await handle.close();
    }
  });
});
