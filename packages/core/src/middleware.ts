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

/**
 * Fast check for non-empty object — for...in with early exit is faster
 * than Object.keys().length for the common case of empty objects ({}).
 */
function hasOwnKeys(obj: Record<string, unknown>): boolean {
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) return true;
  }
  return false;
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
  return [...entries].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
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
    if (added != null && typeof added === "object" && hasOwnKeys(added)) {
      Object.assign(ctx, added);
    }
  }

  return ctx;
}

/**
 * A pre-compiled middleware chain function.
 * Call once per request — returns the enriched context.
 */
export type CompiledMiddlewareFn = (
  req: TypoKitRequest,
  ctx: RequestContext,
) => Promise<RequestContext>;

/**
 * Compile a pre-sorted middleware chain into a single callable function.
 * Call at registration time; the returned function is invoked per-request
 * with zero loop/dispatch overhead for 0–1 middleware entries.
 *
 * - 0 entries → identity (pass-through, no async overhead)
 * - 1 entry  → direct handler call (no loop)
 * - N entries → flat indexed loop over pre-extracted handler references
 */
export function compileMiddlewareChain(
  entries: MiddlewareEntry[],
): CompiledMiddlewareFn {
  if (entries.length === 0) {
    // No middleware — synchronous identity wrapped in a resolved promise
    return (_req, ctx) => Promise.resolve(ctx);
  }

  if (entries.length === 1) {
    // Single middleware — direct call, no loop
    const handler = entries[0].middleware.handler;
    return async (req, ctx) => {
      const added = await handler({
        headers: req.headers,
        body: req.body,
        query: req.query,
        params: req.params,
        ctx,
      });
      if (added != null && typeof added === "object" && hasOwnKeys(added)) {
        Object.assign(ctx, added);
      }
      return ctx;
    };
  }

  // N middleware — flat loop over pre-extracted handler functions.
  // Avoids per-iteration property chain (.middleware.handler) and
  // for...of iterator protocol overhead.
  //
  // Fields are extracted from req inline per handler call rather than
  // pre-allocating a MiddlewareInput object. This enables V8 escape
  // analysis / allocation sinking and ensures each handler sees the
  // latest req properties (e.g., if a previous middleware mutated params).
  const handlers = entries.map((e) => e.middleware.handler);
  const len = handlers.length;

  return async (req, ctx) => {
    for (let i = 0; i < len; i++) {
      const added = await handlers[i]({
        headers: req.headers,
        body: req.body,
        query: req.query,
        params: req.params,
        ctx,
      });
      if (added != null && typeof added === "object" && hasOwnKeys(added)) {
        Object.assign(ctx, added);
      }
    }
    return ctx;
  };
}
