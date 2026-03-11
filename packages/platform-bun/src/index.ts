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
 * Create a lazy headers proxy wrapping a native Headers object.
 * Avoids upfront conversion — individual headers are read via the
 * native Headers API on demand, skipping the O(N) copy.
 */
function lazyHeaders(
  native: Headers,
): Record<string, string | string[] | undefined> {
  const overrides = Object.create(null) as Record<
    string,
    string | string[] | undefined
  >;
  return new Proxy(overrides, {
    get(
      target: Record<string, string | string[] | undefined>,
      prop: string | symbol,
    ) {
      if (typeof prop === "string") {
        if (prop in target) return target[prop];
        return native.get(prop) ?? undefined;
      }
      return undefined;
    },
    set(
      target: Record<string, string | string[] | undefined>,
      prop: string | symbol,
      value: unknown,
    ) {
      if (typeof prop === "string") {
        target[prop] = value as string | string[] | undefined;
      }
      return true;
    },
    has(
      target: Record<string, string | string[] | undefined>,
      prop: string | symbol,
    ) {
      if (typeof prop === "string") {
        return prop in target || native.has(prop);
      }
      return false;
    },
    ownKeys(target: Record<string, string | string[] | undefined>) {
      const keys = new Set<string>(Object.keys(target));
      native.forEach((_v: string, k: string) => keys.add(k));
      return [...keys];
    },
    getOwnPropertyDescriptor(
      target: Record<string, string | string[] | undefined>,
      prop: string | symbol,
    ) {
      if (typeof prop === "string") {
        if (prop in target) {
          return {
            configurable: true,
            enumerable: true,
            value: target[prop],
          };
        }
        if (native.has(prop)) {
          return {
            configurable: true,
            enumerable: true,
            value: native.get(prop) ?? undefined,
          };
        }
      }
      return undefined;
    },
  });
}

/**
 * Normalize a Web API Request (used by Bun.serve) into a TypoKitRequest.
 *
 * Optimized for Bun's native APIs:
 * - Uses indexOf/substring for path extraction instead of `new URL()`
 * - Uses `req.json()` for JSON bodies (Bun's native zero-copy parser)
 * - Uses `req.text()` for non-JSON bodies
 * - Uses lazy Proxy-based headers to avoid upfront Headers → Record conversion
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

  return {
    method: req.method.toUpperCase() as HttpMethod,
    path,
    headers: lazyHeaders(req.headers),
    body,
    query: parseQuery(queryString),
    params: {},
  };
}

/**
 * Convert a TypoKitResponse into a Web API Response for Bun.serve().
 */
export function buildResponse(response: TypoKitResponse): Response {
  const headers = new Headers();
  const responseHeaders = response.headers;
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
  if (response.body === null || response.body === undefined) {
    bodyContent = null;
  } else if (typeof response.body === "string") {
    bodyContent = response.body;
  } else {
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    bodyContent = JSON.stringify(response.body);
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
