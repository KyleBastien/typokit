// @typokit/server-hono — Hono Server Adapter
//
// Translates TypoKit's compiled route table into Hono-native route
// registrations. Runs on any platform Hono supports via @hono/node-server
// for the listen() method.

import { Hono } from "hono";
import type { Context as HonoContext } from "hono";
import { serve } from "@hono/node-server";
import type {
  CompiledRoute,
  CompiledRouteTable,
  ErrorResponse,
  HandlerMap,
  HttpMethod,
  MiddlewareChain,
  SerializerMap,
  ServerHandle,
  TypoKitRequest,
  TypoKitResponse,
  ValidatorMap,
  ValidationFieldError,
} from "@typokit/types";
import type { ServerAdapter, MiddlewareEntry } from "@typokit/core";
import { createRequestContext, executeMiddlewareChain } from "@typokit/core";

// ─── Route Traversal ─────────────────────────────────────────

interface RouteEntry {
  method: HttpMethod;
  path: string;
  handlerRef: string;
  validators?: { params?: string; query?: string; body?: string };
  serializer?: string;
  middleware: string[];
}

/**
 * Recursively walk the compiled radix tree and collect all registered routes
 * as flat entries with their full paths reconstructed.
 */
function collectRoutes(
  node: CompiledRoute,
  prefix: string,
  entries: RouteEntry[],
): void {
  if (node.handlers) {
    for (const [method, handler] of Object.entries(node.handlers)) {
      if (handler) {
        entries.push({
          method: method as HttpMethod,
          path: prefix || "/",
          handlerRef: handler.ref,
          validators: handler.validators,
          serializer: handler.serializer,
          middleware: handler.middleware,
        });
      }
    }
  }

  // Static children
  if (node.children) {
    for (const [segment, child] of Object.entries(node.children)) {
      collectRoutes(child, `${prefix}/${segment}`, entries);
    }
  }

  // Param child (:id) — Hono uses :param syntax same as TypoKit
  if (node.paramChild) {
    const paramNode = node.paramChild;
    collectRoutes(paramNode, `${prefix}/:${paramNode.paramName}`, entries);
  }

  // Wildcard child (*path)
  if (node.wildcardChild) {
    const wildcardNode = node.wildcardChild;
    collectRoutes(wildcardNode, `${prefix}/*`, entries);
  }
}

// ─── Request Validation Pipeline ─────────────────────────────

function validationErrorResponse(
  message: string,
  fields: ValidationFieldError[],
): TypoKitResponse {
  const body: ErrorResponse = {
    error: {
      code: "VALIDATION_ERROR",
      message,
      details: { fields },
    },
  };
  return {
    status: 400,
    headers: { "content-type": "application/json" },
    body,
  };
}

function runValidators(
  routeHandler: {
    validators?: { params?: string; query?: string; body?: string };
  },
  validatorMap: ValidatorMap | null,
  params: Record<string, string>,
  query: Record<string, string | string[] | undefined>,
  body: unknown,
): TypoKitResponse | undefined {
  if (!validatorMap || !routeHandler.validators) {
    return undefined;
  }

  const allErrors: ValidationFieldError[] = [];

  if (routeHandler.validators.params) {
    const validator = validatorMap[routeHandler.validators.params];
    if (validator) {
      const result = validator(params);
      if (!result.success && result.errors) {
        for (const e of result.errors) {
          allErrors.push({
            path: `params.${e.path}`,
            expected: e.expected,
            actual: e.actual,
          });
        }
      }
    }
  }

  if (routeHandler.validators.query) {
    const validator = validatorMap[routeHandler.validators.query];
    if (validator) {
      const result = validator(query);
      if (!result.success && result.errors) {
        for (const e of result.errors) {
          allErrors.push({
            path: `query.${e.path}`,
            expected: e.expected,
            actual: e.actual,
          });
        }
      }
    }
  }

  if (routeHandler.validators.body) {
    const validator = validatorMap[routeHandler.validators.body];
    if (validator) {
      const result = validator(body);
      if (!result.success && result.errors) {
        for (const e of result.errors) {
          allErrors.push({
            path: `body.${e.path}`,
            expected: e.expected,
            actual: e.actual,
          });
        }
      }
    }
  }

  if (allErrors.length > 0) {
    return validationErrorResponse("Request validation failed", allErrors);
  }

  return undefined;
}

