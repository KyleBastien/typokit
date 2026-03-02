// @typokit/cli — Inspect Command Tests

import { describe, it, expect } from "@rstest/core";
import { parseArgs, createLogger } from "./index.js";
import type { InspectResult } from "./commands/inspect.js";

// ─── parseArgs for inspect ───────────────────────────────────

describe("parseArgs with inspect command", () => {
  it("parses inspect routes", () => {
    const result = parseArgs(["node", "typokit", "inspect", "routes"]);
    expect(result.command).toBe("inspect");
    expect(result.positional).toEqual(["routes"]);
  });

  it("parses inspect route with quoted key", () => {
    const result = parseArgs(["node", "typokit", "inspect", "route", "GET /users/:id"]);
    expect(result.command).toBe("inspect");
    expect(result.positional).toEqual(["route", "GET /users/:id"]);
  });

  it("parses inspect schema with type name", () => {
    const result = parseArgs(["node", "typokit", "inspect", "schema", "User"]);
    expect(result.command).toBe("inspect");
    expect(result.positional).toEqual(["schema", "User"]);
  });

  it("parses --json flag", () => {
    const result = parseArgs(["node", "typokit", "inspect", "routes", "--json"]);
    expect(result.flags["json"]).toBe(true);
  });

  it("parses --format json", () => {
    const result = parseArgs(["node", "typokit", "inspect", "routes", "--format", "json"]);
    expect(result.flags["format"]).toBe("json");
  });

  it("parses inspect errors --last 5", () => {
    const result = parseArgs(["node", "typokit", "inspect", "errors", "--last", "5"]);
    expect(result.command).toBe("inspect");
    expect(result.positional).toEqual(["errors"]);
    expect(result.flags["last"]).toBe("5");
  });

  it("parses inspect performance --route /users", () => {
    const result = parseArgs(["node", "typokit", "inspect", "performance", "--route", "/users"]);
    expect(result.command).toBe("inspect");
    expect(result.positional).toEqual(["performance"]);
    expect(result.flags["route"]).toBe("/users");
  });

  it("parses inspect build-pipeline", () => {
    const result = parseArgs(["node", "typokit", "inspect", "build-pipeline"]);
    expect(result.command).toBe("inspect");
    expect(result.positional).toEqual(["build-pipeline"]);
  });

  it("parses inspect deps as alias for dependencies", () => {
    const result = parseArgs(["node", "typokit", "inspect", "deps"]);
    expect(result.command).toBe("inspect");
    expect(result.positional).toEqual(["deps"]);
  });
});

// ─── executeInspect ──────────────────────────────────────────

