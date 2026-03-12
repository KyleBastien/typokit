import { describe, it, expect } from "@rstest/core";
import {
  defineMiddleware,
  executeMiddlewareChain,
  sortMiddlewareEntries,
  compileMiddlewareChain,
  createRequestContext,
} from "./middleware.js";
import type { TypoKitRequest } from "@typokit/types";
import type { MiddlewareInput } from "./middleware.js";
import type { AppError } from "@typokit/errors";
import {
  NotFoundError,
  ValidationError,
  ForbiddenError,
} from "@typokit/errors";

function createTestRequest(
  overrides?: Partial<TypoKitRequest>,
): TypoKitRequest {
  return {
    method: "GET",
    path: "/test",
    headers: {},
    body: undefined,
    query: {},
    params: {},
    ...overrides,
  };
}

describe("defineMiddleware", () => {
  it("creates a middleware with the given handler", async () => {
    const mw = defineMiddleware(async () => ({ foo: "bar" }));
    expect(mw.handler).toBeDefined();
    const result = await mw.handler({
      headers: {},
      body: undefined,
      query: {},
      params: {},
      ctx: createRequestContext(),
    });
    expect(result).toEqual({ foo: "bar" });
  });

  it("receives request properties", async () => {
    const mw = defineMiddleware(async ({ headers, params }) => {
      return {
        token: headers["authorization"] as string,
        userId: params["id"],
      };
    });
    const result = await mw.handler({
      headers: { authorization: "Bearer abc" },
      body: undefined,
      query: {},
      params: { id: "42" },
      ctx: createRequestContext(),
    });
    expect(result).toEqual({ token: "Bearer abc", userId: "42" });
  });
});

describe("executeMiddlewareChain", () => {
  it("runs middleware in order and accumulates context", async () => {
    const order: number[] = [];

    const mw1 = defineMiddleware(async () => {
      order.push(1);
      return { step1: true };
    });

    const mw2 = defineMiddleware(async ({ ctx }) => {
      order.push(2);
      expect((ctx as unknown as Record<string, unknown>)["step1"]).toBe(true);
      return { step2: true };
    });

    const req = createTestRequest();
    const ctx = createRequestContext();

    const result = await executeMiddlewareChain(req, ctx, [
      { name: "mw1", middleware: mw1 },
      { name: "mw2", middleware: mw2 },
    ]);

    expect(order).toEqual([1, 2]);
    expect((result as unknown as Record<string, unknown>)["step1"]).toBe(true);
    expect((result as unknown as Record<string, unknown>)["step2"]).toBe(true);
  });

  it("respects priority ordering (lower runs first)", async () => {
    const order: string[] = [];

    const mwA = defineMiddleware(async () => {
      order.push("A");
      return {};
    });
    const mwB = defineMiddleware(async () => {
      order.push("B");
      return {};
    });
    const mwC = defineMiddleware(async () => {
      order.push("C");
      return {};
    });

    const req = createTestRequest();
    const ctx = createRequestContext();

    const entries = sortMiddlewareEntries([
      { name: "A", middleware: mwA, priority: 30 },
      { name: "B", middleware: mwB, priority: 10 },
      { name: "C", middleware: mwC, priority: 20 },
    ]);

    await executeMiddlewareChain(req, ctx, entries);

    expect(order).toEqual(["B", "C", "A"]);
  });

  it("default priority is 0", async () => {
    const order: string[] = [];

    const mwA = defineMiddleware(async () => {
      order.push("A");
      return {};
    });
    const mwB = defineMiddleware(async () => {
      order.push("B");
      return {};
    });

    const req = createTestRequest();
    const ctx = createRequestContext();

    const entries = sortMiddlewareEntries([
      { name: "A", middleware: mwA, priority: 10 },
      { name: "B", middleware: mwB },
    ]);

    await executeMiddlewareChain(req, ctx, entries);

    expect(order).toEqual(["B", "A"]);
  });

  it("short-circuits when middleware throws", async () => {
    const order: number[] = [];

    const mw1 = defineMiddleware(async () => {
      order.push(1);
      return {};
    });
    const mw2 = defineMiddleware(
      async ({ ctx }): Promise<Record<string, unknown>> => {
        order.push(2);
        ctx.fail(403, "FORBIDDEN", "Not allowed");
        return {};
      },
    );
    const mw3 = defineMiddleware(async () => {
      order.push(3);
      return {};
    });

    const req = createTestRequest();
    const ctx = createRequestContext();

    let caught: unknown;
    try {
      await executeMiddlewareChain(req, ctx, [
        { name: "mw1", middleware: mw1 },
        { name: "mw2", middleware: mw2 },
        { name: "mw3", middleware: mw3 },
      ]);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ForbiddenError);
    expect((caught as AppError).status).toBe(403);
    expect((caught as AppError).code).toBe("FORBIDDEN");
    expect(order).toEqual([1, 2]);
  });

  it("handles empty middleware chain", async () => {
    const req = createTestRequest();
    const ctx = createRequestContext();
    const result = await executeMiddlewareChain(req, ctx, []);
    expect(result).toBeDefined();
    expect(result.requestId).toBe(ctx.requestId);
  });
});

