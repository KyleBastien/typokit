// @typokit/server-fastify — Fastify Server Adapter
//
// Translates TypoKit's compiled route table into Fastify-native route
// registrations. Fastify-native middleware runs before TypoKit middleware
// per the architecture (Section 6.3).

import Fastify from "fastify";
import type {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
  FastifyServerOptions,
} from "fastify";
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
import {
  createRequestContext,
  executeMiddlewareChain,
  JSON_HEADERS,
} from "@typokit/core";

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

  // Param child (:id)
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
    headers: JSON_HEADERS,
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

/** Fast check whether an object has any own enumerable keys (no array allocation). */
function hasOwnKeys(obj: Record<string, unknown>): boolean {
  for (const _k in obj) return true;
  return false;
}

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

  // Reuse pre-computed headers when possible to avoid per-request allocation
  const headers = response.headers["content-type"]
    ? response.headers
    : hasOwnKeys(response.headers)
      ? { ...response.headers, "content-type": "application/json" as const }
      : JSON_HEADERS;

  if (serializerRef && serializerMap) {
    const serializer = serializerMap[serializerRef];
    if (serializer) {
      return {
        status: response.status,
        headers,
        body: serializer(response.body),
      };
    }
  }

  return {
    status: response.status,
    headers,
    body: JSON.stringify(response.body),
  };
}

// ─── Fastify Server Adapter ──────────────────────────────────

interface FastifyServerState {
  routeTable: CompiledRouteTable | null;
  handlerMap: HandlerMap | null;
  middlewareChain: MiddlewareChain | null;
  validatorMap: ValidatorMap | null;
  serializerMap: SerializerMap | null;
}

/**
 * Create a Fastify server adapter for TypoKit.
 *
 * Options are passed directly to the Fastify constructor (logger, trustProxy, etc.).
 *
 * ```ts
 * import { fastifyServer } from "@typokit/server-fastify";
 * const adapter = fastifyServer({ logger: true, trustProxy: true });
 * adapter.registerRoutes(routeTable, handlerMap, middlewareChain, validatorMap);
 * const handle = await adapter.listen(3000);
 * ```
 */
export function fastifyServer(options?: FastifyServerOptions): ServerAdapter {
  const app: FastifyInstance = Fastify(options ?? {});

  const state: FastifyServerState = {
    routeTable: null,
    handlerMap: null,
    middlewareChain: null,
    validatorMap: null,
    serializerMap: null,
  };

  /** Convert Fastify request to TypoKitRequest */
  function normalizeRequest(raw: unknown): TypoKitRequest {
    const req = raw as FastifyRequest;

    // Extract path without query string — indexOf+substring avoids split array allocation
    const url = req.url;
    const qIdx = url.indexOf("?");
    const path = qIdx === -1 ? url : url.substring(0, qIdx);

    return {
      // req.method is already uppercase per HTTP spec — skip .toUpperCase()
      method: req.method as HttpMethod,
      path,
      // Fastify's req.headers is the Node.js IncomingMessage headers object — reuse directly
      headers: req.headers as Record<string, string | string[] | undefined>,
      body: req.body,
      // Fastify pre-parses query from the route definition
      query: (req.query ?? {}) as Record<string, string | string[] | undefined>,
      params: (req.params ?? {}) as Record<string, string>,
    };
  }

  /** Write TypoKitResponse to Fastify reply */
  function writeResponse(raw: unknown, response: TypoKitResponse): void {
    const reply = raw as FastifyReply;

    // Set headers — for...in avoids Object.entries() array allocation
    const headers = response.headers;
    for (const key in headers) {
      const value = headers[key];
      if (value !== undefined) {
        reply.header(key, value);
      }
    }

    reply.status(response.status);

    if (response.body === null || response.body === undefined) {
      reply.send("");
    } else {
      reply.send(response.body);
    }
  }

  const adapter: ServerAdapter = {
    name: "fastify",

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

      // Register each route as a Fastify-native route
      for (const route of routes) {
        app.route({
          method: route.method,
          url: route.path,
          handler: async (req: FastifyRequest, reply: FastifyReply) => {
            const typoReq = normalizeRequest(req);

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
                writeResponse(reply, validationError);
                return;
              }
            }

            const handlerFn = state.handlerMap![route.handlerRef];
            if (!handlerFn) {
              const errorResp: TypoKitResponse = {
                status: 500,
                headers: JSON_HEADERS,
                body: JSON.stringify({
                  error: "Internal Server Error",
                  message: `Handler not found: ${route.handlerRef}`,
                }),
              };
              writeResponse(reply, errorResp);
              return;
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

            writeResponse(reply, serialized);
          },
        });
      }
    },

    async listen(port: number): Promise<ServerHandle> {
      await app.listen({ port, host: "0.0.0.0" });

      return {
        async close(): Promise<void> {
          await app.close();
        },
      };
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
