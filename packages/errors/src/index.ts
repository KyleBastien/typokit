// @typokit/errors — Structured Error Class Hierarchy

import type { ErrorResponse } from "@typokit/types";

// V8/Node.js-specific Error extensions (not in standard ES typings)
const ErrorWithV8 = Error as unknown as {
  stackTraceLimit: number;
  captureStackTrace(
    target: object,
    constructorOpt?: (...args: unknown[]) => unknown,
  ): void;
  new (message?: string): Error;
  prototype: Error;
};

/**
 * Base error class for all TypoKit errors.
 * Extends native Error with structured fields for status, code, and details.
 *
 * Stack trace capture is skipped at construction time for performance.
 * AppError stack is never used in response serialization (toJSON() excludes it).
 * Call captureStack() if you need the trace for debugging.
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    // Skip expensive V8 stack walk — restore limit after super()
    const prevLimit = ErrorWithV8.stackTraceLimit;
    ErrorWithV8.stackTraceLimit = 0;
    super(message);
    ErrorWithV8.stackTraceLimit = prevLimit;
    this.name = "AppError";
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** Lazily capture stack trace (skipped at construction for performance) */
  captureStack(): this {
    ErrorWithV8.captureStackTrace(this);
    return this;
  }

  /** Serialize to the ErrorResponse schema from @typokit/types */
  toJSON(): ErrorResponse {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details !== undefined ? { details: this.details } : {}),
      },
    };
  }
}

/** 404 Not Found */
export class NotFoundError extends AppError {
  constructor(
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(code, 404, message, details);
    this.name = "NotFoundError";
  }
}

/** 400 Bad Request / Validation */
export class ValidationError extends AppError {
  constructor(
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(code, 400, message, details);
    this.name = "ValidationError";
  }
}

/** 401 Unauthorized */
export class UnauthorizedError extends AppError {
  constructor(
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(code, 401, message, details);
    this.name = "UnauthorizedError";
  }
}

/** 403 Forbidden */
export class ForbiddenError extends AppError {
  constructor(
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(code, 403, message, details);
    this.name = "ForbiddenError";
  }
}

/** 409 Conflict */
export class ConflictError extends AppError {
  constructor(
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(code, 409, message, details);
    this.name = "ConflictError";
  }
}

/**
 * Factory function that returns the correct AppError subclass based on status code.
 */
export function createAppError(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): AppError {
  switch (status) {
    case 400:
      return new ValidationError(code, message, details);
    case 401:
      return new UnauthorizedError(code, message, details);
    case 403:
      return new ForbiddenError(code, message, details);
    case 404:
      return new NotFoundError(code, message, details);
    case 409:
      return new ConflictError(code, message, details);
    default:
      return new AppError(code, status, message, details);
  }
}