describe("sortMiddlewareEntries", () => {
  it("sorts by priority ascending (lower runs first)", () => {
    const mw = defineMiddleware(async () => ({}));
    const entries = sortMiddlewareEntries([
      { name: "A", middleware: mw, priority: 30 },
      { name: "B", middleware: mw, priority: 10 },
      { name: "C", middleware: mw, priority: 20 },
    ]);
    expect(entries.map((e) => e.name)).toEqual(["B", "C", "A"]);
  });

  it("treats undefined priority as 0", () => {
    const mw = defineMiddleware(async () => ({}));
    const entries = sortMiddlewareEntries([
      { name: "A", middleware: mw, priority: 10 },
      { name: "B", middleware: mw },
    ]);
    expect(entries.map((e) => e.name)).toEqual(["B", "A"]);
  });

  it("does not mutate the original array", () => {
    const mw = defineMiddleware(async () => ({}));
    const original = [
      { name: "A", middleware: mw, priority: 20 },
      { name: "B", middleware: mw, priority: 10 },
    ];
    const sorted = sortMiddlewareEntries(original);
    expect(original[0].name).toBe("A");
    expect(sorted[0].name).toBe("B");
  });

  it("returns empty array for empty input", () => {
    const entries = sortMiddlewareEntries([]);
    expect(entries).toEqual([]);
  });
});

