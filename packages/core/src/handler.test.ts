import { describe, it, expect } from "@rstest/core";
import { defineHandlers } from "./handler.js";
import type {
  RouteContract,
  RequestContext,
  PaginatedResponse,
} from "@typokit/types";
import { createRequestContext } from "./middleware.js";

// ─── Test Route Contracts ────────────────────────────────────

interface TestUser {
  id: string;
  name: string;
  email: string;
}

interface CreateUserInput {
  name: string;
  email: string;
}

interface UsersRoutes {
  [key: string]: RouteContract<any, any, any, any>;
  "GET /users": RouteContract<
    void,
    { page?: number; pageSize?: number },
    void,
    PaginatedResponse<TestUser>
  >;

  "POST /users": RouteContract<void, void, CreateUserInput, TestUser>;

  "GET /users/:id": RouteContract<{ id: string }, void, void, TestUser>;
}

// ─── Tests ───────────────────────────────────────────────────

describe("defineHandlers", () => {
  it("returns the handlers object unchanged", () => {
    const handlers = defineHandlers<UsersRoutes>({
      "GET /users": async ({ query }) => ({
        data: [],
        pagination: {
          total: 0,
          page: query.page ?? 1,
          pageSize: query.pageSize ?? 10,
          totalPages: 0,
        },
      }),
      "POST /users": async ({ body }) => ({
        id: "new-id",
        name: body.name,
        email: body.email,
      }),
      "GET /users/:id": async ({ params }) => ({
        id: params.id,
        name: "Test User",
        email: "test@example.com",
      }),
    });

    expect(handlers["GET /users"]).toBeDefined();
    expect(handlers["POST /users"]).toBeDefined();
    expect(handlers["GET /users/:id"]).toBeDefined();
    expect(typeof handlers["GET /users"]).toBe("function");
    expect(typeof handlers["POST /users"]).toBe("function");
    expect(typeof handlers["GET /users/:id"]).toBe("function");
  });

  it("handler receives params typed from contract", async () => {
    const handlers = defineHandlers<UsersRoutes>({
      "GET /users": async () => ({
        data: [],
        pagination: { total: 0, page: 1, pageSize: 10, totalPages: 0 },
      }),
      "POST /users": async ({ body }) => ({
        id: "1",
        name: body.name,
        email: body.email,
      }),
      "GET /users/:id": async ({ params }) => {
        return {
          id: params.id,
          name: "Found User",
          email: "found@example.com",
        };
      },
    });

    const ctx = createRequestContext();
    const result = await handlers["GET /users/:id"]({
      params: { id: "user-42" },
      query: undefined as void,
      body: undefined as void,
      ctx,
    });

    expect(result.id).toBe("user-42");
    expect(result.name).toBe("Found User");
  });

  it("handler receives query typed from contract", async () => {
    const handlers = defineHandlers<UsersRoutes>({
      "GET /users": async ({ query }) => ({
        data: [],
        pagination: {
          total: 0,
          page: query.page ?? 1,
          pageSize: query.pageSize ?? 10,
          totalPages: 0,
        },
      }),
      "POST /users": async ({ body }) => ({
        id: "1",
        name: body.name,
        email: body.email,
      }),
      "GET /users/:id": async ({ params }) => ({
        id: params.id,
        name: "User",
        email: "user@example.com",
      }),
    });

    const ctx = createRequestContext();
    const result = await handlers["GET /users"]({
      params: undefined as void,
      query: { page: 3, pageSize: 25 },
      body: undefined as void,
      ctx,
    });

    expect(result.pagination.page).toBe(3);
    expect(result.pagination.pageSize).toBe(25);
  });

  it("handler receives body typed from contract", async () => {
    const handlers = defineHandlers<UsersRoutes>({
      "GET /users": async () => ({
        data: [],
        pagination: { total: 0, page: 1, pageSize: 10, totalPages: 0 },
      }),
      "POST /users": async ({ body }) => ({
        id: "new-123",
        name: body.name,
        email: body.email,
      }),
      "GET /users/:id": async ({ params }) => ({
        id: params.id,
        name: "User",
        email: "user@example.com",
      }),
    });

    const ctx = createRequestContext();
    const result = await handlers["POST /users"]({
      params: undefined as void,
      query: undefined as void,
      body: { name: "Alice", email: "alice@example.com" },
      ctx,
    });

    expect(result.id).toBe("new-123");
    expect(result.name).toBe("Alice");
    expect(result.email).toBe("alice@example.com");
  });

  it("handler receives ctx with RequestContext", async () => {
    let receivedCtx: RequestContext | undefined;

    const handlers = defineHandlers<UsersRoutes>({
      "GET /users": async ({ ctx }) => {
        receivedCtx = ctx;
        return {
          data: [],
          pagination: { total: 0, page: 1, pageSize: 10, totalPages: 0 },
        };
      },
      "POST /users": async ({ body }) => ({
        id: "1",
        name: body.name,
        email: body.email,
      }),
      "GET /users/:id": async ({ params }) => ({
        id: params.id,
        name: "User",
        email: "user@example.com",
      }),
    });

    const ctx = createRequestContext({ requestId: "req-test-123" });
    await handlers["GET /users"]({
      params: undefined as void,
      query: undefined as unknown as { page?: number; pageSize?: number },
      body: undefined as void,
      ctx,
    });

    expect(receivedCtx).toBeDefined();
    expect(receivedCtx!.requestId).toBe("req-test-123");
    expect(typeof receivedCtx!.fail).toBe("function");
    expect(typeof receivedCtx!.log.info).toBe("function");
  });

  it("handler return type matches contract response", async () => {
    const handlers = defineHandlers<UsersRoutes>({
      "GET /users": async () => ({
        data: [{ id: "1", name: "Test", email: "test@test.com" }],
        pagination: { total: 1, page: 1, pageSize: 10, totalPages: 1 },
      }),
      "POST /users": async ({ body }) => ({
        id: "1",
        name: body.name,
        email: body.email,
      }),
      "GET /users/:id": async ({ params }) => ({
        id: params.id,
        name: "User",
        email: "user@example.com",
      }),
    });

    const ctx = createRequestContext();
    const listResult = await handlers["GET /users"]({
      params: undefined as void,
      query: undefined as unknown as { page?: number; pageSize?: number },
      body: undefined as void,
      ctx,
    });

    expect(listResult.data).toHaveLength(1);
    expect(listResult.data[0].name).toBe("Test");
    expect(listResult.pagination.total).toBe(1);
  });

  it("supports synchronous handlers", () => {
    const handlers = defineHandlers<UsersRoutes>({
      "GET /users": () => ({
        data: [],
        pagination: { total: 0, page: 1, pageSize: 10, totalPages: 0 },
      }),
      "POST /users": ({ body }) => ({
        id: "sync-1",
        name: body.name,
        email: body.email,
      }),
      "GET /users/:id": ({ params }) => ({
        id: params.id,
        name: "Sync User",
        email: "sync@example.com",
      }),
    });

    const ctx = createRequestContext();
    const result = handlers["GET /users/:id"]({
      params: { id: "sync-42" },
      query: undefined as void,
      body: undefined as void,
      ctx,
    });

    // Synchronous handler returns value directly (not a Promise)
    expect((result as { id: string }).id).toBe("sync-42");
  });
});

