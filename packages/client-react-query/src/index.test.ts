// @typokit/client-react-query — Tests

import { describe, it, expect } from "@rstest/core";
import { buildQueryKey } from "./index.js";

// ─── buildQueryKey Tests ────────────────────────────────────

describe("buildQueryKey", () => {
  it("returns path-only key when no params or query", () => {
    const key = buildQueryKey("/users");
    expect(key).toEqual(["/users"]);
  });

  it("includes params in key when provided", () => {
    const key = buildQueryKey("/users/:id", { id: "123" });
    expect(key).toEqual(["/users/:id", { id: "123" }]);
  });

  it("includes query in key when provided", () => {
    const key = buildQueryKey("/users", undefined, { page: 1, limit: 10 });
    expect(key).toEqual(["/users", { page: 1, limit: 10 }]);
  });

  it("includes both params and query when provided", () => {
    const key = buildQueryKey(
      "/users/:id/posts",
      { id: "42" },
      { sort: "date" },
    );
    expect(key).toEqual(["/users/:id/posts", { id: "42" }, { sort: "date" }]);
  });

  it("omits empty params object", () => {
    const key = buildQueryKey("/users", {});
    expect(key).toEqual(["/users"]);
  });

  it("omits empty query object", () => {
    const key = buildQueryKey("/users", undefined, {});
    expect(key).toEqual(["/users"]);
  });

  it("produces different keys for different params", () => {
    const key1 = buildQueryKey("/users/:id", { id: "1" });
    const key2 = buildQueryKey("/users/:id", { id: "2" });
    expect(key1).not.toEqual(key2);
  });

  it("produces different keys for different queries", () => {
    const key1 = buildQueryKey("/users", undefined, { page: 1 });
    const key2 = buildQueryKey("/users", undefined, { page: 2 });
    expect(key1).not.toEqual(key2);
  });

  it("produces different keys for different paths", () => {
    const key1 = buildQueryKey("/users");
    const key2 = buildQueryKey("/posts");
    expect(key1).not.toEqual(key2);
  });
});
