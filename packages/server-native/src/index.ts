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
import type { ServerAdapter, MiddlewareEntry, CompiledMiddlewareFn } from "@typokit/core";
import {
  createRequestContext,
  sortMiddlewareEntries,
  compileMiddlewareChain,
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

/**
 * Traverse the compiled radix tree to find the route node matching the
 * given path string. Uses index-based scanning to avoid allocating a
 * segments array — each segment is extracted via substring().
 * decodeURIComponent() is only called on parameter captures.
 */
function lookupRoute(
  root: CompiledRoute,
  path: string,
): LookupResult | undefined {
  // "/" maps to the root node with no segment traversal
  if (path === "/") return { node: root, params: {} };

  let current = root;
  const params: Record<string, string> = {};
  const len = path.length;
  // Start after the leading '/'
  let pos = 1;

  while (pos < len) {
    // Find the next '/' or end-of-string
    let end = pos;
    while (end < len && path.charCodeAt(end) !== 47 /* '/' */) end++;

    const seg = path.substring(pos, end);

    // 1. Try static child match first (O(1) hash lookup)
    if (current.children?.[seg]) {
      current = current.children[seg];
      pos = end + 1;
      continue;
    }

    // 2. Try parameterized child (:id) — decode only param values
    if (current.paramChild) {
      const paramNode = current.paramChild;
      params[paramNode.paramName] = decodeURIComponent(seg);
      current = paramNode;
      pos = end + 1;
      continue;
    }

    // 3. Try wildcard child (*path) — capture rest of path, decode each segment
    if (current.wildcardChild) {
      const wildcardNode = current.wildcardChild;
      // Decode each remaining segment individually (preserving '/' separators)
      let rest = "";
      let wpos = pos;
      let first = true;
      while (wpos < len) {
        let wend = wpos;
        while (wend < len && path.charCodeAt(wend) !== 47) wend++;
        if (!first) rest += "/";
        rest += decodeURIComponent(path.substring(wpos, wend));
        first = false;
        wpos = wend + 1;
      }
      params[wildcardNode.paramName] = rest;
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
  compiledMiddleware: CompiledMiddlewareFn | null;
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
    compiledMiddleware: null,
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

    // Path is already normalized (trailing slash stripped) by platform-node
    const result = lookupRoute(state.routeTable, req.path);

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
    const enrichedReq: TypoKitRequest = { ...req, params };

    // Create request context
    let ctx = createRequestContext();

    // Execute compiled middleware chain if present
    if (state.compiledMiddleware) {
      currentReq = enrichedReq;
      ctx = await state.compiledMiddleware(enrichedReq, ctx);
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

      // Compile middleware chain once at registration time
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
        state.compiledMiddleware = compileMiddlewareChain(
          sortMiddlewareEntries(entries),
        );
      } else {
        state.compiledMiddleware = null;
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