// ─── Response Serialization Pipeline ──────────────────────────

function serializeResponse(
  response: TypoKitResponse,
  serializerRef: string | undefined,
  serializerMap: SerializerMap | null,
): TypoKitResponse {
  if (
    response.body === null ||
    response.body === undefined ||
    typeof response.body === "string"
  ) {
    return response;
  }

  const headers = { ...response.headers };
  if (!headers["content-type"]) {
    headers["content-type"] = "application/json";
  }

  if (serializerRef && serializerMap) {
    const serializer = serializerMap[serializerRef];
    if (serializer) {
      return {
        ...response,
        headers,
        body: serializer(response.body),
      };
    }
  }

  return {
    ...response,
    headers,
    body: JSON.stringify(response.body),
  };
}

// ─── Hono Server Adapter ─────────────────────────────────────

interface HonoServerState {
  routeTable: CompiledRouteTable | null;
  handlerMap: HandlerMap | null;
  middlewareChain: MiddlewareChain | null;
  validatorMap: ValidatorMap | null;
  serializerMap: SerializerMap | null;
}

/**
 * Create a Hono server adapter for TypoKit.
 *
 * ```ts
 * import { honoServer } from "@typokit/server-hono";
 * const adapter = honoServer();
 * adapter.registerRoutes(routeTable, handlerMap, middlewareChain, validatorMap);
 * const handle = await adapter.listen(3000);
 * ```
 */
