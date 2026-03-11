// @typokit/server-native — Built-In Server Adapter
//
// Zero-dependency native HTTP server that uses the compiled radix tree
// for O(k) route lookup (k = number of path segments).

import type { ServerResponse } from "node:http";
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
  sortMiddlewareEntries,
  JSON_HEADERS,
} from "@typokit/core";
import {
  writeResponse as nodeWriteResponse,
  createServer,
} from "@typokit/platform-node";

// ─── Route Lookup ────────────────────────────────────────────

interface LookupResult {
  node: CompiledRoute;
  params: Record<string, string>;
}

/** Normalize path: strip trailing slash (keep "/" as-is) */
function normalizePath(path: string): string {
  if (path.length > 1 && path.endsWith("/")) {
    return path.slice(0, -1);
  }
  return path;
}

/**
 * Traverse the compiled radix tree to find the route node matching the
 * given path segments. Returns the matching node and extracted params,
 * or undefined if no route matches.
 */
function lookupRoute(
  root: CompiledRoute,
  segments: string[],
): LookupResult | undefined {
  let current = root;
  const params: Record<string, string> = {};

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];

    // 1. Try static child match first (O(1) hash lookup)
    if (current.children?.[seg]) {
      current = current.children[seg];
      continue;
    }

    // 2. Try parameterized child (:id)
    if (current.paramChild) {
      const paramNode = current.paramChild;
      params[paramNode.paramName] = decodeURIComponent(seg);
      current = paramNode;
      continue;
    }

    // 3. Try wildcard child (*path) — captures remaining segments
    if (current.wildcardChild) {
      const wildcardNode = current.wildcardChild;
      params[wildcardNode.paramName] = segments
        .slice(i)
        .map(decodeURIComponent)
        .join("/");
      return { node: wildcardNode, params };
    }

    // No match
    return undefined;
  }

  return { node: current, params };
}

/** Collect all HTTP methods registered at a given route node */
function collectMethods(node: CompiledRoute): HttpMethod[] {
  if (!node.handlers) return [];
  return Object.keys(node.handlers) as HttpMethod[];
}

// ─── Request Validation Pipeline ─────────────────────────────

/** Build a 400 validation error response matching ErrorResponse schema */
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

/**
 * Run the request validation pipeline for params, query, and body.
 * Returns a 400 TypoKitResponse on validation failure, or undefined if all pass.
 */
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

  // Validate params
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

  // Validate query
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

  // Validate body
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

/**
 * Serialize the response body using a compiled fast-json-stringify schema
 * if available, otherwise fall back to the default (JSON.stringify via writeResponse).
 * Automatically sets Content-Type to application/json for JSON bodies.
 *
 * Optimized to reuse pre-computed JSON_HEADERS when the response has no
 * custom headers, avoiding per-request object allocation.
 */
function serializeResponse(
  response: TypoKitResponse,
  serializerRef: string | undefined,
  serializerMap: SerializerMap | null,
): TypoKitResponse {
  // Nothing to serialize for null/undefined/string/Buffer bodies
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

  // Try compiled serializer first
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

  // Fall back to JSON.stringify
  return {
    status: response.status,
    headers,
    body: JSON.stringify(response.body),
  };
}

// ─── Native Server Adapter ───────────────────────────────────

interface NativeServerState {
  routeTable: CompiledRouteTable | null;
  handlerMap: HandlerMap | null;
  middlewareChain: MiddlewareChain | null;
  sortedMiddlewareEntries: MiddlewareEntry[] | null;
  validatorMap: ValidatorMap | null;
  serializerMap: SerializerMap | null;
}

/**
 * Create the native server adapter — TypoKit's built-in HTTP server.
 *
 * ```ts
 * import { nativeServer } from "@typokit/server-native";
 * const adapter = nativeServer();
 * adapter.registerRoutes(routeTable, handlerMap, middlewareChain, validatorMap);
 * const handle = await adapter.listen(3000);
 * ```
 */
