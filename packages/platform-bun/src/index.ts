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

/** Parse query string from a URL into a Record */
function parseQuery(
  searchParams: URLSearchParams,
): Record<string, string | string[] | undefined> {
  const result: Record<string, string | string[] | undefined> = {};
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

/** Normalize Web API headers into a flat Record */
function normalizeHeaders(
  headers: Headers,
): Record<string, string | string[] | undefined> {
  const result: Record<string, string | string[] | undefined> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

/**
 * Normalize a Web API Request (used by Bun.serve) into a TypoKitRequest.
 */
export async function normalizeRequest(req: Request): Promise<TypoKitRequest> {
  const url = new URL(req.url);

  let body: unknown = undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    const contentType = req.headers.get("content-type") ?? "";
    const raw = await req.text();
    if (raw) {
      if (contentType.includes("application/json")) {
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw;
        }
      } else {
        body = raw;
      }
    }
  }

  return {
    method: req.method.toUpperCase() as HttpMethod,
    path: url.pathname,
    headers: normalizeHeaders(req.headers),
    body,
    query: parseQuery(url.searchParams),
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

/** Result of createServer — provides listen/close and access to the underlying Bun server */
export interface BunServerInstance {
  /** Start listening on the given port. Returns a handle for graceful shutdown. */
  listen(port: number): Promise<ServerHandle>;
  /** The underlying Bun server instance (available after listen()) */
  server: BunServer | null;
}

/**
 * Create a Bun HTTP server that dispatches to a TypoKit request handler.
 *
 * Usage:
 * ```ts
 * const srv = createServer(async (req) => ({
 *   status: 200,
 *   headers: {},
 *   body: { ok: true },
 * }));
 * const handle = await srv.listen(3000);
 * // ... later
 * await handle.close();
 * ```
 */
export function createServer(
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