export function honoServer(options?: { basePath?: string }): ServerAdapter {
  const app = new Hono();

  const state: HonoServerState = {
    routeTable: null,
    handlerMap: null,
    middlewareChain: null,
    validatorMap: null,
    serializerMap: null,
  };

  const _basePath = options?.basePath;

  /** Convert Hono context to TypoKitRequest */
  function normalizeRequest(raw: unknown): TypoKitRequest {
    const c = raw as HonoContext;
    const req = c.req;

    const headers: Record<string, string | string[] | undefined> = {};
    req.raw.headers.forEach((value: string, key: string) => {
      headers[key] = value;
    });

    // Parse query parameters from URL
    const url = new URL(req.url);
    const query: Record<string, string | string[] | undefined> = {};
    url.searchParams.forEach((value, key) => {
      const existing = query[key];
      if (existing !== undefined) {
        if (Array.isArray(existing)) {
          existing.push(value);
        } else {
          query[key] = [existing, value];
        }
      } else {
        query[key] = value;
      }
    });

    return {
      method: req.method.toUpperCase() as HttpMethod,
      path: url.pathname,
      headers,
      body: (c as unknown as Record<string, unknown>)._typoBody,
      query,
      params: c.req.param() as Record<string, string>,
    };
  }

  /** Write TypoKitResponse to Hono context — returns a Response */
  function writeResponse(raw: unknown, response: TypoKitResponse): void {
    // In Hono, responses are returned, not written imperatively.
    // We store the response on the context for the route handler to return.
    const c = raw as HonoContext;
    (c as unknown as Record<string, unknown>)._typoResponse = response;
  }

  function buildHonoResponse(response: TypoKitResponse): Response {
    const responseBody =
      response.body === null || response.body === undefined
        ? ""
        : typeof response.body === "string"
          ? response.body
          : JSON.stringify(response.body);

    const headers = new Headers();
    for (const [key, value] of Object.entries(response.headers)) {
      if (value !== undefined) {
        if (Array.isArray(value)) {
          for (const v of value) {
            headers.append(key, v);
          }
        } else {
          headers.set(key, value);
        }
      }
    }

    return new Response(responseBody, {
      status: response.status,
      headers,
    });
  }

  const adapter: ServerAdapter = {
    name: "hono",

    registerRoutes(
      routeTable: CompiledRouteTable,
      handlerMap: HandlerMap,
      middlewareChain: MiddlewareChain,
      validatorMap?: ValidatorMap,
      serializerMap?: SerializerMap,
    ): void {
      state.routeTable = routeTable;
      state.handlerMap = handlerMap;
      state.middlewareChain = middlewareChain;
      state.validatorMap = validatorMap ?? null;
      state.serializerMap = serializerMap ?? null;

      // Collect all routes from the compiled radix tree
      const routes: RouteEntry[] = [];
      collectRoutes(routeTable, "", routes);

      // Register each route as a Hono-native route
      for (const route of routes) {
        const method = route.method.toUpperCase();

        app.on(method, route.path, async (c: HonoContext) => {
          // Parse body for methods that have one
          let body: unknown = undefined;
          if (
            route.method === "POST" ||
            route.method === "PUT" ||
            route.method === "PATCH"
          ) {
            try {
              body = await c.req.json();
            } catch {
              body = undefined;
            }
          }

          // Stash body on context for normalizeRequest
          (c as unknown as Record<string, unknown>)._typoBody = body;

          const typoReq = normalizeRequest(c);

          // Run request validation pipeline (skip entirely when no validators)
          const v = route.validators;
          if (v && (v.params || v.query || v.body)) {
            const validationError = runValidators(
              { validators: v },
              state.validatorMap,
              typoReq.params,
              typoReq.query,
              typoReq.body,
            );
            if (validationError) {
              return buildHonoResponse(validationError);
            }
          }

          const handlerFn = state.handlerMap![route.handlerRef];
          if (!handlerFn) {
            const errorResp: TypoKitResponse = {
              status: 500,
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                error: "Internal Server Error",
                message: `Handler not found: ${route.handlerRef}`,
              }),
            };
            return buildHonoResponse(errorResp);
          }

          // Create request context and execute middleware chain
          let ctx = createRequestContext();

          if (
            state.middlewareChain &&
            state.middlewareChain.entries.length > 0
          ) {
            const entries: MiddlewareEntry[] =
              state.middlewareChain.entries.map((e) => ({
                name: e.name,
                middleware: {
                  handler: async (input) => {
                    const mwReq: TypoKitRequest = {
                      method: typoReq.method,
                      path: typoReq.path,
                      headers: input.headers,
                      body: input.body,
                      query: input.query,
                      params: input.params,
                    };
                    const response = await e.handler(
                      mwReq,
                      input.ctx,
                      async () => {
                        return { status: 200, headers: {}, body: null };
                      },
                    );
                    return response as unknown as Record<string, unknown>;
                  },
                },
              }));

            ctx = await executeMiddlewareChain(typoReq, ctx, entries);
          }

          // Call the handler
          const response = await handlerFn(typoReq, ctx);

          // Response serialization pipeline
          const serialized = serializeResponse(
            response,
            route.serializer,
            state.serializerMap,
          );

          return buildHonoResponse(serialized);
        });
      }
    },

    async listen(port: number): Promise<ServerHandle> {
      const server = serve({
        fetch: app.fetch,
        port,
        hostname: "0.0.0.0",
      });

      // Wait briefly for server to bind
      await new Promise<void>((resolve) => {
        server.once("listening", () => resolve());
        // If already listening, resolve immediately
        if (server.listening) resolve();
      });

      return {
        async close(): Promise<void> {
          await new Promise<void>((resolve, reject) => {
            server.close((err?: Error) => {
              if (err) reject(err);
              else resolve();
            });
          });
        },
        // Expose server for port retrieval in tests
        _server: server,
      } as ServerHandle & { _server: typeof server };
    },

    normalizeRequest,
    writeResponse,

    getNativeServer(): unknown {
      return app;
    },
  };

  return adapter;
}

// Re-export for convenience
export { serializeResponse, runValidators, validationErrorResponse };
export { type ServerAdapter } from "@typokit/core";
