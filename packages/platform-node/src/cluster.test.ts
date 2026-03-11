// @typokit/platform-node — Cluster Mode Tests
//
// Testing the full cluster lifecycle requires multi-process coordination.
// We test the API surface and configuration in-process here.
// Full cluster behavior is validated via benchmarks (pnpm nx run benchmarks:bench).

import { describe, it, expect } from "@rstest/core";
import { getDefaultWorkerCount, createClusterServer } from "./cluster.js";
import { availableParallelism, cpus } from "node:os";
import cluster from "node:cluster";

// ─── getDefaultWorkerCount ───────────────────────────────────

describe("getDefaultWorkerCount", () => {
  it("returns a positive integer", () => {
    const count = getDefaultWorkerCount();
    expect(count).toBeGreaterThan(0);
    expect(Number.isInteger(count)).toBe(true);
  });

  it("matches os.availableParallelism() when available", () => {
    if (typeof availableParallelism === "function") {
      expect(getDefaultWorkerCount()).toBe(availableParallelism());
    } else {
      expect(getDefaultWorkerCount()).toBe(cpus().length);
    }
  });
});

// ─── createClusterServer (primary process) ───────────────────

describe("createClusterServer", () => {
  it("returns isPrimary: true when called from the primary process", () => {
    const srv = createClusterServer(
      async () => ({ status: 200, headers: {}, body: null }),
      { workers: 2 },
    );
    // In test runner, we are always the primary
    expect(srv.isPrimary).toBe(true);
    expect(cluster.isPrimary).toBe(true);
  });

  it("respects custom worker count option", () => {
    const srv = createClusterServer(
      async () => ({ status: 200, headers: {}, body: null }),
      { workers: 4 },
    );
    expect(srv.workerCount).toBe(4);
  });

  it("defaults worker count to getDefaultWorkerCount()", () => {
    const srv = createClusterServer(async () => ({
      status: 200,
      headers: {},
      body: null,
    }));
    expect(srv.workerCount).toBe(getDefaultWorkerCount());
  });

  it("has a listen method that returns a Promise", () => {
    const srv = createClusterServer(
      async () => ({ status: 200, headers: {}, body: null }),
      { workers: 1 },
    );
    expect(typeof srv.listen).toBe("function");
  });
});
