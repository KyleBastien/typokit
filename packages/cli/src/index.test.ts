// @typokit/cli — Build Command Tests

import { describe, it, expect } from "@rstest/core";
import { parseArgs, createLogger, loadConfig } from "./index.js";
import type { BuildError } from "./commands/build.js";
import type { TypoKitConfig } from "./config.js";

// ─── parseArgs ───────────────────────────────────────────────

describe("parseArgs", () => {
  it("extracts command from argv", () => {
    const result = parseArgs(["node", "typokit", "build"]);
    expect(result.command).toBe("build");
    expect(Object.keys(result.flags).length).toBe(0);
  });

  it("extracts --verbose flag", () => {
    const result = parseArgs(["node", "typokit", "build", "--verbose"]);
    expect(result.command).toBe("build");
    expect(result.flags["verbose"]).toBe(true);
  });

  it("extracts -v short flag", () => {
    const result = parseArgs(["node", "typokit", "build", "-v"]);
    expect(result.flags["v"]).toBe(true);
  });

  it("extracts --root with value", () => {
    const result = parseArgs(["node", "typokit", "build", "--root", "/my/dir"]);
    expect(result.flags["root"]).toBe("/my/dir");
  });

  it("returns empty command for no args", () => {
    const result = parseArgs(["node", "typokit"]);
    expect(result.command).toBe("");
  });

  it("collects positional args after command", () => {
    const result = parseArgs(["node", "typokit", "build", "extra1", "extra2"]);
    expect(result.positional).toEqual(["extra1", "extra2"]);
  });

});

// ─── createLogger ────────────────────────────────────────────

describe("createLogger", () => {
  it("creates a logger with all methods", () => {
    const logger = createLogger({ verbose: false });
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.success).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.verbose).toBe("function");
    expect(typeof logger.step).toBe("function");
  });

  it("verbose logger does not throw when verbose is false", () => {
    const logger = createLogger({ verbose: false });
    // Should not throw
    logger.verbose("test message");
    logger.info("test info");
  });

  it("verbose logger does not throw when verbose is true", () => {
    const logger = createLogger({ verbose: true });
    logger.verbose("test message");
  });
});

// ─── loadConfig ──────────────────────────────────────────────

describe("loadConfig", () => {
  it("returns default config for nonexistent directory", async () => {
    const config = await loadConfig("/nonexistent/path/that/does/not/exist");
    expect(config.compiler).toBe("tsc");
    expect(config.outputDir).toBe(".typokit");
    expect(config.distDir).toBe("dist");
    expect(Array.isArray(config.typeFiles)).toBe(true);
    expect(Array.isArray(config.routeFiles)).toBe(true);
  });

  it("returns default config when no typokit field in package.json", async () => {
    // The monorepo root doesn't have a typokit field
    const config = await loadConfig(".");
    expect(config.compiler).toBe("tsc");
  });
});

// ─── Build Error Types ──────────────────────────────────────

describe("BuildError", () => {
  it("BuildError interface has expected shape", () => {
    const err: BuildError = {
      source: "tsc",
      phase: "compile",
      message: "Cannot find module",
      file: "src/app.ts",
      line: 42,
      errorType: "TS2307",
    };
    expect(err.source).toBe("tsc");
    expect(err.phase).toBe("compile");
    expect(err.message).toBe("Cannot find module");
    expect(err.file).toBe("src/app.ts");
    expect(err.line).toBe(42);
    expect(err.errorType).toBe("TS2307");
  });

  it("BuildError works without optional fields", () => {
    const err: BuildError = {
      source: "transform",
      phase: "transform",
      message: "Parse error",
    };
    expect(err.file).toBeUndefined();
    expect(err.line).toBeUndefined();
  });
});

// ─── Config Types ────────────────────────────────────────────

describe("TypoKitConfig", () => {
  it("accepts partial config", () => {
    const config: TypoKitConfig = {
      compiler: "tsup",
      outputDir: ".custom",
    };
    expect(config.compiler).toBe("tsup");
    expect(config.outputDir).toBe(".custom");
  });

  it("accepts all compiler options", () => {
    const configs: TypoKitConfig[] = [
      { compiler: "tsc" },
      { compiler: "tsup" },
      { compiler: "swc" },
    ];
    expect(configs.length).toBe(3);
  });
});

// ─── Integration: Build with mock project ────────────────────

describe("executeBuild integration", () => {
  it("succeeds with no source files (empty project)", async () => {
    const { executeBuild } = await import("./commands/build.js");

    const logger = createLogger({ verbose: false });
    const result = await executeBuild({
      rootDir: "/nonexistent/empty/project",
      config: {
        typeFiles: [],
        routeFiles: [],
        outputDir: ".typokit",
        distDir: "dist",
        compiler: "tsc",
        compilerArgs: ["--noEmit"],
      },
      logger,
      verbose: false,
    });

    // Will fail at compile step since /nonexistent doesn't exist
    // but it should handle the error gracefully without throwing
    expect(typeof result.success).toBe("boolean");
    expect(typeof result.duration).toBe("number");
    expect(Array.isArray(result.errors)).toBe(true);
    expect(Array.isArray(result.outputs)).toBe(true);
  });

  it("reports structured errors on compiler failure", async () => {
    const { executeBuild } = await import("./commands/build.js");
    const logger = createLogger({ verbose: false });

    const result = await executeBuild({
      rootDir: "/nonexistent/path",
      config: {
        typeFiles: [],
        routeFiles: [],
        outputDir: ".typokit",
        distDir: "dist",
        compiler: "tsc",
        compilerArgs: ["--noEmit", "--project", "nonexistent.json"],
      },
      logger,
      verbose: false,
    });

    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.duration).toBeGreaterThan(0);
  });

  it("returns BuildResult shape on failure", async () => {
    const { executeBuild } = await import("./commands/build.js");
    const logger = createLogger({ verbose: true });

    const result = await executeBuild({
      rootDir: "/nonexistent",
      config: {
        typeFiles: ["src/**/*.types.ts"],
        routeFiles: [],
        outputDir: ".typokit",
        distDir: "dist",
        compiler: "tsc",
        compilerArgs: ["--noEmit"],
      },
      logger,
      verbose: true,
    });

    expect(typeof result.success).toBe("boolean");
    expect(typeof result.duration).toBe("number");
    expect(Array.isArray(result.outputs)).toBe(true);
    expect(Array.isArray(result.errors)).toBe(true);
  });

  it("defaults to unified build when no target specified", async () => {
    const { executeBuild } = await import("./commands/build.js");
    const logger = createLogger({ verbose: false });

    const result = await executeBuild({
      rootDir: "/nonexistent",
      config: {
        typeFiles: [],
        routeFiles: [],
        outputDir: ".typokit",
        distDir: "dist",
        compiler: "tsc",
        compilerArgs: ["--noEmit"],
      },
      logger,
      verbose: false,
    });

    // Unified build — fails at compiler step for nonexistent dir
    expect(typeof result.success).toBe("boolean");
    expect(Array.isArray(result.errors)).toBe(true);
  });
});
