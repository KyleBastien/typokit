// @typokit/example-todo-server — Debug Sidecar Integration Tests
//
// Verifies that the debug sidecar starts on port 9800 and exposes
// introspection endpoints for routes, health, and errors.

import { describe, it, expect } from "@rstest/core";
import http from "http";
import { createDevTodoApp } from "./dev-server.js";

// ─── HTTP Helper ─────────────────────────────────────────────

function fetchJson(url: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = "";
      res.setEncoding("utf-8");
      res.on("data", (chunk: string) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode ?? 0, body: data });
        }
      });
    });
    req.on("error", reject);
  });
}

// ─── Tests ───────────────────────────────────────────────────

describe("Debug Sidecar Demo", () => {
  it("starts debug sidecar and exposes /_debug/routes", async () => {
    const app = createDevTodoApp({ debugPort: 9801 });
    await app.listen(0);

    try {
      // Give the sidecar a moment to start
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Test /_debug/routes
      const routesRes = await fetchJson("http://localhost:9801/_debug/routes");
      expect(routesRes.status).toBe(200);
      const routesBody = routesRes.body as {
        routes: Array<{ method: string; path: string; ref: string }>;
      };
      expect(routesBody.routes).toBeDefined();
      expect(Array.isArray(routesBody.routes)).toBe(true);

      // Verify known routes are present
      const routePaths = routesBody.routes.map((r) => `${r.method} ${r.path}`);
      expect(routePaths).toContain("GET /users");
      expect(routePaths).toContain("POST /users");
      expect(routePaths).toContain("GET /users/:id");
      expect(routePaths).toContain("GET /todos");
      expect(routePaths).toContain("POST /todos");

      // Test /_debug/health
      const healthRes = await fetchJson("http://localhost:9801/_debug/health");
      expect(healthRes.status).toBe(200);
      const healthBody = healthRes.body as {
        status: string;
        uptime: number;
        memory: unknown;
      };
      expect(healthBody.status).toBe("ok");
      expect(typeof healthBody.uptime).toBe("number");

      // Test /_debug/errors?since=1h
      const errorsRes = await fetchJson(
        "http://localhost:9801/_debug/errors?since=1h",
      );
      expect(errorsRes.status).toBe(200);
      const errorsBody = errorsRes.body as { errors: unknown[] };
      expect(errorsBody.errors).toBeDefined();
      expect(Array.isArray(errorsBody.errors)).toBe(true);
    } finally {
      await app.close();
    }
  });
});
