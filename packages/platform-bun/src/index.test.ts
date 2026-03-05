// @typokit/platform-bun — Tests

import { describe, it, expect } from "@rstest/core";
import {
  normalizeRequest,
  buildResponse,
  getPlatformInfo,
  createServer,
} from "./index.js";
import type { TypoKitResponse } from "@typokit/types";

// ─── getPlatformInfo ─────────────────────────────────────────

describe("getPlatformInfo", () => {
  it("returns bun runtime", () => {
    // Mock Bun global for testing in Node environment
    const g = globalThis as unknown as Record<string, unknown>;
    g["Bun"] = { version: "1.0.0" };
    try {
      const info = getPlatformInfo();
      expect(info.runtime).toBe("bun");
      expect(info.version).toBe("1.0.0");
    } finally {
      delete g["Bun"];
    }
  });

  it("returns unknown version when Bun global is missing", () => {
    const info = getPlatformInfo();
    expect(info.runtime).toBe("bun");
    expect(info.version).toBe("unknown");
  });
});

// ─── normalizeRequest ────────────────────────────────────────

describe("normalizeRequest", () => {
  it("parses method, path, headers, and query from Request", async () => {
    const req = new Request("http://localhost:3000/hello?foo=bar", {
      method: "GET",
      headers: { "x-test": "yes" },
    });

    const normalized = await normalizeRequest(req);

    expect(normalized.method).toBe("GET");
    expect(normalized.path).toBe("/hello");
    expect(normalized.query["foo"]).toBe("bar");
    expect(normalized.headers["x-test"]).toBe("yes");
    expect(normalized.params).toEqual({});
  });

  it("collects JSON body when content-type is application/json", async () => {
    const req = new Request("http://localhost:3000/data", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "test" }),
    });

    const normalized = await normalizeRequest(req);

    expect(normalized.method).toBe("POST");
    expect(normalized.body).toEqual({ name: "test" });
  });

  it("returns raw string body when content-type is not JSON", async () => {
    const req = new Request("http://localhost:3000/text", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "hello world",
    });

    const normalized = await normalizeRequest(req);
    expect(normalized.body).toBe("hello world");
  });

  it("returns undefined body for GET requests", async () => {
    const req = new Request("http://localhost:3000/empty", {
      method: "GET",
    });

    const normalized = await normalizeRequest(req);
    expect(normalized.body).toBeUndefined();
  });

  it("handles multiple query params with the same key", async () => {
    const req = new Request("http://localhost:3000/multi?tag=a&tag=b", {
      method: "GET",
    });

    const normalized = await normalizeRequest(req);
    expect(normalized.query["tag"]).toEqual(["a", "b"]);
  });
});

// ─── buildResponse ───────────────────────────────────────────

describe("buildResponse", () => {
  it("builds a Response with status, headers, and JSON body", () => {
    const typoResponse: TypoKitResponse = {
      status: 201,
      headers: { "x-custom": "value" },
      body: { created: true },
    };

    const response = buildResponse(typoResponse);

    expect(response.status).toBe(201);
    expect(response.headers.get("x-custom")).toBe("value");
    expect(response.headers.get("content-type")).toBe("application/json");
  });

  it("builds a Response with string body", async () => {
    const typoResponse: TypoKitResponse = {
      status: 200,
      headers: { "content-type": "text/plain" },
      body: "hello",
    };

    const response = buildResponse(typoResponse);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).toBe("hello");
  });

  it("builds a Response with null body", () => {
    const typoResponse: TypoKitResponse = {
      status: 204,
      headers: {},
      body: null,
    };

    const response = buildResponse(typoResponse);
    expect(response.status).toBe(204);
  });

  it("handles array header values", () => {
    const typoResponse: TypoKitResponse = {
      status: 200,
      headers: { "set-cookie": ["a=1", "b=2"] },
      body: null,
    };

    const response = buildResponse(typoResponse);
    expect(response.headers.get("set-cookie")).toContain("a=1");
  });
});

// ─── createServer ────────────────────────────────────────────

describe("createServer", () => {
  it("creates a server instance with listen method", () => {
    const srv = createServer(async () => ({
      status: 200,
      headers: {},
      body: null,
    }));

    expect(typeof srv.listen).toBe("function");
    expect(srv.server).toBeNull();
  });

  it("calls Bun.serve when listen is invoked", async () => {
    const mockServer = {
      port: 3000,
      hostname: "0.0.0.0",
      stop: () => {},
    };

    const g = globalThis as unknown as Record<string, unknown>;
    g["Bun"] = {
      version: "1.0.0",
      serve: () => mockServer,
    };

    try {
      const srv = createServer(async () => ({
        status: 200,
        headers: {},
        body: { ok: true },
      }));

      const handle = await srv.listen(3000);
      expect(srv.server).not.toBeNull();

      await handle.close();
      expect(srv.server).toBeNull();
    } finally {
      delete g["Bun"];
    }
  });

  it("rejects when Bun global is not available", async () => {
    const srv = createServer(async () => ({
      status: 200,
      headers: {},
      body: null,
    }));

    let error: Error | null = null;
    try {
      await srv.listen(3000);
    } catch (err) {
      error = err as Error;
    }
    expect(error).not.toBeNull();
  });

  it("fetch handler converts request and returns response", async () => {
    let capturedFetch: ((req: Request) => Promise<Response>) | null = null;
    const mockServer = {
      port: 3001,
      hostname: "0.0.0.0",
      stop: () => {},
    };

    const g = globalThis as unknown as Record<string, unknown>;
    g["Bun"] = {
      version: "1.0.0",
      serve: (opts: { fetch: (req: Request) => Promise<Response> }) => {
        capturedFetch = opts.fetch;
        return mockServer;
      },
    };

    try {
      const srv = createServer(async (req) => ({
        status: 200,
        headers: { "content-type": "application/json" },
        body: { echo: req.path },
      }));

      await srv.listen(3001);

      // Simulate a request through the captured fetch handler
      const webReq = new Request("http://localhost:3001/test-path");
      const webResp = await capturedFetch!(webReq);

      expect(webResp.status).toBe(200);
      const body = await webResp.json();
      expect(body).toEqual({ echo: "/test-path" });

      const handle = await srv.listen(3001);
      await handle.close();
    } finally {
      delete g["Bun"];
    }
  });

  it("fetch handler returns 500 when handler throws", async () => {
    let capturedFetch: ((req: Request) => Promise<Response>) | null = null;
    const mockServer = {
      port: 3002,
      hostname: "0.0.0.0",
      stop: () => {},
    };

    const g = globalThis as unknown as Record<string, unknown>;
    g["Bun"] = {
      version: "1.0.0",
      serve: (opts: { fetch: (req: Request) => Promise<Response> }) => {
        capturedFetch = opts.fetch;
        return mockServer;
      },
    };

    try {
      const srv = createServer(async () => {
        throw new Error("boom");
      });

      await srv.listen(3002);

      const webReq = new Request("http://localhost:3002/fail");
      const webResp = await capturedFetch!(webReq);

      expect(webResp.status).toBe(500);
      const body = (await webResp.json()) as { error: string; message: string };
      expect(body.error).toBe("Internal Server Error");
      expect(body.message).toBe("boom");

      const handle = await srv.listen(3002);
      await handle.close();
    } finally {
      delete g["Bun"];
    }
  });
});
