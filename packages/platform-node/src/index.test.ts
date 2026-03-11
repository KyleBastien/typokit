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
    const normalized = await new Promise<
      Awaited<ReturnType<typeof normalizeRequest>>
    >((resolve, reject) => {
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
        fetch(url, { method: "GET", headers: { "x-test": "yes" } }).catch(
          () => {},
        );
      });
    });

    expect(normalized.method).toBe("GET");
    expect(normalized.path).toBe("/hello");
    expect(normalized.query["foo"]).toBe("bar");
    expect(normalized.headers["x-test"]).toBe("yes");
    expect(normalized.params).toEqual({});
  });

  it("collects JSON body when content-type is application/json", async () => {
    const normalized = await new Promise<
      Awaited<ReturnType<typeof normalizeRequest>>
    >((resolve, reject) => {
      const server = nodeCreateServer(
        async (req: IncomingMessage, res: ServerResponse) => {
          try {
            resolve(await normalizeRequest(req));
          } catch (e) {
            reject(e);
          }
          res.end();
          server.close();
        },
      );
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

// ─── body collection optimizations ──────────────────────────────

describe("body collection optimizations", () => {
  it("uses pre-allocated buffer for small JSON body with content-length", async () => {
    const normalized = await new Promise<
      Awaited<ReturnType<typeof normalizeRequest>>
    >((resolve, reject) => {
      const server = nodeCreateServer(
        async (req: IncomingMessage, res: ServerResponse) => {
          try {
            resolve(await normalizeRequest(req));
          } catch (e) {
            reject(e);
          }
          res.end();
          server.close();
        },
      );
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") return;
        fetch(`http://127.0.0.1:${addr.port}/small`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ x: 1 }),
        }).catch(() => {});
      });
    });

    expect(normalized.body).toEqual({ x: 1 });
  });

  it("handles empty body (content-length: 0)", async () => {
    const normalized = await new Promise<
      Awaited<ReturnType<typeof normalizeRequest>>
    >((resolve, reject) => {
      const server = nodeCreateServer(
        async (req: IncomingMessage, res: ServerResponse) => {
          try {
            resolve(await normalizeRequest(req));
          } catch (e) {
            reject(e);
          }
          res.end();
          server.close();
        },
      );
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") return;
        fetch(`http://127.0.0.1:${addr.port}/empty`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": "0",
          },
          body: null,
        }).catch(() => {});
      });
    });

    expect(normalized.body).toBeUndefined();
  });

  it("defers JSON parsing until body is accessed (lazy parsing)", async () => {
    const normalized = await new Promise<
      Awaited<ReturnType<typeof normalizeRequest>>
    >((resolve, reject) => {
      const server = nodeCreateServer(
        async (req: IncomingMessage, res: ServerResponse) => {
          try {
            resolve(await normalizeRequest(req));
          } catch (e) {
            reject(e);
          }
          res.end();
          server.close();
        },
      );
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") return;
        fetch(`http://127.0.0.1:${addr.port}/lazy`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ lazy: true }),
        }).catch(() => {});
      });
    });

    // Body is a lazy getter — verify property descriptor
    const desc = Object.getOwnPropertyDescriptor(normalized, "body");
    expect(desc?.get).toBeDefined();
    // Accessing body triggers lazy parse
    expect(normalized.body).toEqual({ lazy: true });
    // Second access returns cached value
    expect(normalized.body).toEqual({ lazy: true });
  });

  it("returns raw string for non-JSON content-type without lazy getter", async () => {
    const normalized = await new Promise<
      Awaited<ReturnType<typeof normalizeRequest>>
    >((resolve, reject) => {
      const server = nodeCreateServer(
        async (req: IncomingMessage, res: ServerResponse) => {
          try {
            resolve(await normalizeRequest(req));
          } catch (e) {
            reject(e);
          }
          res.end();
          server.close();
        },
      );
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") return;
        fetch(`http://127.0.0.1:${addr.port}/text`, {
          method: "POST",
          headers: { "content-type": "text/plain" },
          body: "hello world",
        }).catch(() => {});
      });
    });

    expect(normalized.body).toBe("hello world");
    // Non-JSON body is a plain value property, not a getter
    const desc = Object.getOwnPropertyDescriptor(normalized, "body");
    expect(desc?.get).toBeUndefined();
  });

  it("falls back to raw string when JSON parsing fails", async () => {
    const normalized = await new Promise<
      Awaited<ReturnType<typeof normalizeRequest>>
    >((resolve, reject) => {
      const server = nodeCreateServer(
        async (req: IncomingMessage, res: ServerResponse) => {
          try {
            resolve(await normalizeRequest(req));
          } catch (e) {
            reject(e);
          }
          res.end();
          server.close();
        },
      );
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") return;
        fetch(`http://127.0.0.1:${addr.port}/bad`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "not valid json{{{",
        }).catch(() => {});
      });
    });

    // Lazy getter falls back to raw string when JSON.parse fails
    expect(normalized.body).toBe("not valid json{{{");
  });
});

// ─── writeResponse ───────────────────────────────────────────

describe("writeResponse", () => {
  it("writes status, headers, and JSON body to ServerResponse", async () => {
    const result = await new Promise<{
      status: number;
      body: string;
      headers: Record<string, string>;
    }>((resolve, reject) => {
      const server = nodeCreateServer(
        (_req: IncomingMessage, res: ServerResponse) => {
          const response: TypoKitResponse = {
            status: 201,
            headers: { "x-custom": "value" },
            body: { created: true },
          };
          writeResponse(res, response);
          server.close();
        },
      );
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

      const body = (await resp.json()) as { error: string; message: string };
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

  it("applies default keep-alive tuning when no options given", () => {
    const srv = createServer(async () => ({
      status: 200,
      headers: {},
      body: null,
    }));

    expect(srv.server.keepAliveTimeout).toBe(5_000);
    expect(srv.server.headersTimeout).toBe(10_000);
    expect(srv.server.maxHeadersCount).toBe(64);
  });

  it("respects custom keep-alive options", () => {
    const srv = createServer(
      async () => ({ status: 200, headers: {}, body: null }),
      {
        keepAliveTimeout: 15_000,
        headersTimeout: 30_000,
        maxHeadersCount: 128,
      },
    );

    expect(srv.server.keepAliveTimeout).toBe(15_000);
    expect(srv.server.headersTimeout).toBe(30_000);
    expect(srv.server.maxHeadersCount).toBe(128);
  });
});
