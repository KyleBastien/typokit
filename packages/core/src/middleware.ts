// @typokit/core — Middleware System

import type { TypoKitRequest, RequestContext, Logger } from "@typokit/types";
import { createAppError } from "@typokit/errors";

/**
 * Monotonically incrementing request ID counter.
 * Uses a simple numeric counter with base-36 encoding for compact string IDs.
 * Unique within a process lifetime — resets on restart.
 *
 * BREAKING CHANGE: Request IDs are now sequential (e.g., "1", "2", "a", "1z")
 * instead of random (e.g., "a1b2c3d4e5f6g7h8"). This is intentional for
 * performance — avoids two Math.random() calls and string allocations per request.
 */
let requestIdCounter = 0;

function nextRequestId(): string {
  return (++requestIdCounter).toString(36);
}

/** Input received by a defineMiddleware handler */
export interface MiddlewareInput {
  headers: TypoKitRequest["headers"];
  body: TypoKitRequest["body"];
  query: TypoKitRequest["query"];
  params: TypoKitRequest["params"];
  ctx: RequestContext;
}

/** A typed middleware created by defineMiddleware */
export interface Middleware<
  TAdded extends Record<string, unknown> = Record<string, unknown>,
> {
  handler: (input: MiddlewareInput) => Promise<TAdded>;
}

/** An entry in the middleware chain with name and optional priority */
export interface MiddlewareEntry {
  name: string;
  middleware: Middleware;
  priority?: number;
}

/**
 * Define a typed middleware that receives request properties and returns
 * additional context properties. Supports context type narrowing.
 */
export function defineMiddleware<TAdded extends Record<string, unknown>>(
  handler: (input: MiddlewareInput) => Promise<TAdded>,
): Middleware<TAdded> {
  return { handler };
}

const NOOP = () => {};

/** Shared no-op logger instance — avoids per-request object allocation */
const PLACEHOLDER_LOGGER: Logger = {
  trace: NOOP,
  debug: NOOP,
  info: NOOP,
  warn: NOOP,
  error: NOOP,
  fatal: NOOP,
};

/** Create a no-op placeholder logger (actual implementation in observability phase) */
export function createPlaceholderLogger(): Logger {
  return PLACEHOLDER_LOGGER;
}

/** Shared fail function — avoids per-request closure allocation */
function fail(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): never {
  throw createAppError(status, code, message, details);
}

/** Create a RequestContext with ctx.fail() and ctx.log placeholder */
export function createRequestContext(
  overrides?: Partial<RequestContext>,
): RequestContext {
  return {
    log: PLACEHOLDER_LOGGER,
    fail,
    services: {},
    requestId: nextRequestId(),
    ...overrides,
  };
}

/**
 * Sort middleware entries by priority (lower priority runs first).
 * Call once at registration/startup time, then reuse the sorted array.
 */
export function sortMiddlewareEntries(
  entries: MiddlewareEntry[],
): MiddlewareEntry[] {
  return [...entries].sort(
    (a, b) => (a.priority ?? 0) - (b.priority ?? 0),
  );
}

/**
 * Execute a middleware chain in the order given (entries must be pre-sorted).
 * Each middleware's returned properties are accumulated onto the context.
 * Middleware can short-circuit by throwing an error.
 *
 * Use {@link sortMiddlewareEntries} at registration time to pre-sort by priority.
 */
export async function executeMiddlewareChain(
  req: TypoKitRequest,
  ctx: RequestContext,
  entries: MiddlewareEntry[],
): Promise<RequestContext> {
  for (const entry of entries) {
    const added = await entry.middleware.handler({
      headers: req.headers,
      body: req.body,
      query: req.query,
      params: req.params,
      ctx,
    });
    Object.assign(ctx, added);
  }

  return ctx;
}
