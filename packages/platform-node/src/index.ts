// @typokit/platform-node — Node.js Platform Adapter

import { createServer as nodeCreateServer } from "node:http";
import type { IncomingMessage, ServerResponse, Server } from "node:http";
import type {
  HttpMethod,
  ServerHandle,
  TypoKitRequest,
  TypoKitResponse,
} from "@typokit/types";

// ─── Platform Info ───────────────────────────────────────────

/** Runtime platform metadata for diagnostics and inspect commands */
export interface PlatformInfo {
  runtime: string;
  version: string;
}

/** Returns Node.js platform info */
export function getPlatformInfo(): PlatformInfo {
  return {
    runtime: "node",
    version: process.version,
  };
}

// ─── Request / Response Helpers ──────────────────────────────

const SMALL_BODY_THRESHOLD = 16 * 1024; // 16 KB

/**
 * Collect the raw body of an IncomingMessage into a UTF-8 string.
 * - When content-length is known and ≤ 16 KB, uses a single pre-allocated buffer (no chunk array).
 * - When content-length is known and > 16 KB, passes size hint to Buffer.concat.
 * - Falls back to standard chunk array when content-length is absent.
 * JSON parsing is NOT done here — it is deferred lazily in normalizeRequest().
 */
function collectRawBody(req: IncomingMessage): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const contentLength = req.headers["content-length"];

    if (contentLength !== undefined) {
      const size = parseInt(contentLength, 10);

      if (size === 0 || Number.isNaN(size)) {
        // Drain stream so Node.js fires "end" properly, but resolve immediately
        req.resume();
        resolve(undefined);
        return;
      }

      if (size <= SMALL_BODY_THRESHOLD) {
        // Small body: single pre-allocated buffer, copy in place
        const buf = Buffer.allocUnsafe(size);
        let offset = 0;
        req.on("data", (chunk: Buffer) => {
          chunk.copy(buf, offset);
          offset += chunk.length;
        });
        req.on("error", reject);
        req.on("end", () => {
          resolve(offset > 0 ? buf.toString("utf-8", 0, offset) : undefined);
        });
        return;
      }

      // Larger body with known size: chunk array + size-hinted concat
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("error", reject);
      req.on("end", () => {
        if (chunks.length === 0) {
          resolve(undefined);
          return;
        }
        resolve(Buffer.concat(chunks, size).toString("utf-8"));
      });
      return;
    }

    // No content-length (chunked transfer): standard collection
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("error", reject);
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve(undefined);
        return;
      }
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });
  });
}

