// @typokit/testing — Integration Suite Tests

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
import { createIntegrationSuite, registerSeed } from "./integration-suite.js";
import type { InMemoryDatabase } from "./integration-suite.js";

// ─── Test Helpers ────────────────────────────────────────────

function makeRouteTable(): CompiledRouteTable {
  const root: CompiledRoute = {
    segment: "",
    handlers: {
      GET: { ref: "root#index", middleware: [] },
    },
    children: {
      items: {
        segment: "items",
        handlers: {
          GET: { ref: "items#list", middleware: [] },
          POST: { ref: "items#create", middleware: [] },
        },
      },
    },
  };
  return root;
}

function makeHandlerMap(): HandlerMap {
  return {
    "root#index": async (): Promise<TypoKitResponse> => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: { message: "Integration Suite Test" },
    }),
    "items#list": async (_req: TypoKitRequest): Promise<TypoKitResponse> => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: { items: [] },
    }),
    "items#create": async (req: TypoKitRequest): Promise<TypoKitResponse> => ({
      status: 201,
      headers: { "content-type": "application/json" },
      body: req.body,
    }),
  };
}

function createTestApp() {
  const adapter = nativeServer();
  const routeTable = makeRouteTable();
  const handlerMap = makeHandlerMap();
  const middlewareChain: MiddlewareChain = { entries: [] };
  adapter.registerRoutes(routeTable, handlerMap, middlewareChain);
  return createApp({ server: adapter, routes: [] });
}

// ─── Register test seeds ─────────────────────────────────────

registerSeed("test-items", (db: InMemoryDatabase) => {
  db.insert("items", { id: "1", name: "Alpha" });
  db.insert("items", { id: "2", name: "Beta" });
  db.insert("items", { id: "3", name: "Gamma" });
});

registerSeed("test-users", (db: InMemoryDatabase) => {
  db.insert("users", { id: "u1", name: "Alice", role: "admin" });
  db.insert("users", { id: "u2", name: "Bob", role: "user" });
});

// ─── Tests ───────────────────────────────────────────────────

