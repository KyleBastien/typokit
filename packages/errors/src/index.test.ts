import { describe, it, expect } from "@rstest/core";
import {
  AppError,
  NotFoundError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  createAppError,
} from "./index.js";

describe("AppError", () => {
  it("should set code, status, message, and details", () => {
    const err = new AppError("TEST_ERROR", 500, "Something failed", {
      key: "value",
    });
    expect(err.code).toBe("TEST_ERROR");
    expect(err.status).toBe(500);
    expect(err.message).toBe("Something failed");
    expect(err.details).toEqual({ key: "value" });
    expect(err.name).toBe("AppError");
  });

  it("should be an instance of Error", () => {
    const err = new AppError("CODE", 500, "msg");
    expect(err instanceof Error).toBe(true);
    expect(err instanceof AppError).toBe(true);
  });

  it("should serialize to ErrorResponse JSON", () => {
    const err = new AppError("INTERNAL", 500, "Internal error", { foo: "bar" });
    const json = err.toJSON();
    expect(json).toEqual({
      error: {
        code: "INTERNAL",
        message: "Internal error",
        details: { foo: "bar" },
      },
    });
  });

  it("should omit details from JSON when undefined", () => {
    const err = new AppError("INTERNAL", 500, "Internal error");
    const json = err.toJSON();
    expect(json).toEqual({
      error: {
        code: "INTERNAL",
        message: "Internal error",
      },
    });
    expect("details" in json.error).toBe(false);
  });
});

describe("NotFoundError", () => {
  it("should have status 404", () => {
    const err = new NotFoundError("NOT_FOUND", "Resource not found");
    expect(err.status).toBe(404);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toBe("Resource not found");
    expect(err.name).toBe("NotFoundError");
    expect(err instanceof AppError).toBe(true);
  });

  it("should serialize correctly", () => {
    const err = new NotFoundError("USER_NOT_FOUND", "User not found", {
      id: "123",
    });
    expect(err.toJSON()).toEqual({
      error: {
        code: "USER_NOT_FOUND",
        message: "User not found",
        details: { id: "123" },
      },
    });
  });
});

describe("ValidationError", () => {
  it("should have status 400", () => {
    const err = new ValidationError("VALIDATION_FAILED", "Invalid input", {
      field: "email",
    });
    expect(err.status).toBe(400);
    expect(err.code).toBe("VALIDATION_FAILED");
    expect(err.message).toBe("Invalid input");
    expect(err.details).toEqual({ field: "email" });
    expect(err.name).toBe("ValidationError");
    expect(err instanceof AppError).toBe(true);
  });
});

describe("UnauthorizedError", () => {
  it("should have status 401", () => {
    const err = new UnauthorizedError("UNAUTHORIZED", "Not authenticated");
    expect(err.status).toBe(401);
    expect(err.code).toBe("UNAUTHORIZED");
    expect(err.name).toBe("UnauthorizedError");
    expect(err instanceof AppError).toBe(true);
  });
});

describe("ForbiddenError", () => {
  it("should have status 403", () => {
    const err = new ForbiddenError("FORBIDDEN", "Access denied");
    expect(err.status).toBe(403);
    expect(err.code).toBe("FORBIDDEN");
    expect(err.name).toBe("ForbiddenError");
    expect(err instanceof AppError).toBe(true);
  });
});

describe("ConflictError", () => {
  it("should have status 409", () => {
    const err = new ConflictError("CONFLICT", "Already exists");
    expect(err.status).toBe(409);
    expect(err.code).toBe("CONFLICT");
    expect(err.name).toBe("ConflictError");
    expect(err instanceof AppError).toBe(true);
  });
});

describe("createAppError", () => {
  it("should return ValidationError for status 400", () => {
    const err = createAppError(400, "BAD_REQUEST", "Invalid");
    expect(err instanceof ValidationError).toBe(true);
    expect(err.status).toBe(400);
  });

  it("should return UnauthorizedError for status 401", () => {
    const err = createAppError(401, "UNAUTH", "Unauthorized");
    expect(err instanceof UnauthorizedError).toBe(true);
    expect(err.status).toBe(401);
  });

  it("should return ForbiddenError for status 403", () => {
    const err = createAppError(403, "FORBIDDEN", "Forbidden");
    expect(err instanceof ForbiddenError).toBe(true);
    expect(err.status).toBe(403);
  });

  it("should return NotFoundError for status 404", () => {
    const err = createAppError(404, "NOT_FOUND", "Not found");
    expect(err instanceof NotFoundError).toBe(true);
    expect(err.status).toBe(404);
  });

  it("should return ConflictError for status 409", () => {
    const err = createAppError(409, "CONFLICT", "Conflict");
    expect(err instanceof ConflictError).toBe(true);
    expect(err.status).toBe(409);
  });

  it("should return generic AppError for other status codes", () => {
    const err = createAppError(503, "SERVICE_UNAVAILABLE", "Down", {
      retry: true,
    });
    expect(err instanceof AppError).toBe(true);
    expect(err.status).toBe(503);
    expect(err.code).toBe("SERVICE_UNAVAILABLE");
    expect(err.details).toEqual({ retry: true });
  });

  it("should pass details through", () => {
    const err = createAppError(400, "CODE", "msg", { field: "name" });
    expect(err.details).toEqual({ field: "name" });
  });
});

describe("AppError lazy stack trace", () => {
  it("should skip stack trace capture at construction time", () => {
    const err = new AppError("CODE", 500, "test");
    // Stack should be empty or minimal (no frame lines) since capture is skipped
    const stack = err.stack ?? "";
    const frames = stack.split("\n").filter((line) => line.trim().startsWith("at "));
    expect(frames.length).toBe(0);
  });

  it("should capture stack trace on demand via captureStack()", () => {
    const err = new AppError("CODE", 500, "test");
    err.captureStack();
    const stack = err.stack ?? "";
    const frames = stack.split("\n").filter((line) => line.trim().startsWith("at "));
    expect(frames.length).toBeGreaterThan(0);
  });

  it("captureStack() should return the error instance for chaining", () => {
    const err = new AppError("CODE", 500, "test");
    const result = err.captureStack();
    expect(result).toBe(err);
  });

  it("subclasses should also skip stack trace at construction", () => {
    const err = new NotFoundError("NF", "not found");
    const stack = err.stack ?? "";
    const frames = stack.split("\n").filter((line) => line.trim().startsWith("at "));
    expect(frames.length).toBe(0);
  });
});