describe("executeInspect", () => {
  const logger = createLogger({ verbose: false });
  const baseConfig = {
    typeFiles: ["src/**/*.types.ts"],
    routeFiles: ["src/**/*.routes.ts"],
    outputDir: ".typokit",
    distDir: "dist",
    compiler: "tsc" as const,
    compilerArgs: [],
  };

  it("returns error for unknown subcommand", async () => {
    const { executeInspect } = await import("./commands/inspect.js");
    const result = await executeInspect({
      rootDir: "/nonexistent",
      config: baseConfig,
      logger,
      subcommand: "unknown-thing",
      positional: [],
      flags: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown inspect subcommand");
  });

  it("returns error for routes when no build output exists", async () => {
    const { executeInspect } = await import("./commands/inspect.js");
    const result = await executeInspect({
      rootDir: "/nonexistent/path/no/build",
      config: baseConfig,
      logger,
      subcommand: "routes",
      positional: [],
      flags: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Run 'typokit build' first");
  });

  it("returns error for schema without type name", async () => {
    const { executeInspect } = await import("./commands/inspect.js");
    const result = await executeInspect({
      rootDir: "/nonexistent",
      config: baseConfig,
      logger,
      subcommand: "schema",
      positional: [],
      flags: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Usage:");
  });

  it("returns error for route without key", async () => {
    const { executeInspect } = await import("./commands/inspect.js");
    const result = await executeInspect({
      rootDir: "/nonexistent",
      config: baseConfig,
      logger,
      subcommand: "route",
      positional: [],
      flags: {},
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Usage:");
  });

  it("returns build pipeline hooks", async () => {
    const { executeInspect } = await import("./commands/inspect.js");
    const result = await executeInspect({
      rootDir: "/nonexistent",
      config: baseConfig,
      logger,
      subcommand: "build-pipeline",
      positional: [],
      flags: {},
    });
    expect(result.success).toBe(true);
    const data = result.data as { hooks: Array<{ name: string; order: number; description: string }>; lastBuildStatus: string };
    expect(Array.isArray(data.hooks)).toBe(true);
    expect(data.hooks.length).toBe(6);
    expect(data.hooks[0].name).toBe("beforeTransform");
    expect(data.hooks[5].name).toBe("done");
    expect(data.lastBuildStatus).toBe("no build found");
  });

  it("returns dependency graph from monorepo root", async () => {
    const { executeInspect } = await import("./commands/inspect.js");
    const g = globalThis as Record<string, unknown>;
    const proc = g["process"] as { cwd(): string } | undefined;
    const cwd = proc?.cwd() ?? ".";
    // rstest runs from the package root (packages/cli), go up to monorepo root
    const { resolve } = await import("path");
    const monorepoRoot = resolve(cwd, "../..");

    const result = await executeInspect({
      rootDir: monorepoRoot,
      config: baseConfig,
      logger,
      subcommand: "dependencies",
      positional: [],
      flags: {},
    });
    expect(result.success).toBe(true);
    const nodes = result.data as Array<{ name: string; dependsOn: string[] }>;
    expect(Array.isArray(nodes)).toBe(true);
    // Should find at least some @typokit packages
    expect(nodes.length).toBeGreaterThan(0);
  });

  it("returns middleware info with built-in error middleware", async () => {
    const { executeInspect } = await import("./commands/inspect.js");
    const result = await executeInspect({
      rootDir: "/nonexistent",
      config: baseConfig,
      logger,
      subcommand: "middleware",
      positional: [],
      flags: {},
    });
    expect(result.success).toBe(true);
    const mw = result.data as Array<{ name: string; type: string }>;
    expect(Array.isArray(mw)).toBe(true);
    expect(mw.some(m => m.name === "errorMiddleware")).toBe(true);
  });
});

// ─── Individual inspect functions ────────────────────────────

describe("inspectRoutes", () => {
  it("returns empty routes when no compiled output", async () => {
    const { inspectRoutes } = await import("./commands/inspect.js");
    const result = await inspectRoutes("/nonexistent/path", {
      typeFiles: [],
      routeFiles: [],
      outputDir: ".typokit",
      distDir: "dist",
      compiler: "tsc",
      compilerArgs: [],
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("No compiled routes");
  });
});

describe("inspectSchema", () => {
  it("returns error when no OpenAPI spec exists", async () => {
    const { inspectSchema } = await import("./commands/inspect.js");
    const result = await inspectSchema("/nonexistent/path", {
      typeFiles: [],
      routeFiles: [],
      outputDir: ".typokit",
      distDir: "dist",
      compiler: "tsc",
      compilerArgs: [],
    }, "User");
    expect(result.success).toBe(false);
    expect(result.error).toContain("No OpenAPI spec");
  });
});

describe("inspectServer", () => {
  it("returns not-running when no debug sidecar", async () => {
    const { inspectServer } = await import("./commands/inspect.js");
    // Use a port that won't have a server
    const result = await inspectServer(19999);
    expect(result.success).toBe(false);
    const data = result.data as { status: string };
    expect(data.status).toBe("not running");
    expect(result.error).toContain("Could not connect");
  });
});

describe("inspectErrors", () => {
  it("returns error when no debug sidecar", async () => {
    const { inspectErrors } = await import("./commands/inspect.js");
    const result = await inspectErrors(19999, 5);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Could not connect");
  });
});

describe("inspectPerformance", () => {
  it("returns error when no debug sidecar", async () => {
    const { inspectPerformance } = await import("./commands/inspect.js");
    const result = await inspectPerformance(19999, "/users");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Could not connect");
  });
});

describe("inspectBuildPipeline", () => {
  it("returns standard hook order", async () => {
    const { inspectBuildPipeline } = await import("./commands/inspect.js");
    const result = await inspectBuildPipeline("/nonexistent", {
      typeFiles: [],
      routeFiles: [],
      outputDir: ".typokit",
      distDir: "dist",
      compiler: "tsc",
      compilerArgs: [],
    });
    expect(result.success).toBe(true);
    const data = result.data as { hooks: Array<{ name: string; order: number }> };
    expect(data.hooks.length).toBe(6);
    // Verify hook ordering
    for (let i = 0; i < data.hooks.length - 1; i++) {
      expect(data.hooks[i].order).toBeLessThan(data.hooks[i + 1].order);
    }
  });
});

describe("inspectDependencies", () => {
  it("returns empty graph for nonexistent directory", async () => {
    const { inspectDependencies } = await import("./commands/inspect.js");
    const result = await inspectDependencies("/nonexistent/path/nowhere", {
      typeFiles: [],
      routeFiles: [],
      outputDir: ".typokit",
      distDir: "dist",
      compiler: "tsc",
      compilerArgs: [],
    });
    expect(result.success).toBe(true);
    const nodes = result.data as Array<{ name: string }>;
    expect(Array.isArray(nodes)).toBe(true);
    // No package.json exists, so empty graph
    expect(nodes.length).toBe(0);
  });
});

// ─── InspectResult shape ─────────────────────────────────────

describe("InspectResult", () => {
  it("has correct shape for success", () => {
    const result: InspectResult = {
      success: true,
      data: { routes: [] },
    };
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("has correct shape for failure", () => {
    const result: InspectResult = {
      success: false,
      data: null,
      error: "Something went wrong",
    };
    expect(result.success).toBe(false);
    expect(result.error).toBe("Something went wrong");
  });
});

// ─── JSON output validation ─────────────────────────────────

describe("JSON output", () => {
  it("build-pipeline data is valid JSON", async () => {
    const { inspectBuildPipeline } = await import("./commands/inspect.js");
    const result = await inspectBuildPipeline("/nonexistent", {
      typeFiles: [],
      routeFiles: [],
      outputDir: ".typokit",
      distDir: "dist",
      compiler: "tsc",
      compilerArgs: [],
    });
    const jsonStr = JSON.stringify(result.data, null, 2);
    const parsed = JSON.parse(jsonStr);
    expect(parsed).not.toBeNull();
    expect(typeof parsed).toBe("object");
  });

  it("dependency graph data is valid JSON", async () => {
    const { inspectDependencies } = await import("./commands/inspect.js");
    const result = await inspectDependencies("/nonexistent", {
      typeFiles: [],
      routeFiles: [],
      outputDir: ".typokit",
      distDir: "dist",
      compiler: "tsc",
      compilerArgs: [],
    });
    const jsonStr = JSON.stringify(result.data, null, 2);
    const parsed = JSON.parse(jsonStr);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it("middleware data is valid JSON", async () => {
    const { inspectMiddleware } = await import("./commands/inspect.js");
    const result = await inspectMiddleware("/nonexistent", {
      typeFiles: [],
      routeFiles: [],
      outputDir: ".typokit",
      distDir: "dist",
      compiler: "tsc",
      compilerArgs: [],
    });
    const jsonStr = JSON.stringify(result.data, null, 2);
    const parsed = JSON.parse(jsonStr);
    expect(Array.isArray(parsed)).toBe(true);
  });
});
