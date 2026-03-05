// @typokit/testing — Integration Tests

import { describe, it, expect } from "@rstest/core";
import type {
  CompiledRoute,
  CompiledRouteTable,
  HandlerMap,
  MiddlewareChain,
  TypoKitRequest,
  TypoKitResponse,
} from "@typokit/types";
import { createApp } from "@typokit/core";
import { nativeServer } from "@typokit/server-native";
import { createTestClient } from "./index.js";

// ─── Test Helpers ────────────────────────────────────────────

function makeRouteTable(): CompiledRouteTable {
  const root: CompiledRoute = {
    segment: "",
    handlers: {
      GET: { ref: "root#index", middleware: [] },
    },
    children: {
      users: {
        segment: "users",
        handlers: {
          GET: { ref: "users#list", middleware: [] },
          POST: { ref: "users#create", middleware: [] },
        },
        paramChild: {
          segment: ":id",
          paramName: "id",
          handlers: {
            GET: { ref: "users#get", middleware: [] },
            PUT: { ref: "users#update", middleware: [] },
            DELETE: { ref: "users#delete", middleware: [] },
          },
        },
      },
      echo: {
        segment: "echo",
        handlers: {
          POST: { ref: "echo#post", middleware: [] },
        },
      },
    },
  };
  return root;
}

function makeHandlerMap(): HandlerMap {
  const users = [
    { id: "1", name: "Alice" },
    { id: "2", name: "Bob" },
  ];

  return {
    "root#index": async (): Promise<TypoKitResponse> => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: { message: "Hello, TypoKit!" },
    }),
    "users#list": async (req: TypoKitRequest): Promise<TypoKitResponse> => {
      const limit = req.query["limit"];
      const data = limit ? users.slice(0, Number(limit)) : users;
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: { data },
      };
    },
    "users#create": async (req: TypoKitRequest): Promise<TypoKitResponse> => {
      const newUser = req.body as { name: string };
      return {
        status: 201,
        headers: { "content-type": "application/json" },
        body: { id: "3", name: newUser.name },
      };
    },
    "users#get": async (req: TypoKitRequest): Promise<TypoKitResponse> => {
      const user = users.find((u) => u.id === req.params["id"]);
      if (!user) {
        return {
          status: 404,
          headers: { "content-type": "application/json" },
          body: { error: "Not Found" },
        };
      }
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: user,
      };
    },
    "users#update": async (req: TypoKitRequest): Promise<TypoKitResponse> => {
      const updates = req.body as { name: string };
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: { id: req.params["id"], name: updates.name },
      };
    },
    "users#delete": async (_req: TypoKitRequest): Promise<TypoKitResponse> => ({
      status: 204,
      headers: {},
      body: null,
    }),
    "echo#post": async (req: TypoKitRequest): Promise<TypoKitResponse> => ({
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-custom": (req.headers["x-custom"] as string) ?? "",
      },
      body: { echo: req.body },
    }),
  };
}

function createTestApp() {
  const adapter = nativeServer();
  const routeTable = makeRouteTable();
  const handlerMap = makeHandlerMap();
  const middlewareChain: MiddlewareChain = { entries: [] };

  adapter.registerRoutes(routeTable, handlerMap, middlewareChain);

  return createApp({
    server: adapter,
    routes: [],
  });
}

// ─── Tests ───────────────────────────────────────────────────

describe("createTestClient", () => {
  it("should start the app and return a client with baseUrl", async () => {
    const app = createTestApp();
    const client = await createTestClient(app);
    try {
      expect(client.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    } finally {
      await client.close();
    }
  });

  it("should GET / and return JSON body", async () => {
    const app = createTestApp();
    const client = await createTestClient(app);
    try {
      const res = await client.get<{ message: string }>("/");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: "Hello, TypoKit!" });
      expect(res.headers["content-type"]).toContain("application/json");
    } finally {
      await client.close();
    }
  });

  it("should GET /users and list users", async () => {
    const app = createTestApp();
    const client = await createTestClient(app);
    try {
      const res = await client.get<{
        data: Array<{ id: string; name: string }>;
      }>("/users");
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0].name).toBe("Alice");
    } finally {
      await client.close();
    }
  });

  it("should support query parameters", async () => {
    const app = createTestApp();
    const client = await createTestClient(app);
    try {
      const res = await client.get<{
        data: Array<{ id: string; name: string }>;
      }>("/users", { query: { limit: "1" } });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    } finally {
      await client.close();
    }
  });

  it("should POST and create a resource", async () => {
    const app = createTestApp();
    const client = await createTestClient(app);
    try {
      const res = await client.post<{ id: string; name: string }>("/users", {
        body: { name: "Charlie" },
      });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe("Charlie");
      expect(res.body.id).toBe("3");
    } finally {
      await client.close();
    }
  });

  it("should PUT to update a resource", async () => {
    const app = createTestApp();
    const client = await createTestClient(app);
    try {
      const res = await client.put<{ id: string; name: string }>("/users/1", {
        body: { name: "Alice Updated" },
      });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Alice Updated");
    } finally {
      await client.close();
    }
  });

  it("should DELETE a resource", async () => {
    const app = createTestApp();
    const client = await createTestClient(app);
    try {
      const res = await client.delete("/users/1");
      expect(res.status).toBe(204);
    } finally {
      await client.close();
    }
  });

  it("should pass custom headers", async () => {
    const app = createTestApp();
    const client = await createTestClient(app);
    try {
      const res = await client.post<{ echo: unknown }>("/echo", {
        body: { test: true },
        headers: { "x-custom": "my-value" },
      });
      expect(res.status).toBe(200);
      expect(res.headers["x-custom"]).toBe("my-value");
      expect(res.body.echo).toEqual({ test: true });
    } finally {
      await client.close();
    }
  });

  it("should return 404 for unknown routes", async () => {
    const app = createTestApp();
    const client = await createTestClient(app);
    try {
      const res = await client.get("/nonexistent");
      expect(res.status).toBe(404);
    } finally {
      await client.close();
    }
  });

  it("should support contract-typed request method", async () => {
    const app = createTestApp();
    const client = await createTestClient(app);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await client.request<any>("GET", "/users");
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
    } finally {
      await client.close();
    }
  });
});
