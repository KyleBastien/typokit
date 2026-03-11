// @typokit/server-express — Express Server Adapter
//
// Translates TypoKit's compiled route table into Express-native route
// registrations. Provides a migration path for teams with existing
// Express applications.

import express from "express";
import type { Express, Request, Response, Application } from "express";
import { createServer } from "node:http";
import type { Server } from "node:http";
import type {
  CompiledRoute,
  CompiledRouteTable,
  ErrorResponse,
  HandlerMap,
  HttpMethod,
  MiddlewareChain,
  RawValidatorMap,
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
  resolveValidatorMap,
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

  // Param child (:id) — Express uses :param syntax same as TypoKit
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
  routeRef: string,
  validatorMap: ValidatorMap | null,
  params: Record<string, string>,
  query: Record<string, string | string[] | undefined>,
  body: unknown,
): TypoKitResponse | undefined {
  if (!validatorMap) {
    return undefined;
  }

  const validators = validatorMap[routeRef];
  if (!validators) {
    return undefined;
  }

  const allErrors: ValidationFieldError[] = [];

  if (validators.params) {
    const result = validators.params(params);
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

  if (validators.query) {
    const result = validators.query(query);
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

  if (validators.body) {
    const result = validators.body(body);
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

// ─── Express Server Adapter ──────────────────────────────────

export interface ExpressServerOptions {
  /** Pass an existing Express app instance instead of creating a new one */
  app?: Express;
}

interface ExpressServerState {
  routeTable: CompiledRouteTable | null;
  handlerMap: HandlerMap | null;
  middlewareChain: MiddlewareChain | null;
  validatorMap: ValidatorMap | null;
  serializerMap: SerializerMap | null;
}

/**
 * Create an Express server adapter for TypoKit.
 *
 * Provides a migration path for teams with existing Express applications.
 *
 * ```ts
 * import { expressServer } from "@typokit/server-express";
 * const adapter = expressServer();
 * adapter.registerRoutes(routeTable, handlerMap, middlewareChain, validatorMap);
 * const handle = await adapter.listen(3000);
 * ```
 */
export function expressServer(options?: ExpressServerOptions): ServerAdapter {
  const app: Express = options?.app ?? express();

  // Enable JSON body parsing
  app.use(express.json());

  const state: ExpressServerState = {
    routeTable: null,
    handlerMap: null,
    middlewareChain: null,
    validatorMap: null,
    serializerMap: null,
  };

  /** Convert Express request to TypoKitRequest */
  function normalizeRequest(raw: unknown): TypoKitRequest {
    const req = raw as Request;
    const headers: Record<string, string | string[] | undefined> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      headers[key] = value;
    }

    const query: Record<string, string | string[] | undefined> = {};
    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value === "string") {
        query[key] = value;
      } else if (Array.isArray(value)) {
        query[key] = value as string[];
      }
    }

    return {
      method: req.method.toUpperCase() as HttpMethod,
      path: req.path,
      headers,
      body: req.body as unknown,
      query,
      params: (req.params as Record<string, string>) ?? {},
    };
  }

  /** Write TypoKitResponse to Express response */
  function writeResponse(raw: unknown, response: TypoKitResponse): void {
    const res = raw as Response;

    // Set headers — for...in avoids Object.entries() array allocation
    const headers = response.headers;
    for (const key in headers) {
      const value = headers[key];
      if (value !== undefined) {
        res.set(key, value);
      }
    }

    res.status(response.status);

    if (response.body === null || response.body === undefined) {
      res.end("");
    } else {
      res.send(response.body);
    }
  }

  const adapter: ServerAdapter = {
    name: "express",

    registerRoutes(
      routeTable: CompiledRouteTable,
      handlerMap: HandlerMap,
      middlewareChain: MiddlewareChain,
      validatorMap?: RawValidatorMap,
      serializerMap?: SerializerMap,
    ): void {
      state.routeTable = routeTable;
      state.handlerMap = handlerMap;
      state.middlewareChain = middlewareChain;
      state.validatorMap = validatorMap
        ? resolveValidatorMap(routeTable, validatorMap)
        : null;
      state.serializerMap = serializerMap ?? null;

      // Collect all routes from the compiled radix tree
      const routes: RouteEntry[] = [];
      collectRoutes(routeTable, "", routes);

      // Register each route as an Express-native route
      for (const route of routes) {
        const method = route.method.toLowerCase() as keyof Pick<
          Application,
          "get" | "post" | "put" | "delete" | "patch" | "options" | "head"
        >;

        app[method](route.path, async (req: Request, res: Response) => {
          const typoReq = normalizeRequest(req);

          // Run request validation pipeline (single lookup by route ref)
          if (state.validatorMap) {
            const validationError = runValidators(
              route.handlerRef,
              state.validatorMap,
              typoReq.params,
              typoReq.query,
              typoReq.body,
            );
            if (validationError) {
              writeResponse(res, validationError);
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
            writeResponse(res, errorResp);
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

          writeResponse(res, serialized);
        });
      }
    },

    async listen(port: number): Promise<ServerHandle> {
      const server: Server = createServer(app);

      await new Promise<void>((resolve) => {
        server.listen(port, "0.0.0.0", () => resolve());
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
        _server: server,
      } as ServerHandle & { _server: Server };
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
