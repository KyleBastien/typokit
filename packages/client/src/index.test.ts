// @typokit/client — Unit Tests

import { describe, it, expect } from "@rstest/core";
import { createClient, ClientError } from "./index.js";
import type { ExtractParams, RequestInterceptor } from "./index.js";
import type { RouteContract } from "@typokit/types";
import { AppError } from "@typokit/errors";

// ─── Type-level Tests ───────────────────────────────────────

// Verify ExtractParams infers correctly at the type level
type _AssertSingle =
  ExtractParams<"/users/:id"> extends { id: string } ? true : never;
const _testSingle: _AssertSingle = true;

type _AssertMulti =
  ExtractParams<"/users/:id/posts/:postId"> extends {
    id: string;
    postId: string;
  }
    ? true
    : never;
const _testMulti: _AssertMulti = true;

type _AssertNone =
  ExtractParams<"/users"> extends Record<string, never> ? true : never;
const _testNone: _AssertNone = true;

// Suppress unused variable warnings
void _testSingle;
void _testMulti;
void _testNone;

// ─── Test Route Map ─────────────────────────────────────────

interface User {
  id: string;
  name: string;
}

type TestRoutes = {
  "/users": {
    GET: RouteContract<void, { page?: number }, void, User[]>;
    POST: RouteContract<void, void, { name: string }, User>;
  };
  "/users/:id": {
    GET: RouteContract<{ id: string }, void, void, User>;
    PUT: RouteContract<{ id: string }, void, { name: string }, User>;
    DELETE: RouteContract<{ id: string }, void, void, void>;
  };
};

// ─── Fetch Spy ──────────────────────────────────────────────

interface FetchCall {
  url: string;
  init?: { method?: string; headers?: Record<string, string>; body?: string };
}

let fetchCalls: FetchCall[] = [];

function mockFetch(response: {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}): void {
  fetchCalls = [];
  const headerEntries = {
    "content-type": "application/json",
    ...(response.headers ?? {}),
  };
  (globalThis as Record<string, unknown>).fetch = (
    url: string,
    init?: RequestInit,
  ) => {
    fetchCalls.push({ url, init: init as FetchCall["init"] });
    return Promise.resolve({
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      headers: {
        get: (name: string) =>
          (headerEntries as Record<string, string>)[name.toLowerCase()] ?? null,
      },
      json: () => Promise.resolve(response.body),
      text: () => Promise.resolve(JSON.stringify(response.body)),
    });
  };
}

// ─── Tests ──────────────────────────────────────────────────

