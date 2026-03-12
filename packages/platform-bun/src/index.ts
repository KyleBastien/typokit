// @typokit/platform-bun — Bun Platform Adapter

import type {
  HttpMethod,
  ServerHandle,
  TypoKitRequest,
  TypoKitResponse,
} from "@typokit/types";

// ─── Bun Type Declarations ──────────────────────────────────
// Minimal type declarations for Bun APIs so this package compiles
// without bun-types installed (they're only available in Bun runtimes).

/** Subset of Bun's Server type we rely on */
interface BunServer {
  port: number;
  hostname: string;
  stop(closeActiveConnections?: boolean): void;
}

/** Options passed to Bun.serve() */
interface BunServeOptions {
  port: number;
  hostname: string;
  fetch(req: Request): Promise<Response> | Response;
}

/** Minimal shape of the global Bun object */
interface BunGlobal {
  version: string;
  serve(options: BunServeOptions): BunServer;
}

// ─── Platform Info ───────────────────────────────────────────

/** Runtime platform metadata for diagnostics and inspect commands */
export interface PlatformInfo {
  runtime: string;
  version: string;
}

/** Returns Bun platform info */
export function getPlatformInfo(): PlatformInfo {
  const bun = (globalThis as unknown as { Bun: BunGlobal }).Bun;
  return {
    runtime: "bun",
    version: bun?.version ?? "unknown",
  };
}

// ─── Pre-allocated JSON ResponseInit constants ──────────────
// Uses plain header objects (not new Headers()) — Bun's Response constructor
// accepts Record<string, string> directly, avoiding per-request allocation.

export const JSON_CT_HEADERS: Record<string, string> = {
  "content-type": "application/json",
};

const JSON_RESPONSE_INIT_200: ResponseInit = {
  status: 200,
  headers: JSON_CT_HEADERS,
};
const JSON_RESPONSE_INIT_400: ResponseInit = {
  status: 400,
  headers: JSON_CT_HEADERS,
};
const JSON_RESPONSE_INIT_404: ResponseInit = {
  status: 404,
  headers: JSON_CT_HEADERS,
};
const JSON_RESPONSE_INIT_500: ResponseInit = {
  status: 500,
  headers: JSON_CT_HEADERS,
};

const jsonResponseInitByStatus: Record<number, ResponseInit | undefined> = {
  200: JSON_RESPONSE_INIT_200,
  400: JSON_RESPONSE_INIT_400,
  404: JSON_RESPONSE_INIT_404,
  500: JSON_RESPONSE_INIT_500,
};

// ─── Request / Response Helpers ──────────────────────────────

