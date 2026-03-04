// @typokit/core — Middleware System

import type { TypoKitRequest, RequestContext, Logger } from "@typokit/types";
import { createAppError } from "@typokit/errors";

/** Input received by a defineMiddleware handler */
export interface MiddlewareInput {
  headers: TypoKitRequest["headers"];
  body: TypoKitRequest["body"];
  query: TypoKitRequest["query"];
  params: TypoKitRequest["params"];
  ctx: RequestContext;
}

/** A typed middleware created by defineMiddleware */
export interface Middleware<TAdded extends Record<string, unknown> = Record<string, unknown>> {
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

/** Create a no-op placeholder logger (actual implementation in observability phase) */
export function createPlaceholderLogger(): Logger {
  const noop = () => {};
  return {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
  };
}

/** Create a RequestContext with ctx.fail() and ctx.log placeholder */
export function createRequestContext(overrides?: Partial<RequestContext>): RequestContext {
  return {
    log: createPlaceholderLogger(),
    fail(status: number, code: string, message: string, details?: Record<string, unknown>): never {
      throw createAppError(status, code, message, details);
    },
    services: {},
    requestId: Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2),
    ...overrides,
  };
}

/**
 * Execute a middleware chain in priority order (lower priority runs first).
 * Each middleware's returned properties are accumulated onto the context.
 * Middleware can short-circuit by throwing an error.
 */
export async function executeMiddlewareChain(
  req: TypoKitRequest,
  ctx: RequestContext,
  entries: MiddlewareEntry[],
): Promise<RequestContext> {
  const sorted = [...entries].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

  let currentCtx = ctx;
  for (const entry of sorted) {
    const added = await entry.middleware.handler({
      headers: req.headers,
      body: req.body,
      query: req.query,
      params: req.params,
      ctx: currentCtx,
    });
    currentCtx = { ...currentCtx, ...added } as RequestContext;
  }

  return currentCtx;
}