/** Parse a raw query string (without leading '?') into a Record */
function parseQuery(
  qs: string,
): Record<string, string | string[] | undefined> {
  if (!qs) return {};
  const result: Record<string, string | string[] | undefined> = {};
  // Use URLSearchParams only on the query portion — much cheaper than full URL construction
  const searchParams = new URLSearchParams(qs);
  for (const [key, value] of searchParams) {
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

/** Normalize Node.js headers into a flat Record — uses for...in to avoid Object.entries() allocation */
function normalizeHeaders(
  raw: IncomingMessage["headers"],
): Record<string, string | string[] | undefined> {
  const result: Record<string, string | string[] | undefined> = {};
  for (const key in raw) {
    result[key] = raw[key];
  }
  return result;
}

/**
 * Normalize a Node.js IncomingMessage into a TypoKitRequest.
 * Body is collected asynchronously from the stream.
 * JSON parsing is deferred lazily — only runs when .body is first accessed.
 * Uses indexOf/substring for path extraction instead of expensive new URL().
 */
export async function normalizeRequest(
  req: IncomingMessage,
): Promise<TypoKitRequest> {
  const rawUrl = req.url ?? "/";
  const qIdx = rawUrl.indexOf("?");
  const rawPath = qIdx === -1 ? rawUrl : rawUrl.substring(0, qIdx);
  const queryString = qIdx === -1 ? "" : rawUrl.substring(qIdx + 1);
  // Strip trailing slash (keep "/" as-is) so downstream routing skips re-normalization
  const path =
    rawPath.length > 1 && rawPath.charCodeAt(rawPath.length - 1) === 47
      ? rawPath.substring(0, rawPath.length - 1)
      : rawPath;
  const rawBody = await collectRawBody(req);

  const request: TypoKitRequest = {
    method: (req.method ?? "GET").toUpperCase() as HttpMethod,
    path,
    headers: normalizeHeaders(req.headers),
    body: undefined,
    query: parseQuery(queryString),
    params: {},
  };

  if (rawBody !== undefined) {
    const contentType = req.headers["content-type"] ?? "";
    if (contentType.includes("application/json")) {
      // Lazy JSON parsing: defer JSON.parse until .body is actually accessed
      let parsed: unknown;
      let isParsed = false;
      Object.defineProperty(request, "body", {
        get() {
          if (!isParsed) {
            isParsed = true;
            try {
              parsed = JSON.parse(rawBody);
            } catch {
              parsed = rawBody;
            }
          }
          return parsed;
        },
        enumerable: true,
        configurable: true,
      });
    } else {
      request.body = rawBody;
    }
  }

  return request;
}

/**
 * Write a TypoKitResponse to a Node.js ServerResponse.
 */
export function writeResponse(
  res: ServerResponse,
  response: TypoKitResponse,
): void {
  // Set headers — for...in avoids Object.entries() array allocation
  const headers = response.headers;
  for (const key in headers) {
    const value = headers[key];
    if (value !== undefined) {
      res.setHeader(key, value);
    }
  }

  // Determine body content before writing head
  let bodyContent: string | Buffer | undefined;
  if (response.body === null || response.body === undefined) {
    bodyContent = undefined;
  } else if (typeof response.body === "string") {
    bodyContent = response.body;
  } else if (Buffer.isBuffer(response.body)) {
    bodyContent = response.body;
  } else {
    // JSON serialize objects — set content-type before writeHead
    if (!res.getHeader("content-type")) {
      res.setHeader("content-type", "application/json");
    }
    bodyContent = JSON.stringify(response.body);
  }

  res.writeHead(response.status);
  res.end(bodyContent);
}

// ─── Request Handler Type ────────────────────────────────────

/** Handler function that receives a normalized request and returns a response */
export type NodeRequestHandler = (
  req: TypoKitRequest,
) => Promise<TypoKitResponse>;

// ─── Node Server Options ─────────────────────────────────────

export interface NodeServerOptions {
  /** Optional hostname to bind to (default: "0.0.0.0") */
  hostname?: string;
}

// ─── Node Server ─────────────────────────────────────────────

/** Result of createServer — provides listen/close and access to the raw node:http server */
export interface NodeServer {
  /** Start listening on the given port. Returns a handle for graceful shutdown. */
  listen(port: number): Promise<ServerHandle>;
  /** The underlying node:http Server instance */
  server: Server;
}

/**
 * Create a Node.js HTTP server that dispatches to a TypoKit request handler.
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
  handler: NodeRequestHandler,
  options: NodeServerOptions = {},
): NodeServer {
  const hostname = options.hostname ?? "0.0.0.0";

  const server = nodeCreateServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const normalized = await normalizeRequest(req);
        const response = await handler(normalized);
        writeResponse(res, response);
      } catch (err: unknown) {
        // Fallback error response
        res.writeHead(500, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Internal Server Error",
            message: err instanceof Error ? err.message : "Unknown error",
          }),
        );
      }
    },
  );

  return {
    server,
    listen(port: number): Promise<ServerHandle> {
      return new Promise((resolve, reject) => {
        server.on("error", reject);
        server.listen(port, hostname, () => {
          server.removeListener("error", reject);
          resolve({
            async close(): Promise<void> {
              return new Promise((res, rej) => {
                server.close((err) => (err ? rej(err) : res()));
              });
            },
          });
        });
      });
    },
  };
}
