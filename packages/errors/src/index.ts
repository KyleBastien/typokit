// @typokit/errors — Structured Error Class Hierarchy

import type { ErrorResponse } from "@typokit/types";

/**
 * Base error class for all TypoKit errors.
 * Extends native Error with structured fields for status, code, and details.
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
    Object.setPrototypeOf(this, new.target.prototype);
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