describe("createIntegrationSuite", () => {
  it("should create a suite and provide a client after setup", async () => {
    const app = createTestApp();
    const suite = createIntegrationSuite(app);

    await suite.setup();
    try {
      expect(suite.client).toBeDefined();
      expect(suite.client.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    } finally {
      await suite.teardown();
    }
  });

  it("should throw when accessing client before setup", () => {
    const app = createTestApp();
    const suite = createIntegrationSuite(app);

    expect(() => suite.client).toThrow(
      "Integration suite not set up. Call suite.setup() first.",
    );
  });

  it("should make requests through the suite client", async () => {
    const app = createTestApp();
    const suite = createIntegrationSuite(app);

    await suite.setup();
    try {
      const res = await suite.client.get<{ message: string }>("/");
      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Integration Suite Test");
    } finally {
      await suite.teardown();
    }
  });

  it("should have null db when database option is false", async () => {
    const app = createTestApp();
    const suite = createIntegrationSuite(app, { database: false });

    await suite.setup();
    try {
      expect(suite.db).toBeNull();
    } finally {
      await suite.teardown();
    }
  });

  it("should provide an in-memory database when database option is true", async () => {
    const app = createTestApp();
    const suite = createIntegrationSuite(app, { database: true });

    await suite.setup();
    try {
      expect(suite.db).not.toBeNull();
      expect(suite.db!.tables()).toHaveLength(0);
    } finally {
      await suite.teardown();
    }
  });

  it("should seed the database with registered fixtures", async () => {
    const app = createTestApp();
    const suite = createIntegrationSuite(app, {
      database: true,
      seed: "test-items",
    });

    await suite.setup();
    try {
      expect(suite.db).not.toBeNull();
      const items = suite.db!.findAll("items");
      expect(items).toHaveLength(3);
      expect(items[0].name).toBe("Alpha");
      expect(items[2].name).toBe("Gamma");
    } finally {
      await suite.teardown();
    }
  });

  it("should seed with a different fixture", async () => {
    const app = createTestApp();
    const suite = createIntegrationSuite(app, {
      database: true,
      seed: "test-users",
    });

    await suite.setup();
    try {
      const users = suite.db!.findAll("users");
      expect(users).toHaveLength(2);
      expect(users[0].name).toBe("Alice");
      expect(users[0].role).toBe("admin");
    } finally {
      await suite.teardown();
    }
  });

  it("should throw for unknown seed fixture", async () => {
    const app = createTestApp();
    const suite = createIntegrationSuite(app, {
      database: true,
      seed: "nonexistent-seed",
    });

    await expect(suite.setup()).rejects.toThrow(
      'Unknown seed fixture: "nonexistent-seed"',
    );
  });

  it("should support findById on in-memory database", async () => {
    const app = createTestApp();
    const suite = createIntegrationSuite(app, {
      database: true,
      seed: "test-items",
    });

    await suite.setup();
    try {
      const item = suite.db!.findById("items", "2");
      expect(item).toBeDefined();
      expect(item!.name).toBe("Beta");

      const missing = suite.db!.findById("items", "999");
      expect(missing).toBeUndefined();
    } finally {
      await suite.teardown();
    }
  });

  it("should support clearTable on in-memory database", async () => {
    const app = createTestApp();
    const suite = createIntegrationSuite(app, {
      database: true,
      seed: "test-items",
    });

    await suite.setup();
    try {
      expect(suite.db!.findAll("items")).toHaveLength(3);
      suite.db!.clearTable("items");
      expect(suite.db!.findAll("items")).toHaveLength(0);
    } finally {
      await suite.teardown();
    }
  });

  it("should provide isolated databases per suite instance", async () => {
    const app1 = createTestApp();
    const suite1 = createIntegrationSuite(app1, {
      database: true,
      seed: "test-items",
    });

    const app2 = createTestApp();
    const suite2 = createIntegrationSuite(app2, {
      database: true,
      seed: "test-items",
    });

    await suite1.setup();
    await suite2.setup();
    try {
      // Modify suite1's database
      suite1.db!.insert("items", { id: "4", name: "Delta" });
      suite1.db!.clearTable("items");

      // suite2's database should be untouched
      expect(suite2.db!.findAll("items")).toHaveLength(3);
      expect(suite1.db!.findAll("items")).toHaveLength(0);
    } finally {
      await suite1.teardown();
      await suite2.teardown();
    }
  });

  it("should clean up database on teardown", async () => {
    const app = createTestApp();
    const suite = createIntegrationSuite(app, {
      database: true,
      seed: "test-items",
    });

    await suite.setup();
    expect(suite.db).not.toBeNull();
    await suite.teardown();
    expect(suite.db).toBeNull();
  });

  it("should have no shared mutable state between sequential setups", async () => {
    const app1 = createTestApp();
    const suite = createIntegrationSuite(app1, {
      database: true,
      seed: "test-items",
    });

    // First setup + modification
    await suite.setup();
    suite.db!.insert("items", { id: "extra", name: "Extra" });
    expect(suite.db!.findAll("items")).toHaveLength(4);
    await suite.teardown();

    // Second setup — fresh state
    const app2 = createTestApp();
    const suite2 = createIntegrationSuite(app2, {
      database: true,
      seed: "test-items",
    });
    await suite2.setup();
    try {
      expect(suite2.db!.findAll("items")).toHaveLength(3);
    } finally {
      await suite2.teardown();
    }
  });

  it("should support insert and query on in-memory database", async () => {
    const app = createTestApp();
    const suite = createIntegrationSuite(app, { database: true });

    await suite.setup();
    try {
      suite.db!.insert("orders", { id: "o1", total: 100 });
      suite.db!.insert("orders", { id: "o2", total: 200 });

      const orders = suite.db!.findAll("orders");
      expect(orders).toHaveLength(2);
      expect(orders[0].total).toBe(100);

      expect(suite.db!.tables()).toContain("orders");
    } finally {
      await suite.teardown();
    }
  });

  it("should return copies from findAll to prevent mutation", async () => {
    const app = createTestApp();
    const suite = createIntegrationSuite(app, {
      database: true,
      seed: "test-items",
    });

    await suite.setup();
    try {
      const items = suite.db!.findAll("items");
      // Mutating returned record should not affect the database
      items[0].name = "Mutated";
      const fresh = suite.db!.findAll("items");
      expect(fresh[0].name).toBe("Alpha");
    } finally {
      await suite.teardown();
    }
  });
});
