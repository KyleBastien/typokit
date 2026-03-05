// @typokit/core — Error Middleware

import type {
  TypoKitRequest,
  RequestContext,
  TypoKitResponse,
  ErrorResponse,
  Logger,
} from "@typokit/types";
import { AppError } from "@typokit/errors";

// ─── Options ─────────────────────────────────────────────────

/** Options for configuring the error middleware */
export interface ErrorMiddlewareOptions {
  /** Override dev mode detection (defaults to NODE_ENV === "development") */
  isDev?: boolean;
}

// ─── Typia Validation Error Detection ────────────────────────

/** Shape of a single Typia validation failure */
interface TypiaValidationFailure {
  path: string;
  expected: string;
  value: unknown;
}

/** Duck-type check for Typia TypeGuardError (thrown by typia.assert) */
function isTypiaTypeGuardError(
  error: unknown,
): error is Error & { path?: string; expected?: string; value?: unknown } {
  if (!(error instanceof Error)) return false;
  return error.name === "TypeGuardError";
}

/** Duck-type check for objects with Typia-style errors array */
function hasTypiaErrors(
  error: unknown,
): error is Error & { errors: TypiaValidationFailure[] } {
  if (!(error instanceof Error)) return false;
  const candidate = error as unknown as Record<string, unknown>;
  return (
    Array.isArray(candidate.errors) &&
    candidate.errors.length > 0 &&
    typeof (candidate.errors[0] as Record<string, unknown>).path === "string"
  );
}

/** Extract field-level details from a Typia validation error */
function extractTypiaDetails(error: Error): Record<string, unknown> {
  if (hasTypiaErrors(error)) {
    return {
      fields: error.errors.map((e) => ({
        path: e.path,
        expected: e.expected,
        value: e.value,
      })),
    };
  }

  const guard = error as { path?: string; expected?: string; value?: unknown };
  if (guard.path !== undefined) {
    return {
      fields: [
        {
          path: guard.path,
          expected: guard.expected,
          value: guard.value,
        },
      ],
    };
  }

  return {};
}

// ─── Error Middleware Factory ─────────────────────────────────

/**
 * Built-in error middleware — catches all thrown errors and serializes
 * them into the ErrorResponse schema.
 *
 * - AppError: serialized with correct status, code, message, details, traceId
 * - Typia validation errors: 400 with field-level failure details
 * - Unknown errors (prod): 500 generic message, full details logged
 * - Unknown errors (dev): 500 with stack trace and message exposed
 */
export function createErrorMiddleware(
  options?: ErrorMiddlewareOptions,
): (
  req: TypoKitRequest,
  ctx: RequestContext,
  next: () => Promise<TypoKitResponse>,
) => Promise<TypoKitResponse> {
  const isDev =
    options?.isDev ??
    (typeof globalThis !== "undefined" &&
      (globalThis as unknown as { process?: { env?: Record<string, string> } })
        .process?.env?.NODE_ENV === "development");

  return async (_req, ctx, next) => {
    try {
      return await next();
    } catch (error: unknown) {
      const traceId = ctx.requestId;

      // ── AppError instances ──
      if (error instanceof AppError) {
        const json: ErrorResponse = error.toJSON();
        json.error.traceId = traceId;
        return {
          status: error.status,
          headers: { "content-type": "application/json" },
          body: json,
        };
      }

      // ── Typia validation errors ──
      if (isTypiaTypeGuardError(error) || hasTypiaErrors(error)) {
        const details = extractTypiaDetails(error);
        const body: ErrorResponse = {
          error: {
            code: "VALIDATION_ERROR",
            message: error.message || "Validation failed",
            details,
            traceId,
          },
        };
        return {
          status: 400,
          headers: { "content-type": "application/json" },
          body,
        };
      }

      // ── Unknown errors ──
      const err = error instanceof Error ? error : new Error(String(error));

      if (isDev) {
        // Development: expose stack trace and message
        const body: ErrorResponse = {
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: err.message,
            details: {
              stack: err.stack,
              name: err.name,
            },
            traceId,
          },
        };
        return {
          status: 500,
          headers: { "content-type": "application/json" },
          body,
        };
      }

      // Production: log full details, return redacted response
      logUnknownError(ctx.log, err, traceId);
      const body: ErrorResponse = {
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Internal Server Error",
          traceId,
        },
      };
      return {
        status: 500,
        headers: { "content-type": "application/json" },
        body,
      };
    }
  };
}

/** Log full error details in production mode */
function logUnknownError(log: Logger, err: Error, traceId: string): void {
  log.error("Unhandled error", {
    traceId,
    name: err.name,
    message: err.message,
    stack: err.stack,
  });
}
