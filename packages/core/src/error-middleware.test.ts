import { describe, it, expect } from "@rstest/core";
import { createErrorMiddleware } from "./error-middleware.js";
import { AppError, ValidationError, NotFoundError } from "@typokit/errors";
import { createRequestContext } from "./middleware.js";

import type { TypoKitRequest, TypoKitResponse, ErrorResponse } from "@typokit/types";

// ─── Helpers ─────────────────────────────────────────────────

function makeReq(): TypoKitRequest {
  return {
    method: "GET",
    path: "/test",
    headers: {},
    body: undefined,
    query: {},
    params: {},
  };
}

function makeCtx() {
  return createRequestContext({ requestId: "trace-abc-123" });
}

function nextReturning(res: TypoKitResponse): () => Promise<TypoKitResponse> {
  return async () => res;
}

function nextThrowing(error: unknown): () => Promise<TypoKitResponse> {
  return async () => {
    throw error;
  };
}

// ─── AppError Serialization ──────────────────────────────────

describe("createErrorMiddleware — AppError", () => {
  it("serializes AppError with correct status, code, message, and traceId", async () => {
    const mw = createErrorMiddleware();
    const error = new AppError("SOME_ERROR", 422, "Something went wrong", {
      field: "name",
    });
    const res = await mw(makeReq(), makeCtx(), nextThrowing(error));
    const body = res.body as ErrorResponse;

    expect(res.status).toBe(422);
    expect(res.headers["content-type"]).toBe("application/json");
    expect(body.error.code).toBe("SOME_ERROR");
    expect(body.error.message).toBe("Something went wrong");
    expect(body.error.details).toEqual({ field: "name" });
    expect(body.error.traceId).toBe("trace-abc-123");
  });

  it("serializes NotFoundError as 404", async () => {
    const mw = createErrorMiddleware();
    const error = new NotFoundError("NOT_FOUND", "Resource not found");
    const res = await mw(makeReq(), makeCtx(), nextThrowing(error));
    const body = res.body as ErrorResponse;

    expect(res.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.traceId).toBe("trace-abc-123");
  });

  it("serializes ValidationError as 400", async () => {
    const mw = createErrorMiddleware();
    const error = new ValidationError("INVALID_INPUT", "Invalid input", {
      fields: ["name"],
    });
    const res = await mw(makeReq(), makeCtx(), nextThrowing(error));
    const body = res.body as ErrorResponse;

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(body.error.details).toEqual({ fields: ["name"] });
  });

  it("passes through successful responses without modification", async () => {
    const mw = createErrorMiddleware();
    const okResponse: TypoKitResponse = {
      status: 200,
      headers: { "content-type": "application/json" },
      body: { data: "ok" },
    };
    const res = await mw(makeReq(), makeCtx(), nextReturning(okResponse));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: "ok" });
  });
});

// ─── Unknown Error Redaction (Production) ────────────────────

