// @typokit/platform-deno — Deno Platform Adapter

import type {
  HttpMethod,
  ServerHandle,
  TypoKitRequest,
  TypoKitResponse,
} from "@typokit/types";

// ─── Deno Type Declarations ─────────────────────────────────
// Minimal type declarations for Deno APIs so this package compiles
// without Deno types installed (they're only available in Deno runtimes).

/** Subset of Deno's HttpServer type we rely on */
interface DenoHttpServer {
  shutdown(): Promise<void>;
  finished: Promise<void>;
  addr: { port: number; hostname: string };
}

/** Options passed to Deno.serve() */
interface DenoServeOptions {
  port: number;
  hostname: string;
  onListen?: (addr: { port: number; hostname: string }) => void;
}

/** Minimal shape of the global Deno object */
interface DenoGlobal {
  version: { deno: string; v8: string; typescript: string };
  serve(
    options: DenoServeOptions,
    handler: (req: Request) => Promise<Response> | Response,
  ): DenoHttpServer;
}

// ─── Platform Info ───────────────────────────────────────────

/** Runtime platform metadata for diagnostics and inspect commands */
export interface PlatformInfo {
  runtime: string;
  version: string;
}

/** Returns Deno platform info */
export function getPlatformInfo(): PlatformInfo {
  const deno = (globalThis as unknown as { Deno: DenoGlobal }).Deno;
  return {
    runtime: "deno",
    version: deno?.version?.deno ?? "unknown",
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
 * Normalize a Web API Request (used by Deno.serve) into a TypoKitRequest.
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
 * Convert a TypoKitResponse into a Web API Response for Deno.serve().
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
export type DenoRequestHandler = (
  req: TypoKitRequest,
) => Promise<TypoKitResponse>;

// ─── Deno Server Options ─────────────────────────────────────

export interface DenoServerOptions {
  /** Optional hostname to bind to (default: "0.0.0.0") */
  hostname?: string;
}

// ─── Deno Server ─────────────────────────────────────────────

/** Result of createServer — provides listen/close and access to the underlying Deno server */
export interface DenoServerInstance {
  /** Start listening on the given port. Returns a handle for graceful shutdown. */
  listen(port: number): Promise<ServerHandle>;
  /** The underlying Deno HTTP server instance (available after listen()) */
  server: DenoHttpServer | null;
}

/**
 * Create a Deno HTTP server that dispatches to a TypoKit request handler.
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
  handler: DenoRequestHandler,
  options: DenoServerOptions = {},
): DenoServerInstance {
  const hostname = options.hostname ?? "0.0.0.0";
  let denoServer: DenoHttpServer | null = null;

  const instance: DenoServerInstance = {
    get server(): DenoHttpServer | null {
      return denoServer;
    },
    listen(port: number): Promise<ServerHandle> {
      return new Promise((resolve, reject) => {
        try {
          const deno = (globalThis as unknown as { Deno: DenoGlobal }).Deno;
          denoServer = deno.serve(
            {
              port,
              hostname,
              onListen() {
                resolve({
                  async close(): Promise<void> {
                    if (denoServer) {
                      await denoServer.shutdown();
                      denoServer = null;
                    }
                  },
                });
              },
            },
            async (req: Request): Promise<Response> => {
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
          );
        } catch (err) {
          reject(err);
        }
      });
    },
  };

  return instance;
}
