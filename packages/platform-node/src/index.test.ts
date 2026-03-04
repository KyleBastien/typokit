// @typokit/platform-node — Tests

import { describe, it, expect } from "@rstest/core";
import {
  createServer,
  normalizeRequest,
  writeResponse,
  getPlatformInfo,
} from "./index.js";
import type { TypoKitResponse } from "@typokit/types";
import { createServer as nodeCreateServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

// ─── getPlatformInfo ─────────────────────────────────────────

describe("getPlatformInfo", () => {
  it("returns node runtime and version", () => {
    const info = getPlatformInfo();
    expect(info.runtime).toBe("node");
    expect(info.version).toMatch(/^v\d+/);
  });
});

// ─── normalizeRequest ────────────────────────────────────────

describe("normalizeRequest", () => {
  it("parses method, path, headers, and query from IncomingMessage", async () => {
    const normalized = await new Promise<Awaited<ReturnType<typeof normalizeRequest>>>((resolve, reject) => {
      const server = nodeCreateServer(async (req: IncomingMessage) => {
        try {
          resolve(await normalizeRequest(req));
        } catch (e) {
          reject(e);
        }
        server.close();
      });
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") return;
        const url = `http://127.0.0.1:${addr.port}/hello?foo=bar`;
        fetch(url, { method: "GET", headers: { "x-test": "yes" } }).catch(() => {});
      });
    });

    expect(normalized.method).toBe("GET");
    expect(normalized.path).toBe("/hello");
    expect(normalized.query["foo"]).toBe("bar");
    expect(normalized.headers["x-test"]).toBe("yes");
    expect(normalized.params).toEqual({});
  });

  it("collects JSON body when content-type is application/json", async () => {
    const normalized = await new Promise<Awaited<ReturnType<typeof normalizeRequest>>>((resolve, reject) => {
      const server = nodeCreateServer(async (req: IncomingMessage, res: ServerResponse) => {
        try {
          resolve(await normalizeRequest(req));
        } catch (e) {
          reject(e);
        }
        res.end();
        server.close();
      });
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") return;
        fetch(`http://127.0.0.1:${addr.port}/data`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "test" }),
        }).catch(() => {});
      });
    });

    expect(normalized.method).toBe("POST");
    expect(normalized.body).toEqual({ name: "test" });
  });
});

// ─── writeResponse ───────────────────────────────────────────

describe("writeResponse", () => {
  it("writes status, headers, and JSON body to ServerResponse", async () => {
    const result = await new Promise<{ status: number; body: string; headers: Record<string, string> }>((resolve, reject) => {
      const server = nodeCreateServer((_req: IncomingMessage, res: ServerResponse) => {
        const response: TypoKitResponse = {
          status: 201,
          headers: { "x-custom": "value" },
          body: { created: true },
        };
        writeResponse(res, response);
        server.close();
      });
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") return;
        fetch(`http://127.0.0.1:${addr.port}/`)
          .then(async (resp) => {
            resolve({
              status: resp.status,
              body: await resp.text(),
              headers: Object.fromEntries(resp.headers.entries()),
            });
          })
          .catch(reject);
      });
    });

    expect(result.status).toBe(201);
    expect(result.headers["x-custom"]).toBe("value");
    expect(JSON.parse(result.body)).toEqual({ created: true });
  });
});

// ─── createServer ────────────────────────────────────────────

describe("createServer", () => {
  it("starts a server, handles a request, and returns a response", async () => {
    const srv = createServer(async (req) => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: { echo: req.path },
    }));

    const handle = await srv.listen(0);

    try {
      const addr = srv.server.address();
      if (!addr || typeof addr === "string") throw new Error("No address");

      const resp = await fetch(`http://127.0.0.1:${addr.port}/test-path`);
      expect(resp.status).toBe(200);

      const body = await resp.json();
      expect(body).toEqual({ echo: "/test-path" });
    } finally {
      await handle.close();
    }
  });

  it("returns 500 when handler throws", async () => {
    const srv = createServer(async () => {
      throw new Error("boom");
    });

    const handle = await srv.listen(0);

    try {
      const addr = srv.server.address();
      if (!addr || typeof addr === "string") throw new Error("No address");

      const resp = await fetch(`http://127.0.0.1:${addr.port}/fail`);
      expect(resp.status).toBe(500);

      const body = await resp.json();
      expect(body.error).toBe("Internal Server Error");
      expect(body.message).toBe("boom");
    } finally {
      await handle.close();
    }
  });

  it("close() gracefully shuts down the server", async () => {
    const srv = createServer(async () => ({
      status: 200,
      headers: {},
      body: null,
    }));

    const handle = await srv.listen(0);
    const addr = srv.server.address();
    expect(addr).not.toBeNull();

    await handle.close();

    // Server should no longer be listening
    expect(srv.server.listening).toBe(false);
  });
});