/** Parse a raw query string (without leading '?') into a Record */
function parseQuery(qs: string): Record<string, string | string[] | undefined> {
  if (!qs) return {};
  const result: Record<string, string | string[] | undefined> = {};
  const searchParams = new URLSearchParams(qs);
  for (const [key, value] of searchParams.entries()) {
    const existing = result[key];
    if (existing === undefined) {
      result[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      result[key] = [existing, value];
    }
  }
  return result;
}

/**
 * Eagerly copy Web API Headers into a plain object.
 * Uses headers.forEach() — the fastest iteration method for Web API Headers
 * in Bun — to avoid Proxy trap overhead on every header access.
 */
function copyHeaders(
  native: Headers,
): Record<string, string | string[] | undefined> {
  const obj = Object.create(null) as Record<
    string,
    string | string[] | undefined
  >;
  native.forEach((value: string, key: string) => {
    obj[key] = value;
  });
  return obj;
}

/**
 * Extract path, query string, and normalized path from a raw URL.
 * Shared between sync and async normalizeRequest variants.
 * Uses indexOf/substring — avoids new URL() constructor.
 */
function extractPathAndQuery(rawUrl: string): {
  path: string;
  queryString: string;
} {
  const protoEnd = rawUrl.indexOf("//");
  const pathStart = protoEnd !== -1 ? rawUrl.indexOf("/", protoEnd + 2) : 0;
  const start = pathStart !== -1 ? pathStart : rawUrl.length;
  const qIdx = rawUrl.indexOf("?", start);
  const rawPath =
    start >= rawUrl.length
      ? "/"
      : qIdx === -1
        ? rawUrl.substring(start)
        : rawUrl.substring(start, qIdx);
  const queryString = qIdx === -1 ? "" : rawUrl.substring(qIdx + 1);

  // Strip trailing slash (keep "/" as-is) for consistent routing
  const path =
    rawPath.length > 1 && rawPath.charCodeAt(rawPath.length - 1) === 47
      ? rawPath.substring(0, rawPath.length - 1)
      : rawPath;

  return { path, queryString };
}

/** Methods that never carry a request body */
const BODYLESS_METHODS = new Set(["GET", "HEAD", "DELETE", "OPTIONS"]);

/**
 * Synchronous normalizeRequest for bodyless methods (GET, HEAD, DELETE, OPTIONS).
 * Creates zero Promises — avoids async overhead entirely on the Bun hot path.
 *
 * Fresh object per request — safe to mutate (e.g. req.params = params in server-native).
 */
export function normalizeRequestSync(req: Request): TypoKitRequest {
  const { path, queryString } = extractPathAndQuery(req.url);
  return {
    method: req.method.toUpperCase() as HttpMethod,
    path,
    headers: copyHeaders(req.headers),
    body: undefined,
    query: parseQuery(queryString),
    params: {},
  };
}

/**
 * Async normalizeRequest for methods with bodies (POST, PUT, PATCH).
 * Uses Bun-native zero-copy req.json()/req.text() for body parsing.
 *
 * Fresh object per request — safe to mutate (e.g. req.params = params in server-native).
 */
export async function normalizeRequestAsync(
  req: Request,
): Promise<TypoKitRequest> {
  const { path, queryString } = extractPathAndQuery(req.url);

  let body: unknown = undefined;
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      body = await req.json();
    } catch {
      body = undefined;
    }
  } else {
    const raw = await req.text();
    if (raw) {
      body = raw;
    }
  }

  return {
    method: req.method.toUpperCase() as HttpMethod,
    path,
    headers: copyHeaders(req.headers),
    body,
    query: parseQuery(queryString),
    params: {},
  };
}

/**
 * Normalize a Web API Request into a TypoKitRequest.
 * Delegates to sync or async variant based on HTTP method.
 *
 * @deprecated Prefer normalizeRequestSync / normalizeRequestAsync directly
 * for optimal performance. This wrapper remains for backward compatibility.
 */
export async function normalizeRequest(req: Request): Promise<TypoKitRequest> {
  const method = req.method.toUpperCase();
  if (BODYLESS_METHODS.has(method)) {
    return normalizeRequestSync(req);
  }
  return normalizeRequestAsync(req);
}

/**
 * Convert a TypoKitResponse into a Web API Response for Bun.serve().
 *
 * Fast path: JSON object bodies with JSON-only headers use pre-allocated
 * plain header objects — Bun's Response constructor accepts
 * Record<string, string> directly, avoiding new Headers() entirely.
 */
