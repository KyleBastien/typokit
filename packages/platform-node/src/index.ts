// @typokit/platform-node — Node.js Platform Adapter

import { createServer as nodeCreateServer } from "node:http";
import type { IncomingMessage, ServerResponse, Server } from "node:http";
import { URL } from "node:url";
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

/** Collect the body of an IncomingMessage into a buffer, then parse as JSON or return raw string */
function collectBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("error", reject);
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8");
      if (!raw) {
        resolve(undefined);
        return;
      }
      const contentType = req.headers["content-type"] ?? "";
      if (contentType.includes("application/json")) {
        try {
          resolve(JSON.parse(raw));
        } catch {
          resolve(raw);
        }
      } else {
        resolve(raw);
      }
    });
  });
}

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

/** Normalize Node.js headers into a flat Record */
function normalizeHeaders(
  raw: IncomingMessage["headers"],
): Record<string, string | string[] | undefined> {
  const result: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(raw)) {
    result[key] = value;
  }
  return result;
}

/**
 * Normalize a Node.js IncomingMessage into a TypoKitRequest.
 * Body is collected asynchronously from the stream.
 */
export async function normalizeRequest(
  req: IncomingMessage,
): Promise<TypoKitRequest> {
  const url = new URL(
    req.url ?? "/",
    `http://${req.headers.host ?? "localhost"}`,
  );
  const body = await collectBody(req);

  return {
    method: (req.method ?? "GET").toUpperCase() as HttpMethod,
    path: url.pathname,
    headers: normalizeHeaders(req.headers),
    body,
    query: parseQuery(url.searchParams),
    params: {},
  };
}

/**
 * Write a TypoKitResponse to a Node.js ServerResponse.
 */
export function writeResponse(
  res: ServerResponse,
  response: TypoKitResponse,
): void {
  // Set headers
  for (const [key, value] of Object.entries(response.headers)) {
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
