// @typokit/cli — Dev Command Tests

import { describe, it, expect } from "@rstest/core";
import {
  createDevState,
  detectChangedFiles,
  updateTrackedFiles,
  buildDepGraph,
  getAffectedOutputs,
  isCacheValid,
  updateCache,
} from "./commands/dev.js";
import { parseArgs } from "./index.js";

// ─── createDevState ─────────────────────────────────────────

describe("createDevState", () => {
  it("creates initial state with defaults", () => {
    const state = createDevState();
    expect(state.running).toBe(false);
    expect(state.stopWatcher).toBe(null);
    expect(state.trackedFiles.size).toBe(0);
    expect(state.depGraph.size).toBe(0);
    expect(state.astCache.size).toBe(0);
    expect(state.rebuildCount).toBe(0);
    expect(state.lastRebuildMs).toBe(0);
    expect(state.serverPid).toBe(null);
  });
});

// ─── detectChangedFiles ─────────────────────────────────────

describe("detectChangedFiles", () => {
  it("detects added files", () => {
    const state = createDevState();
    const currentFiles = [
      { path: "/src/a.ts", mtime: 1000 },
      { path: "/src/b.ts", mtime: 2000 },
    ];
    const result = detectChangedFiles(state, currentFiles);
    expect(result.added.length).toBe(2);
    expect(result.changed.length).toBe(0);
    expect(result.removed.length).toBe(0);
  });

  it("detects changed files by mtime", () => {
    const state = createDevState();
    state.trackedFiles.set("/src/a.ts", { path: "/src/a.ts", mtime: 1000 });
    state.trackedFiles.set("/src/b.ts", { path: "/src/b.ts", mtime: 2000 });

    const currentFiles = [
      { path: "/src/a.ts", mtime: 1500 }, // changed
      { path: "/src/b.ts", mtime: 2000 }, // unchanged
    ];

    const result = detectChangedFiles(state, currentFiles);
    expect(result.changed.length).toBe(1);
    expect(result.changed[0].path).toBe("/src/a.ts");
    expect(result.added.length).toBe(0);
    expect(result.removed.length).toBe(0);
  });

  it("detects removed files", () => {
    const state = createDevState();
    state.trackedFiles.set("/src/a.ts", { path: "/src/a.ts", mtime: 1000 });
    state.trackedFiles.set("/src/b.ts", { path: "/src/b.ts", mtime: 2000 });

    const currentFiles = [{ path: "/src/a.ts", mtime: 1000 }];

    const result = detectChangedFiles(state, currentFiles);
    expect(result.removed.length).toBe(1);
    expect(result.removed[0]).toBe("/src/b.ts");
  });

  it("handles mixed changes", () => {
    const state = createDevState();
    state.trackedFiles.set("/src/a.ts", { path: "/src/a.ts", mtime: 1000 });
    state.trackedFiles.set("/src/b.ts", { path: "/src/b.ts", mtime: 2000 });

    const currentFiles = [
      { path: "/src/a.ts", mtime: 1500 }, // changed
      { path: "/src/c.ts", mtime: 3000 }, // added
      // /src/b.ts removed
    ];

    const result = detectChangedFiles(state, currentFiles);
    expect(result.changed.length).toBe(1);
    expect(result.added.length).toBe(1);
    expect(result.removed.length).toBe(1);
  });
});

// ─── updateTrackedFiles ─────────────────────────────────────

describe("updateTrackedFiles", () => {
  it("replaces all tracked files", () => {
    const state = createDevState();
    state.trackedFiles.set("/old.ts", { path: "/old.ts", mtime: 100 });

    updateTrackedFiles(state, [
      { path: "/src/a.ts", mtime: 1000 },
      { path: "/src/b.ts", mtime: 2000 },
    ]);

    expect(state.trackedFiles.size).toBe(2);
    expect(state.trackedFiles.has("/old.ts")).toBe(false);
    expect(state.trackedFiles.has("/src/a.ts")).toBe(true);
    expect(state.trackedFiles.has("/src/b.ts")).toBe(true);
  });
});

// ─── buildDepGraph ──────────────────────────────────────────

describe("buildDepGraph", () => {
  it("maps type files to validator and schema outputs", () => {
    const graph = buildDepGraph(["/src/types.ts"], []);
    const entry = graph.get("/src/types.ts");
    expect(entry).toBeDefined();
    expect(entry!.category).toBe("type");
    expect(entry!.affectedOutputs).toContain("validators");
    expect(entry!.affectedOutputs).toContain("schemas/openapi.json");
  });

  it("maps route files to router, schema, and test outputs", () => {
    const graph = buildDepGraph([], ["/src/routes.ts"]);
    const entry = graph.get("/src/routes.ts");
    expect(entry).toBeDefined();
    expect(entry!.category).toBe("route");
    expect(entry!.affectedOutputs).toContain("routes/compiled-router.ts");
    expect(entry!.affectedOutputs).toContain("schemas/openapi.json");
    expect(entry!.affectedOutputs).toContain("tests/contract.test.ts");
  });

  it("handles both type and route files", () => {
    const graph = buildDepGraph(["/src/types.ts"], ["/src/routes.ts"]);
    expect(graph.size).toBe(2);
  });
});