export function buildResponse(response: TypoKitResponse): Response {
  const responseHeaders = response.headers;
  const body = response.body;

  // Fast path: JSON object body with JSON-only or empty headers
  // Detects when responseHeaders has 0 keys or only { "content-type": "application/json" }
  if (body !== null && body !== undefined && typeof body !== "string") {
    let jsonFastPath = true;
    let headerCount = 0;
    for (const key in responseHeaders) {
      headerCount++;
      if (
        headerCount > 1 ||
        key !== "content-type" ||
        responseHeaders[key] !== "application/json"
      ) {
        jsonFastPath = false;
        break;
      }
    }

    if (jsonFastPath) {
      // Use pre-allocated init for common status codes, inline for uncommon ones.
      // Plain header objects — no new Headers() per request.
      return new Response(
        JSON.stringify(body),
        jsonResponseInitByStatus[response.status] ?? {
          status: response.status,
          headers: JSON_CT_HEADERS,
        },
      );
    }
  }

  // Slow path: custom headers or non-JSON body — requires per-request Headers construction
  const headers = new Headers();
  for (const key in responseHeaders) {
    const value = responseHeaders[key];
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

  let bodyContent: string | null = null;
  if (body === null || body === undefined) {
    bodyContent = null;
  } else if (typeof body === "string") {
    bodyContent = body;
  } else {
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    bodyContent = JSON.stringify(body);
  }

  return new Response(bodyContent, {
    status: response.status,
    headers,
  });
}

// ─── Request Handler Type ────────────────────────────────────

/** Handler function that receives a normalized request and returns a response */
export type BunRequestHandler = (
  req: TypoKitRequest,
) => Promise<TypoKitResponse>;

// ─── Bun Server Options ─────────────────────────────────────

export interface BunServerOptions {
  /** Optional hostname to bind to (default: "0.0.0.0") */
  hostname?: string;
  /**
   * Optional fast-path handler that receives the raw Web API Request and
   * returns a Response directly, or null to fall back to the normal
   * normalizeRequest→handler→buildResponse path.
   */
  fastPath?: (req: Request) => Response | Promise<Response> | null;
}

// ─── Bun Server ─────────────────────────────────────────────

/** Result of createBunServer — provides listen/close and access to the underlying Bun server */
export interface BunServerInstance {
  /** Start listening on the given port. Returns a handle for graceful shutdown. */
  listen(port: number): Promise<ServerHandle>;
  /** The underlying Bun server instance (available after listen()) */
  server: BunServer | null;
}

/**
 * Create a Bun-native HTTP server that dispatches to a TypoKit request handler.
 * Uses `Bun.serve({ fetch })` directly — avoids node:http entirely.
 *
 * Usage:
 * ```ts
 * const srv = createBunServer(async (req) => ({
 *   status: 200,
 *   headers: {},
 *   body: { ok: true },
 * }));
 * const handle = await srv.listen(3000);
 * // ... later
 * await handle.close();
 * ```
 */
export function createBunServer(
  handler: BunRequestHandler,
  options: BunServerOptions = {},
): BunServerInstance {
  const hostname = options.hostname ?? "0.0.0.0";
  const { fastPath } = options;
  let bunServer: BunServer | null = null;

  const instance: BunServerInstance = {
    get server(): BunServer | null {
      return bunServer;
    },
    listen(port: number): Promise<ServerHandle> {
      return new Promise((resolve, reject) => {
        try {
          const bun = (globalThis as unknown as { Bun: BunGlobal }).Bun;

          // Normal async request handling (normalize → handler → buildResponse)
          const normalFetch = async (req: Request): Promise<Response> => {
            try {
              const method = req.method.toUpperCase();
              const normalized = BODYLESS_METHODS.has(method)
                ? normalizeRequestSync(req)
                : await normalizeRequestAsync(req);
              const response = await handler(normalized);
              return buildResponse(response);
            } catch (err: unknown) {
              return new Response(
                JSON.stringify({
                  error: "Internal Server Error",
                  message: err instanceof Error ? err.message : "Unknown error",
                }),
                {
                  status: 500,
                  headers: { "content-type": "application/json" },
                },
              );
            }
          };

          bunServer = bun.serve({
            port,
            hostname,
            fetch(req: Request): Promise<Response> | Response {
              // Fast path: bypass normalize/build for simple routes
              if (fastPath) {
                try {
                  const result = fastPath(req);
                  if (result !== null) return result;
                } catch {
                  // Fast path error — fall through to normal path
                }
              }
              return normalFetch(req);
            },
          });

          resolve({
            async close(): Promise<void> {
              if (bunServer) {
                bunServer.stop(true);
                bunServer = null;
              }
            },
          });
        } catch (err) {
          reject(err);
        }
      });
    },
  };

  return instance;
}

/**
 * @deprecated Use `createBunServer` instead. This alias is kept for backward compatibility.
 */
export const createServer = createBunServer;
