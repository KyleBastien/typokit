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
  RawValidatorMap,
  SerializerMap,
  ServerHandle,
  TypoKitRequest,
  TypoKitResponse,
  ValidatorMap,
  ValidationFieldError,
} from "@typokit/types";
import type { ServerAdapter, CompiledMiddlewareFn } from "@typokit/core";
import {
  createRequestContext,
  resolveValidatorMap,
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
 * Uses the pre-resolved route-keyed ValidatorMap for a single hash lookup.
 * Returns a 400 TypoKitResponse on validation failure, or undefined if all pass.
 */
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

  // Validate params
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

  // Validate query
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

  // Validate body
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

// ─── Runtime Detection ───────────────────────────────────────

/** True when running inside a Bun process */
const isBun = "Bun" in globalThis;

// ─── Native Server Adapter ───────────────────────────────────

interface NativeServerState {
  routeTable: CompiledRouteTable | null;
  handlerMap: HandlerMap | null;
  middlewareChain: MiddlewareChain | null;
  compiledMiddleware: CompiledMiddlewareFn | null;
  validatorMap: ValidatorMap | null;
  serializerMap: SerializerMap | null;
  /** Handlers with 2+ params need a RequestContext; others skip allocation */
  handlerNeedsCtx: Set<string>;
}

/**
 * Create the native server adapter — TypoKit's built-in HTTP server.
 *
 * Automatically detects the Bun runtime and delegates to the Bun-native
 * server path (`@typokit/platform-bun`) for near-native Bun performance.
 * On Node.js, uses `@typokit/platform-node` as before.
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
    handlerNeedsCtx: new Set(),
  };

  let nativeServerInstance: ReturnType<typeof createServer> | null = null;

  // Generic reference to the underlying server (http.Server on Node, BunServer on Bun)
  let nativeServerRef: unknown = null;

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

    // ── Request Validation Pipeline (single lookup by route ref) ──
    if (state.validatorMap) {
      const validationError = runValidators(
        routeHandler.ref,
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

    // Inject extracted params directly into the request object.
    // Safe to mutate: normalizeRequest() in platform-node and platform-bun
    // both create a fresh TypoKitRequest object per request.
    req.params = params;

    // Lazy context creation: only allocate when middleware or handler needs it.
    // Detected at registration time by checking handler.length >= 2.
    if (state.compiledMiddleware) {
      let ctx = createRequestContext();
      ctx = await state.compiledMiddleware(req, ctx);
      const response = await handlerFn(req, ctx);
      return serializeResponse(
        response,
        routeHandler.serializer,
        state.serializerMap,
      );
    }

    if (state.handlerNeedsCtx.has(routeHandler.ref)) {
      const ctx = createRequestContext();
      const response = await handlerFn(req, ctx);
      return serializeResponse(
        response,
        routeHandler.serializer,
        state.serializerMap,
      );
    }

    // Handler doesn't use ctx and no middleware — skip context allocation
    const response = await handlerFn(req, undefined as unknown as Parameters<typeof handlerFn>[1]);

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

      // Detect which handlers need a RequestContext (2+ params: req, ctx).
      // Handlers with .length < 2 never access ctx, so we skip allocation.
      state.handlerNeedsCtx = new Set();
      for (const ref in handlerMap) {
        if (handlerMap[ref].length >= 2) {
          state.handlerNeedsCtx.add(ref);
        }
      }

      // Compile middleware chain once at registration time.
      // Calls MiddlewareFn handlers directly with (req, ctx, next),
      // passing the request object by reference — zero per-request allocation.
      if (middlewareChain && middlewareChain.entries.length > 0) {
        const mwHandlers = middlewareChain.entries.map((e) => e.handler);
        const mwLen = mwHandlers.length;
        const noopNext = async (): Promise<TypoKitResponse> => ({
          status: 200,
          headers: {},
          body: null,
        });

        if (mwLen === 1) {
          const handler = mwHandlers[0];
          state.compiledMiddleware = async (req, ctx) => {
            const added: unknown = await handler(req, ctx, noopNext);
            if (
              added != null &&
              typeof added === "object" &&
              hasOwnKeys(added as Record<string, unknown>)
            ) {
              Object.assign(ctx, added);
            }
            return ctx;
          };
        } else {
          state.compiledMiddleware = async (req, ctx) => {
            for (let i = 0; i < mwLen; i++) {
              const added: unknown = await mwHandlers[i](req, ctx, noopNext);
              if (
                added != null &&
                typeof added === "object" &&
                hasOwnKeys(added as Record<string, unknown>)
              ) {
                Object.assign(ctx, added);
              }
            }
            return ctx;
          };
        }
      } else {
        state.compiledMiddleware = null;
      }
    },

    async listen(port: number): Promise<ServerHandle> {
      if (isBun) {
        // Bun runtime: use Bun.serve() via platform-bun for near-native performance
        const { createBunServer } = await import("@typokit/platform-bun");
        const bunInstance = createBunServer(handleRequest);
        const handle = await bunInstance.listen(port);
        nativeServerRef = bunInstance.server;
        return handle;
      }

      // Node.js runtime: use node:http via platform-node
      nativeServerInstance = createServer(handleRequest);
      const handle = await nativeServerInstance.listen(port);
      nativeServerRef = nativeServerInstance.server;
      return handle;
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
      return nativeServerRef;
    },
  };

  return adapter;
}

// Re-export for convenience
export { serializeResponse, runValidators, validationErrorResponse };
export { type ServerAdapter } from "@typokit/core";