describe("createClient", () => {
  it("should create a client with all HTTP methods", () => {
    mockFetch({ status: 200, body: [] });
    const client = createClient<TestRoutes>({
      baseUrl: "http://localhost:3000",
    });

    expect(typeof client.get).toBe("function");
    expect(typeof client.post).toBe("function");
    expect(typeof client.put).toBe("function");
    expect(typeof client.patch).toBe("function");
    expect(typeof client.delete).toBe("function");
  });

  it("should make a GET request with correct URL", async () => {
    const users: User[] = [{ id: "1", name: "Alice" }];
    mockFetch({ status: 200, body: users });

    const client = createClient<TestRoutes>({
      baseUrl: "http://localhost:3000",
    });
    const result = await client.get("/users");

    expect(result).toEqual(users);
    expect(fetchCalls.length).toBe(1);
    expect(fetchCalls[0].url).toBe("http://localhost:3000/users");
    expect(fetchCalls[0].init?.method).toBe("GET");
  });

  it("should substitute path parameters", async () => {
    const user: User = { id: "42", name: "Bob" };
    mockFetch({ status: 200, body: user });

    const client = createClient<TestRoutes>({
      baseUrl: "http://localhost:3000",
    });
    const result = await client.get("/users/:id", { params: { id: "42" } });

    expect(result).toEqual(user);
    expect(fetchCalls[0].url).toBe("http://localhost:3000/users/42");
    expect(fetchCalls[0].init?.method).toBe("GET");
  });

  it("should append query parameters", async () => {
    mockFetch({ status: 200, body: [] });

    const client = createClient<TestRoutes>({
      baseUrl: "http://localhost:3000",
    });
    await client.get("/users", { query: { page: 2 } });

    expect(fetchCalls[0].url).toBe("http://localhost:3000/users?page=2");
  });

  it("should send JSON body for POST requests", async () => {
    const newUser: User = { id: "3", name: "Charlie" };
    mockFetch({ status: 201, body: newUser });

    const client = createClient<TestRoutes>({
      baseUrl: "http://localhost:3000",
    });
    const result = await client.post("/users", { body: { name: "Charlie" } });

    expect(result).toEqual(newUser);
    expect(fetchCalls[0].init?.method).toBe("POST");
    expect(fetchCalls[0].init?.body).toBe(JSON.stringify({ name: "Charlie" }));
    expect(fetchCalls[0].init?.headers?.["content-type"]).toBe(
      "application/json",
    );
  });

  it("should send JSON body for PUT requests", async () => {
    const updated: User = { id: "42", name: "Updated" };
    mockFetch({ status: 200, body: updated });

    const client = createClient<TestRoutes>({
      baseUrl: "http://localhost:3000",
    });
    const result = await client.put("/users/:id", {
      params: { id: "42" },
      body: { name: "Updated" },
    });

    expect(result).toEqual(updated);
    expect(fetchCalls[0].url).toBe("http://localhost:3000/users/42");
    expect(fetchCalls[0].init?.method).toBe("PUT");
  });

  it("should make DELETE requests", async () => {
    mockFetch({ status: 200, body: null });

    const client = createClient<TestRoutes>({
      baseUrl: "http://localhost:3000",
    });
    await client.delete("/users/:id", { params: { id: "42" } });

    expect(fetchCalls[0].url).toBe("http://localhost:3000/users/42");
    expect(fetchCalls[0].init?.method).toBe("DELETE");
  });

  it("should include default headers", async () => {
    mockFetch({ status: 200, body: [] });

    const client = createClient<TestRoutes>({
      baseUrl: "http://localhost:3000",
      headers: { "x-api-key": "secret123" },
    });
    await client.get("/users");

    expect(fetchCalls[0].init?.headers?.["x-api-key"]).toBe("secret123");
  });

  it("should merge request-level headers with defaults", async () => {
    mockFetch({ status: 200, body: [] });

    const client = createClient<TestRoutes>({
      baseUrl: "http://localhost:3000",
      headers: { "x-api-key": "secret123" },
    });
    await client.get("/users", {
      query: {},
      headers: { "x-request-id": "req-1" },
    });

    expect(fetchCalls[0].init?.headers?.["x-api-key"]).toBe("secret123");
    expect(fetchCalls[0].init?.headers?.["x-request-id"]).toBe("req-1");
  });
});

describe("error handling", () => {
  it("should throw AppError subclass for error responses with ErrorResponse body", async () => {
    mockFetch({
      status: 404,
      body: { error: { code: "NOT_FOUND", message: "User not found" } },
    });

    const client = createClient<TestRoutes>({
      baseUrl: "http://localhost:3000",
    });

    let caught: unknown;
    try {
      await client.get("/users/:id", { params: { id: "999" } });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).status).toBe(404);
    expect((caught as AppError).code).toBe("NOT_FOUND");
  });

  it("should throw ClientError for non-OK responses without ErrorResponse body", async () => {
    mockFetch({
      status: 500,
      body: "Internal Server Error",
      headers: { "content-type": "text/plain" },
    });

    const client = createClient<TestRoutes>({
      baseUrl: "http://localhost:3000",
    });

    let caught: unknown;
    try {
      await client.get("/users");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ClientError);
    expect((caught as ClientError).status).toBe(500);
  });
});

describe("interceptors", () => {
  it("should apply request interceptors in order", async () => {
    mockFetch({ status: 200, body: [] });

    const interceptor1: RequestInterceptor = (req) => ({
      ...req,
      headers: { ...(req.headers as Record<string, string>), "x-first": "1" },
    });

    const interceptor2: RequestInterceptor = (req) => ({
      ...req,
      headers: { ...(req.headers as Record<string, string>), "x-second": "2" },
    });

    const client = createClient<TestRoutes>({
      baseUrl: "http://localhost:3000",
      interceptors: [interceptor1, interceptor2],
    });
    await client.get("/users");

    expect(fetchCalls[0].init?.headers?.["x-first"]).toBe("1");
    expect(fetchCalls[0].init?.headers?.["x-second"]).toBe("2");
  });

  it("should support async interceptors", async () => {
    mockFetch({ status: 200, body: [] });

    const asyncInterceptor: RequestInterceptor = async (req) => {
      await Promise.resolve();
      return {
        ...req,
        headers: {
          ...(req.headers as Record<string, string>),
          authorization: "Bearer token123",
        },
      };
    };

    const client = createClient<TestRoutes>({
      baseUrl: "http://localhost:3000",
      interceptors: [asyncInterceptor],
    });
    await client.get("/users");

    expect(fetchCalls[0].init?.headers?.authorization).toBe("Bearer token123");
  });
});