describe("defineHandlers with single-route contract", () => {
  interface SingleRoute {
    [key: string]: RouteContract<any, any, any, any>;
    "DELETE /items/:id": RouteContract<
      { id: string },
      void,
      void,
      { deleted: boolean }
    >;
  }

  it("works with a single route contract", async () => {
    const handlers = defineHandlers<SingleRoute>({
      "DELETE /items/:id": async ({ params: _params }) => ({
        deleted: true,
      }),
    });

    const ctx = createRequestContext();
    const result = await handlers["DELETE /items/:id"]({
      params: { id: "item-1" },
      query: undefined as void,
      body: undefined as void,
      ctx,
    });

    expect(result.deleted).toBe(true);
  });
});

describe("defineHandlers with complex types", () => {
  interface ComplexBody {
    tags: string[];
    metadata: Record<string, unknown>;
  }

  interface ComplexResponse {
    id: string;
    tags: string[];
    metadata: Record<string, unknown>;
    createdAt: string;
  }

  interface ComplexRoutes {
    [key: string]: RouteContract<any, any, any, any>;
    "POST /items": RouteContract<void, void, ComplexBody, ComplexResponse>;
    "GET /items/:id": RouteContract<
      { id: string },
      { include?: string[] },
      void,
      ComplexResponse
    >;
  }

  it("handles complex body and response types", async () => {
    const handlers = defineHandlers<ComplexRoutes>({
      "POST /items": async ({ body }) => ({
        id: "item-new",
        tags: body.tags,
        metadata: body.metadata,
        createdAt: "2026-01-01T00:00:00Z",
      }),
      "GET /items/:id": async ({ params, query: _query }) => ({
        id: params.id,
        tags: ["tag1"],
        metadata: {},
        createdAt: "2026-01-01T00:00:00Z",
      }),
    });

    const ctx = createRequestContext();
    const result = await handlers["POST /items"]({
      params: undefined as void,
      query: undefined as void,
      body: { tags: ["a", "b"], metadata: { key: "value" } },
      ctx,
    });

    expect(result.tags).toEqual(["a", "b"]);
    expect(result.metadata).toEqual({ key: "value" });
  });
});