describe("createRequestContext", () => {
  it("ctx.fail() throws NotFoundError for 404", () => {
    const ctx = createRequestContext();
    let caught: unknown;
    try {
      ctx.fail(404, "NOT_FOUND", "Resource not found");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(NotFoundError);
    expect((caught as AppError).status).toBe(404);
    expect((caught as AppError).code).toBe("NOT_FOUND");
    expect((caught as AppError).message).toBe("Resource not found");
  });

  it("ctx.fail() throws ValidationError for 400 with details", () => {
    const ctx = createRequestContext();
    let caught: unknown;
    try {
      ctx.fail(400, "VALIDATION", "Invalid input", { field: "email" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect((caught as AppError).details).toEqual({ field: "email" });
  });

  it("ctx.log is defined with all log levels", () => {
    const ctx = createRequestContext();
    expect(ctx.log).toBeDefined();
    expect(typeof ctx.log.trace).toBe("function");
    expect(typeof ctx.log.debug).toBe("function");
    expect(typeof ctx.log.info).toBe("function");
    expect(typeof ctx.log.warn).toBe("function");
    expect(typeof ctx.log.error).toBe("function");
    expect(typeof ctx.log.fatal).toBe("function");
  });

  it("ctx.log methods are no-ops (placeholder)", () => {
    const ctx = createRequestContext();
    // Should not throw
    ctx.log.trace("test");
    ctx.log.debug("test", { key: "value" });
    ctx.log.info("test");
    ctx.log.warn("test");
    ctx.log.error("test");
    ctx.log.fatal("test");
  });

  it("has a requestId", () => {
    const ctx = createRequestContext();
    expect(typeof ctx.requestId).toBe("string");
    expect(ctx.requestId.length).toBeGreaterThan(0);
  });

  it("generates unique requestIds across calls", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(createRequestContext().requestId);
    }
    expect(ids.size).toBe(1000);
  });

  it("generates monotonically increasing requestIds", () => {
    const a = createRequestContext().requestId;
    const b = createRequestContext().requestId;
    expect(parseInt(a, 36)).toBeLessThan(parseInt(b, 36));
  });

  it("has services object", () => {
    const ctx = createRequestContext();
    expect(ctx.services).toBeDefined();
    expect(typeof ctx.services).toBe("object");
  });

  it("accepts overrides", () => {
    const ctx = createRequestContext({ requestId: "test-123" });
    expect(ctx.requestId).toBe("test-123");
  });
});

describe("compileMiddlewareChain", () => {
  it("returns identity for empty entries (no-op pass-through)", async () => {
    const compiled = compileMiddlewareChain([]);
    const req = createTestRequest();
    const ctx = createRequestContext();
    const result = await compiled(req, ctx);
    expect(result).toBe(ctx);
    expect(result.requestId).toBe(ctx.requestId);
  });

  it("handles single middleware without loop", async () => {
    const mw = defineMiddleware(async () => ({ user: "alice" }));
    const compiled = compileMiddlewareChain([{ name: "auth", middleware: mw }]);
    const req = createTestRequest();
    const ctx = createRequestContext();
    const result = await compiled(req, ctx);
    expect((result as unknown as Record<string, unknown>)["user"]).toBe(
      "alice",
    );
  });

  it("chains multiple middleware in order and accumulates context", async () => {
    const order: number[] = [];

    const mw1 = defineMiddleware(async () => {
      order.push(1);
      return { step1: true };
    });
    const mw2 = defineMiddleware(async ({ ctx }) => {
      order.push(2);
      expect((ctx as unknown as Record<string, unknown>)["step1"]).toBe(true);
      return { step2: true };
    });
    const mw3 = defineMiddleware(async ({ ctx }) => {
      order.push(3);
      expect((ctx as unknown as Record<string, unknown>)["step2"]).toBe(true);
      return { step3: true };
    });

    const compiled = compileMiddlewareChain([
      { name: "mw1", middleware: mw1 },
      { name: "mw2", middleware: mw2 },
      { name: "mw3", middleware: mw3 },
    ]);

    const req = createTestRequest();
    const ctx = createRequestContext();
    const result = await compiled(req, ctx);

    expect(order).toEqual([1, 2, 3]);
    expect((result as unknown as Record<string, unknown>)["step1"]).toBe(true);
    expect((result as unknown as Record<string, unknown>)["step2"]).toBe(true);
    expect((result as unknown as Record<string, unknown>)["step3"]).toBe(true);
  });

  it("short-circuits when middleware throws", async () => {
    const order: number[] = [];

    const mw1 = defineMiddleware(async () => {
      order.push(1);
      return {};
    });
    const mw2 = defineMiddleware(
      async ({ ctx }): Promise<Record<string, unknown>> => {
        order.push(2);
        ctx.fail(403, "FORBIDDEN", "Not allowed");
        return {};
      },
    );
    const mw3 = defineMiddleware(async () => {
      order.push(3);
      return {};
    });

    const compiled = compileMiddlewareChain([
      { name: "mw1", middleware: mw1 },
      { name: "mw2", middleware: mw2 },
      { name: "mw3", middleware: mw3 },
    ]);

    const req = createTestRequest();
    const ctx = createRequestContext();

    let caught: unknown;
    try {
      await compiled(req, ctx);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ForbiddenError);
    expect((caught as AppError).status).toBe(403);
    expect(order).toEqual([1, 2]);
  });

  it("receives request properties in the input", async () => {
    const mw = defineMiddleware(async ({ headers, params }) => ({
      token: headers["authorization"] as string,
      userId: params["id"],
    }));

    const compiled = compileMiddlewareChain([{ name: "auth", middleware: mw }]);

    const req = createTestRequest({
      headers: { authorization: "Bearer xyz" },
      params: { id: "99" },
    });
    const ctx = createRequestContext();
    const result = await compiled(req, ctx);

    expect((result as unknown as Record<string, unknown>)["token"]).toBe(
      "Bearer xyz",
    );
    expect((result as unknown as Record<string, unknown>)["userId"]).toBe("99");
  });

  it("mutates context in-place (same reference returned)", async () => {
    const mw = defineMiddleware(async () => ({ added: true }));
    const compiled = compileMiddlewareChain([{ name: "mw", middleware: mw }]);
    const req = createTestRequest();
    const ctx = createRequestContext();
    const result = await compiled(req, ctx);
    expect(result).toBe(ctx);
  });

  it("skips Object.assign for empty middleware returns ({})", async () => {
    const mw1 = defineMiddleware(async () => ({}));
    const mw2 = defineMiddleware(async () => ({ user: "alice" }));
    const mw3 = defineMiddleware(async () => ({}));

    const compiled = compileMiddlewareChain([
      { name: "noop1", middleware: mw1 },
      { name: "auth", middleware: mw2 },
      { name: "noop2", middleware: mw3 },
    ]);

    const req = createTestRequest();
    const ctx = createRequestContext();
    const result = await compiled(req, ctx);

    // Real middleware values still applied
    expect((result as unknown as Record<string, unknown>)["user"]).toBe(
      "alice",
    );
    // Context reference unchanged
    expect(result).toBe(ctx);
  });

  it("handles middleware returning undefined or null gracefully", async () => {
    // Middleware that returns undefined (cast to satisfy TS)
    const mwUndef = defineMiddleware(
      (async () => undefined) as unknown as (
        input: MiddlewareInput,
      ) => Promise<Record<string, unknown>>,
    );
    // Middleware that returns null (cast to satisfy TS)
    const mwNull = defineMiddleware(
      (async () => null) as unknown as (
        input: MiddlewareInput,
      ) => Promise<Record<string, unknown>>,
    );
    const mwReal = defineMiddleware(async () => ({ role: "admin" }));

    const compiled = compileMiddlewareChain([
      { name: "undef", middleware: mwUndef },
      { name: "null", middleware: mwNull },
      { name: "real", middleware: mwReal },
    ]);

    const req = createTestRequest();
    const ctx = createRequestContext();
    const result = await compiled(req, ctx);

    expect((result as unknown as Record<string, unknown>)["role"]).toBe(
      "admin",
    );
    expect(result).toBe(ctx);
  });

  it("single middleware with actual context values works correctly", async () => {
    const mw = defineMiddleware(async () => ({
      user: { id: "42", name: "Bob" },
      permissions: ["read", "write"],
    }));
    const compiled = compileMiddlewareChain([{ name: "auth", middleware: mw }]);
    const req = createTestRequest();
    const ctx = createRequestContext();
    const result = await compiled(req, ctx);

    const extended = result as unknown as Record<string, unknown>;
    expect(extended["user"]).toEqual({ id: "42", name: "Bob" });
    expect(extended["permissions"]).toEqual(["read", "write"]);
  });

  it("reads req properties fresh per middleware call (no pre-allocated input)", async () => {
    // If compileMiddlewareChain pre-allocated a MiddlewareInput object
    // before the loop, mutating req.params inside a middleware would NOT
    // be visible to subsequent middleware through the pre-allocated input.
    // This test verifies that each handler sees fresh req properties.
    const mw1 = defineMiddleware(async ({ params }) => {
      // First middleware sees original params
      expect(params["id"]).toBe("1");
      return { step1: true };
    });

    // Middleware that mutates req.params via the closure
    let capturedReq: TypoKitRequest | undefined;
    const mw2 = defineMiddleware(async ({ params, ctx }) => {
      expect(params["id"]).toBe("1");
      // Simulate param mutation (e.g., from a sub-router)
      if (capturedReq) {
        capturedReq.params = { id: "42" };
      }
      return { step2: true };
    });

    const mw3 = defineMiddleware(async ({ params }) => {
      // Third middleware should see the MUTATED params (id: "42")
      // This only works if fields are extracted fresh, not cached
      expect(params["id"]).toBe("42");
      return { step3: true };
    });

    const compiled = compileMiddlewareChain([
      { name: "mw1", middleware: mw1 },
      { name: "mw2", middleware: mw2 },
      { name: "mw3", middleware: mw3 },
    ]);

    const req = createTestRequest({ params: { id: "1" } });
    capturedReq = req;
    const ctx = createRequestContext();
    const result = await compiled(req, ctx);

    expect((result as unknown as Record<string, unknown>)["step1"]).toBe(true);
    expect((result as unknown as Record<string, unknown>)["step2"]).toBe(true);
    expect((result as unknown as Record<string, unknown>)["step3"]).toBe(true);
  });

  it("single middleware returning empty object is a no-op", async () => {
    const mw = defineMiddleware(async () => ({}));
    const compiled = compileMiddlewareChain([{ name: "noop", middleware: mw }]);
    const req = createTestRequest();
    const ctx = createRequestContext();
    const result = await compiled(req, ctx);
    expect(result).toBe(ctx);
    // Only original context keys should exist
    expect(result.requestId).toBeDefined();
    expect(result.log).toBeDefined();
  });

  it("returns synchronous identity when all entries are marked noOp", () => {
    const mw = defineMiddleware(async () => ({}));
    const compiled = compileMiddlewareChain([
      { name: "noop1", middleware: mw, noOp: true },
      { name: "noop2", middleware: mw, noOp: true },
      { name: "noop3", middleware: mw, noOp: true },
    ]);
    const req = createTestRequest();
    const ctx = createRequestContext();
    const result = compiled(req, ctx);
    // Synchronous — returns ctx directly, not a Promise
    expect(result).toBe(ctx);
    expect(result).not.toBeInstanceOf(Promise);
  });

  it("filters out noOp entries from mixed chain and runs real middleware", async () => {
    const noopMw = defineMiddleware(async () => ({}));
    const realMw = defineMiddleware(async () => ({ user: "alice" }));

    const compiled = compileMiddlewareChain([
      { name: "noop1", middleware: noopMw, noOp: true },
      { name: "auth", middleware: realMw },
      { name: "noop2", middleware: noopMw, noOp: true },
    ]);

    const req = createTestRequest();
    const ctx = createRequestContext();
    const result = await compiled(req, ctx);
    expect((result as unknown as Record<string, unknown>)["user"]).toBe(
      "alice",
    );
    expect(result).toBe(ctx);
  });

  it("non-noOp middleware with side effects still runs correctly", async () => {
    let sideEffectCalled = false;
    const realMw = defineMiddleware(async () => {
      sideEffectCalled = true;
      return { logged: true };
    });

    const compiled = compileMiddlewareChain([
      { name: "logger", middleware: realMw },
    ]);

    const req = createTestRequest();
    const ctx = createRequestContext();
    await compiled(req, ctx);

    expect(sideEffectCalled).toBe(true);
    expect((ctx as unknown as Record<string, unknown>)["logged"]).toBe(true);
  });

  it("mixed noOp chain with multiple real middleware accumulates context", async () => {
    const noopMw = defineMiddleware(async () => ({}));
    const mw1 = defineMiddleware(async () => ({ role: "admin" }));
    const mw2 = defineMiddleware(async () => ({ org: "acme" }));

    const compiled = compileMiddlewareChain([
      { name: "noop1", middleware: noopMw, noOp: true },
      { name: "role", middleware: mw1 },
      { name: "noop2", middleware: noopMw, noOp: true },
      { name: "org", middleware: mw2 },
      { name: "noop3", middleware: noopMw, noOp: true },
    ]);

    const req = createTestRequest();
    const ctx = createRequestContext();
    const result = await compiled(req, ctx);

    const extended = result as unknown as Record<string, unknown>;
    expect(extended["role"]).toBe("admin");
    expect(extended["org"]).toBe("acme");
  });
});