export function nativeServer(): ServerAdapter {
  const state: NativeServerState = {
    routeTable: null,
    handlerMap: null,
    middlewareChain: null,
    sortedMiddlewareEntries: null,
    validatorMap: null,
    serializerMap: null,
  };

  // Shared reference updated per-request for middleware wrapper closures
  let currentReq: TypoKitRequest | null = null;

  let nativeServerInstance: ReturnType<typeof createServer> | null = null;

  /** Handle a single incoming request */
  async function handleRequest(req: TypoKitRequest): Promise<TypoKitResponse> {
    if (!state.routeTable || !state.handlerMap) {
      return {
        status: 500,
        headers: JSON_HEADERS,
        body: { error: "Server not configured" },
      };
    }

    // Normalize trailing slashes
    const path = normalizePath(req.path);
    const segments = path === "/" ? [] : path.slice(1).split("/");

    const result = lookupRoute(state.routeTable, segments);

    // 404 — no route matches
    if (!result) {
      return {
        status: 404,
        headers: JSON_HEADERS,
        body: {
          error: "Not Found",
          message: `No route matches ${req.method} ${req.path}`,
        },
      };
    }

    const { node, params } = result;
    const method = req.method;

    // 405 — route exists but method not allowed
    if (!node.handlers?.[method]) {
      const allowed = collectMethods(node);
      if (allowed.length === 0) {
        return {
          status: 404,
          headers: JSON_HEADERS,
          body: {
            error: "Not Found",
            message: `No route matches ${req.method} ${req.path}`,
          },
        };
      }
      return {
        status: 405,
        headers: {
          "content-type": "application/json",
          allow: allowed.join(", "),
        },
        body: {
          error: "Method Not Allowed",
          message: `${method} not allowed. Use: ${allowed.join(", ")}`,
        },
      };
    }

    const routeHandler = node.handlers[method]!;

    // ── Request Validation Pipeline (skip entirely when no validators) ──
    const v = routeHandler.validators;
    if (v && (v.params || v.query || v.body)) {
      const validationError = runValidators(
        routeHandler,
        state.validatorMap,
        params,
        req.query,
        req.body,
      );
      if (validationError) {
        return validationError;
      }
    }

    const handlerFn = state.handlerMap[routeHandler.ref];

    if (!handlerFn) {
      return {
        status: 500,
        headers: JSON_HEADERS,
        body: {
          error: "Internal Server Error",
          message: `Handler not found: ${routeHandler.ref}`,
        },
      };
    }

    // Inject extracted params into the request
    const enrichedReq: TypoKitRequest = { ...req, params, path };

    // Create request context
    let ctx = createRequestContext();

    // Execute pre-sorted middleware chain if present
    if (state.sortedMiddlewareEntries && state.sortedMiddlewareEntries.length > 0) {
      currentReq = enrichedReq;
      ctx = await executeMiddlewareChain(enrichedReq, ctx, state.sortedMiddlewareEntries);
    }

    // Call the handler
    const response = await handlerFn(enrichedReq, ctx);

    // ── Response Serialization Pipeline ──
    return serializeResponse(
      response,
      routeHandler.serializer,
      state.serializerMap,
    );
  }

  const adapter: ServerAdapter = {
    name: "native",

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

      // Pre-build and sort middleware entries once at registration time
      if (middlewareChain && middlewareChain.entries.length > 0) {
        const entries: MiddlewareEntry[] = middlewareChain.entries.map((e) => ({
          name: e.name,
          middleware: {
            handler: async (input) => {
              const mwReq: TypoKitRequest = {
                method: currentReq!.method,
                path: currentReq!.path,
                headers: input.headers,
                body: input.body,
                query: input.query,
                params: input.params,
              };
              const response = await e.handler(mwReq, input.ctx, async () => {
                return { status: 200, headers: {}, body: null };
              });
              return response as unknown as Record<string, unknown>;
            },
          },
        }));
        state.sortedMiddlewareEntries = sortMiddlewareEntries(entries);
      } else {
        state.sortedMiddlewareEntries = null;
      }
    },

    async listen(port: number): Promise<ServerHandle> {
      nativeServerInstance = createServer(handleRequest);
      return nativeServerInstance.listen(port);
    },

    normalizeRequest(raw: unknown): TypoKitRequest {
      // Synchronous normalization from an already-parsed request object.
      // For internal use; the actual async normalization from IncomingMessage
      // happens inside the server's request handler via platform-node.
      const r = raw as TypoKitRequest;
      return {
        method: r.method,
        path: r.path,
        headers: r.headers ?? {},
        body: r.body,
        query: r.query ?? {},
        params: r.params ?? {},
      };
    },

    writeResponse(raw: unknown, response: TypoKitResponse): void {
      nodeWriteResponse(raw as ServerResponse, response);
    },

    getNativeServer(): unknown {
      return nativeServerInstance?.server ?? null;
    },
  };

  return adapter;
}

// Re-export for convenience
export { serializeResponse, runValidators, validationErrorResponse };
export { type ServerAdapter } from "@typokit/core";
