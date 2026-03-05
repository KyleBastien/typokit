import { describe, it, expect } from "@rstest/core";
import {
  defineMiddleware,
  executeMiddlewareChain,
  createRequestContext,
} from "./middleware.js";
import type { TypoKitRequest } from "@typokit/types";
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

    await executeMiddlewareChain(req, ctx, [
      { name: "A", middleware: mwA, priority: 30 },
      { name: "B", middleware: mwB, priority: 10 },
      { name: "C", middleware: mwC, priority: 20 },
    ]);

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

    await executeMiddlewareChain(req, ctx, [
      { name: "A", middleware: mwA, priority: 10 },
      { name: "B", middleware: mwB },
    ]);

    expect(order).toEqual(["B", "A"]);
  });

  it("short-circuits when middleware throws", async () => {
    const order: number[] = [];

    const mw1 = defineMiddleware(async () => {
      order.push(1);
      return {};
    });
    const mw2 = defineMiddleware(async ({ ctx }): Promise<Record<string, unknown>> => {
      order.push(2);
      ctx.fail(403, "FORBIDDEN", "Not allowed");
      return {};
    });
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