// ─── getAffectedOutputs ────────────────────────────────────

describe("getAffectedOutputs", () => {
  it("returns affected outputs for changed type file", () => {
    const graph = buildDepGraph(["/src/types.ts"], ["/src/routes.ts"]);
    const affected = getAffectedOutputs(graph, ["/src/types.ts"]);
    expect(affected.has("validators")).toBe(true);
    expect(affected.has("schemas/openapi.json")).toBe(true);
  });

  it("returns affected outputs for changed route file", () => {
    const graph = buildDepGraph(["/src/types.ts"], ["/src/routes.ts"]);
    const affected = getAffectedOutputs(graph, ["/src/routes.ts"]);
    expect(affected.has("routes/compiled-router.ts")).toBe(true);
    expect(affected.has("tests/contract.test.ts")).toBe(true);
  });

  it("merges outputs for multiple changed files", () => {
    const graph = buildDepGraph(["/src/types.ts"], ["/src/routes.ts"]);
    const affected = getAffectedOutputs(graph, [
      "/src/types.ts",
      "/src/routes.ts",
    ]);
    expect(affected.has("validators")).toBe(true);
    expect(affected.has("routes/compiled-router.ts")).toBe(true);
    expect(affected.has("schemas/openapi.json")).toBe(true);
  });

  it("returns empty set for unknown files", () => {
    const graph = buildDepGraph(["/src/types.ts"], []);
    const affected = getAffectedOutputs(graph, ["/src/unknown.ts"]);
    expect(affected.size).toBe(0);
  });
});

// ─── AST Cache ──────────────────────────────────────────────

describe("isCacheValid", () => {
  it("returns false for uncached file", () => {
    const cache = new Map();
    expect(isCacheValid(cache, "/src/a.ts", 1000)).toBe(false);
  });

  it("returns true when mtime matches", () => {
    const cache = new Map();
    updateCache(cache, "/src/a.ts", 1000);
    expect(isCacheValid(cache, "/src/a.ts", 1000)).toBe(true);
  });

  it("returns false when mtime differs", () => {
    const cache = new Map();
    updateCache(cache, "/src/a.ts", 1000);
    expect(isCacheValid(cache, "/src/a.ts", 2000)).toBe(false);
  });
});

describe("updateCache", () => {
  it("stores cache entry with mtime and hash", () => {
    const cache = new Map();
    updateCache(cache, "/src/a.ts", 1000);
    const entry = cache.get("/src/a.ts");
    expect(entry).toBeDefined();
    expect(entry.mtime).toBe(1000);
    expect(typeof entry.hash).toBe("string");
    expect(entry.hash.length).toBeGreaterThan(0);
  });

  it("overwrites existing cache entry", () => {
    const cache = new Map();
    updateCache(cache, "/src/a.ts", 1000);
    updateCache(cache, "/src/a.ts", 2000);
    const entry = cache.get("/src/a.ts");
    expect(entry.mtime).toBe(2000);
  });
});

// ─── parseArgs: dev command ─────────────────────────────────

describe("parseArgs dev command", () => {
  it("parses dev command", () => {
    const result = parseArgs(["node", "typokit", "dev"]);
    expect(result.command).toBe("dev");
  });

  it("parses --debug-port flag", () => {
    const result = parseArgs([
      "node",
      "typokit",
      "dev",
      "--debug-port",
      "9900",
    ]);
    expect(result.command).toBe("dev");
    expect(result.flags["debug-port"]).toBe("9900");
  });

  it("parses dev with --verbose", () => {
    const result = parseArgs(["node", "typokit", "dev", "--verbose"]);
    expect(result.command).toBe("dev");
    expect(result.flags["verbose"]).toBe(true);
  });

  it("parses dev with multiple flags", () => {
    const result = parseArgs([
      "node",
      "typokit",
      "dev",
      "--verbose",
      "--debug-port",
      "8080",
      "--root",
      "/my/project",
    ]);
    expect(result.command).toBe("dev");
    expect(result.flags["verbose"]).toBe(true);
    expect(result.flags["debug-port"]).toBe("8080");
    expect(result.flags["root"]).toBe("/my/project");
  });
});

// ─── DevServerState ─────────────────────────────────────────

describe("DevServerState lifecycle", () => {
  it("tracks rebuild count", () => {
    const state = createDevState();
    expect(state.rebuildCount).toBe(0);
    state.rebuildCount++;
    expect(state.rebuildCount).toBe(1);
  });

  it("tracks last rebuild duration", () => {
    const state = createDevState();
    expect(state.lastRebuildMs).toBe(0);
    state.lastRebuildMs = 42;
    expect(state.lastRebuildMs).toBe(42);
  });

  it("running flag controls watcher lifecycle", () => {
    const state = createDevState();
    expect(state.running).toBe(false);
    state.running = true;
    expect(state.running).toBe(true);
    state.running = false;
    expect(state.running).toBe(false);
  });
});