describe("createErrorMiddleware — unknown errors (production)", () => {
  it("returns 500 with generic message for unknown errors", async () => {
    const mw = createErrorMiddleware({ isDev: false });
    const res = await mw(
      makeReq(),
      makeCtx(),
      nextThrowing(new Error("DB connection failed")),
    );
    const body = res.body as ErrorResponse;

    expect(res.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_SERVER_ERROR");
    expect(body.error.message).toBe("Internal Server Error");
    expect(body.error.traceId).toBe("trace-abc-123");
  });

  it("does not leak error details in production", async () => {
    const mw = createErrorMiddleware({ isDev: false });
    const res = await mw(
      makeReq(),
      makeCtx(),
      nextThrowing(new Error("secret DB password: p@ss")),
    );
    const body = res.body as ErrorResponse;

    expect(body.error.message).toBe("Internal Server Error");
    expect(body.error.details).toBeUndefined();
  });

  it("logs full error details in production", async () => {
    const logged: Array<{ message: string; data?: Record<string, unknown> }> = [];
    const ctx = createRequestContext({
      requestId: "trace-log-test",
      log: {
        trace: () => {},
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: (message, data) => {
          logged.push({ message, data });
        },
        fatal: () => {},
      },
    });
    const mw = createErrorMiddleware({ isDev: false });
    const thrown = new Error("secret failure");
    await mw(makeReq(), ctx, nextThrowing(thrown));

    expect(logged.length).toBe(1);
    expect(logged[0].message).toBe("Unhandled error");
    expect(logged[0].data?.message).toBe("secret failure");
    expect(logged[0].data?.traceId).toBe("trace-log-test");
    expect(typeof logged[0].data?.stack).toBe("string");
  });

  it("handles non-Error thrown values in production", async () => {
    const mw = createErrorMiddleware({ isDev: false });
    const res = await mw(makeReq(), makeCtx(), nextThrowing("string error"));
    const body = res.body as ErrorResponse;

    expect(res.status).toBe(500);
    expect(body.error.message).toBe("Internal Server Error");
  });
});

// ─── Development Mode ────────────────────────────────────────

describe("createErrorMiddleware — development mode", () => {
  it("includes stack trace for unknown errors in dev mode", async () => {
    const mw = createErrorMiddleware({ isDev: true });
    const thrown = new Error("dev error details");
    const res = await mw(makeReq(), makeCtx(), nextThrowing(thrown));
    const body = res.body as ErrorResponse;

    expect(res.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_SERVER_ERROR");
    expect(body.error.message).toBe("dev error details");
    expect(body.error.details?.stack).toBeDefined();
    expect(typeof body.error.details?.stack).toBe("string");
    expect(body.error.details?.name).toBe("Error");
    expect(body.error.traceId).toBe("trace-abc-123");
  });

  it("includes source location (stack) in dev mode", async () => {
    const mw = createErrorMiddleware({ isDev: true });
    const thrown = new TypeError("null is not a function");
    const res = await mw(makeReq(), makeCtx(), nextThrowing(thrown));
    const body = res.body as ErrorResponse;

    expect(body.error.details?.name).toBe("TypeError");
    expect((body.error.details?.stack as string).includes("TypeError")).toBe(
      true,
    );
  });

  it("handles non-Error thrown values in dev mode", async () => {
    const mw = createErrorMiddleware({ isDev: true });
    const res = await mw(makeReq(), makeCtx(), nextThrowing(42));
    const body = res.body as ErrorResponse;

    expect(res.status).toBe(500);
    expect(body.error.message).toBe("42");
  });
});

// ─── Typia Validation Errors ─────────────────────────────────

describe("createErrorMiddleware — Typia validation errors", () => {
  it("handles TypeGuardError with path, expected, value", async () => {
    const mw = createErrorMiddleware();
    const error = new Error("invalid type: expected string, got number");
    error.name = "TypeGuardError";
    Object.assign(error, {
      path: "input.name",
      expected: "string",
      value: 123,
    });

    const res = await mw(makeReq(), makeCtx(), nextThrowing(error));
    const body = res.body as ErrorResponse;

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.traceId).toBe("trace-abc-123");
    expect(body.error.details?.fields).toEqual([
      { path: "input.name", expected: "string", value: 123 },
    ]);
  });

  it("handles Typia errors with errors array", async () => {
    const mw = createErrorMiddleware();
    const error = new Error("Validation failed");
    error.name = "TypeGuardError";
    Object.assign(error, {
      errors: [
        { path: "input.name", expected: "string", value: 42 },
        { path: "input.age", expected: "number", value: "old" },
      ],
    });

    const res = await mw(makeReq(), makeCtx(), nextThrowing(error));
    const body = res.body as ErrorResponse;

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    const fields = body.error.details?.fields as Array<Record<string, unknown>>;
    expect(fields.length).toBe(2);
    expect(fields[0].path).toBe("input.name");
    expect(fields[1].path).toBe("input.age");
  });

  it("uses error.message for Typia validation errors", async () => {
    const mw = createErrorMiddleware();
    const error = new Error("Expected string but got number at input.name");
    error.name = "TypeGuardError";
    Object.assign(error, { path: "input.name", expected: "string", value: 99 });

    const res = await mw(makeReq(), makeCtx(), nextThrowing(error));
    const body = res.body as ErrorResponse;

    expect(body.error.message).toBe(
      "Expected string but got number at input.name",
    );
  });
});
