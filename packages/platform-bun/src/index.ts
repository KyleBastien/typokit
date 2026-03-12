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
// Avoids per-request new Headers() construction for JSON responses.

function makeJsonResponseInit(status: number): ResponseInit {
  const h = new Headers();
  h.set("content-type", "application/json");
  return { status, headers: h };
}

const JSON_RESPONSE_INIT_200 = makeJsonResponseInit(200);
const JSON_RESPONSE_INIT_400 = makeJsonResponseInit(400);
const JSON_RESPONSE_INIT_404 = makeJsonResponseInit(404);
const JSON_RESPONSE_INIT_500 = makeJsonResponseInit(500);

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
 * Normalize a Web API Request (used by Bun.serve) into a TypoKitRequest.
 *
 * Optimized for Bun's native APIs:
 * - Uses indexOf/substring for path extraction instead of `new URL()`
 * - Uses `req.json()` for JSON bodies (Bun's native zero-copy parser)
 * - Uses `req.text()` for non-JSON bodies
 * - Eagerly copies headers via forEach() — avoids Proxy trap overhead
 */
export async function normalizeRequest(req: Request): Promise<TypoKitRequest> {
  // Fast path extraction: avoid new URL() constructor.
  // In Bun.serve, req.url is a full URL like "http://host:port/path?query"
  const rawUrl = req.url;
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

  // Body: use Bun-native zero-copy methods
  let body: unknown = undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        body = await req.json();
      } catch {
        // Malformed JSON — body stays undefined
        body = undefined;
      }
    } else {
      const raw = await req.text();
      if (raw) {
        body = raw;
      }
    }
  }

  // Fresh object per request — safe to mutate (e.g. req.params = params in server-native)
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
 * Convert a TypoKitResponse into a Web API Response for Bun.serve().
 *
 * Fast path: when headers contain only `content-type: application/json`
 * (or no headers at all with an object body), uses pre-allocated
 * ResponseInit constants — avoids per-request new Headers() construction.
 */
export function buildResponse(response: TypoKitResponse): Response {
  const responseHeaders = response.headers;
  const body = response.body;

  // Fast path: JSON object body with JSON-only or empty headers
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
      const init = jsonResponseInitByStatus[response.status];
      if (init) {
        return new Response(JSON.stringify(body), init);
      }
      // Uncommon status code — still avoid per-request Headers for JSON
      return new Response(
        JSON.stringify(body),
        makeJsonResponseInit(response.status),
      );
    }
  }

  // Slow path: custom headers or non-JSON body
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
  let bunServer: BunServer | null = null;

  const instance: BunServerInstance = {
    get server(): BunServer | null {
      return bunServer;
    },
    listen(port: number): Promise<ServerHandle> {
      return new Promise((resolve, reject) => {
        try {
          const bun = (globalThis as unknown as { Bun: BunGlobal }).Bun;
          bunServer = bun.serve({
            port,
            hostname,
            async fetch(req: Request): Promise<Response> {
              try {
                const normalized = await normalizeRequest(req);
                const response = await handler(normalized);
                return buildResponse(response);
              } catch (err: unknown) {
                return new Response(
                  JSON.stringify({
                    error: "Internal Server Error",
                    message:
                      err instanceof Error ? err.message : "Unknown error",
                  }),
                  {
                    status: 500,
                    headers: { "content-type": "application/json" },
                  },
                );
              }
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
