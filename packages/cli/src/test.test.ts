// Tests for @typokit/cli test commands
import { describe, it, expect } from "@rstest/core";
import {
  detectTestRunner,
  buildRunnerCommand,
  schemasChanged,
  executeTest,
} from "./commands/test.js";
import { createLogger } from "./logger.js";
import { loadConfig } from "./config.js";

const logger = createLogger({ verbose: false });

describe("test — detectTestRunner", () => {
  it("returns vitest as default when no config files exist", async () => {
    // Use a temp dir with no config files
    const runner = await detectTestRunner("/nonexistent/path/for/test");
    expect(runner).toBe("vitest");
  });
});

describe("test — buildRunnerCommand", () => {
  it("builds jest command for all tests", () => {
    const { command, args } = buildRunnerCommand("jest", "all", "/root", false);
    expect(command).toBe("jest");
    expect(args).toContain("--passWithNoTests");
    expect(args).not.toContain("--testPathPattern");
  });

  it("builds jest command for contracts", () => {
    const { command, args } = buildRunnerCommand("jest", "contracts", "/root", false);
    expect(command).toBe("jest");
    expect(args).toContain("--testPathPattern");
    expect(args).toContain("__generated__/.*\\.contract\\.test");
  });

  it("builds jest command for integration", () => {
    const { command, args } = buildRunnerCommand("jest", "integration", "/root", false);
    expect(command).toBe("jest");
    expect(args).toContain("--testPathPattern");
    expect(args).toContain("integration");
  });

  it("builds jest verbose command", () => {
    const { command, args } = buildRunnerCommand("jest", "all", "/root", true);
    expect(command).toBe("jest");
    expect(args).toContain("--verbose");
  });

  it("builds vitest command for all tests", () => {
    const { command, args } = buildRunnerCommand("vitest", "all", "/root", false);
    expect(command).toBe("vitest");
    expect(args).toContain("run");
    expect(args).toContain("--passWithNoTests");
  });

  it("builds vitest command for contracts", () => {
    const { command, args } = buildRunnerCommand("vitest", "contracts", "/root", false);
    expect(command).toBe("vitest");
    expect(args).toContain("run");
    expect(args).toContain("__generated__/");
  });

  it("builds vitest command for integration", () => {
    const { command, args } = buildRunnerCommand("vitest", "integration", "/root", false);
    expect(command).toBe("vitest");
    expect(args).toContain("--dir");
    expect(args).toContain("tests/integration");
  });

  it("builds vitest verbose command", () => {
    const { args } = buildRunnerCommand("vitest", "all", "/root", true);
    expect(args).toContain("--reporter");
    expect(args).toContain("verbose");
  });

  it("builds rstest command for all tests", () => {
    const { command, args } = buildRunnerCommand("rstest", "all", "/root", false);
    expect(command).toBe("rstest");
    expect(args).toContain("run");
    expect(args).toContain("--passWithNoTests");
  });

  it("builds rstest command for contracts", () => {
    const { command, args } = buildRunnerCommand("rstest", "contracts", "/root", false);
    expect(command).toBe("rstest");
    expect(args).toContain("--testPathPattern");
    expect(args).toContain("__generated__/.*\\.contract\\.test");
  });

  it("builds rstest command for integration", () => {
    const { command, args } = buildRunnerCommand("rstest", "integration", "/root", false);
    expect(command).toBe("rstest");
    expect(args).toContain("--testPathPattern");
    expect(args).toContain("integration");
  });
});

describe("test — schemasChanged", () => {
  it("returns true when no cache exists", async () => {
    const config = await loadConfig("/nonexistent/path");
    const changed = await schemasChanged("/nonexistent/path", config);
    expect(changed).toBe(true);
  });
});

describe("test — executeTest", () => {
  it("rejects unknown runner", async () => {
    const config = await loadConfig("/tmp");
    const result = await executeTest({
      rootDir: "/tmp",
      config,
      logger,
      subcommand: "all",
      flags: { runner: "unknown-runner" },
      verbose: false,
    });
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("Unknown test runner");
  });

  it("accepts valid --runner flag", async () => {
    const config = await loadConfig("/tmp");
    // This will fail to spawn jest but will detect the runner correctly
    const result = await executeTest({
      rootDir: "/tmp",
      config,
      logger,
      subcommand: "all",
      flags: { runner: "jest" },
      verbose: false,
    });
    // The runner should be set correctly even if spawn fails
    expect(result.runner).toBe("jest");
  });

  it("maps test:contracts to contracts subcommand", async () => {
    const config = await loadConfig("/tmp");
    const result = await executeTest({
      rootDir: "/tmp",
      config,
      logger,
      subcommand: "contracts",
      flags: { runner: "vitest" },
      verbose: false,
    });
    expect(result.runner).toBe("vitest");
  });

  it("maps test:integration to integration subcommand", async () => {
    const config = await loadConfig("/tmp");
    const result = await executeTest({
      rootDir: "/tmp",
      config,
      logger,
      subcommand: "integration",
      flags: { runner: "vitest" },
      verbose: false,
    });
    expect(result.runner).toBe("vitest");
  });
});

describe("test — CLI routing", () => {
  it("exports parseArgs that handles test command", async () => {
    const { parseArgs } = await import("./index.js");
    const parsed = parseArgs(["node", "typokit", "test"]);
    expect(parsed.command).toBe("test");
  });

  it("exports parseArgs that handles test:contracts", async () => {
    const { parseArgs } = await import("./index.js");
    const parsed = parseArgs(["node", "typokit", "test:contracts"]);
    expect(parsed.command).toBe("test:contracts");
  });

  it("exports parseArgs that handles test:integration", async () => {
    const { parseArgs } = await import("./index.js");
    const parsed = parseArgs(["node", "typokit", "test:integration"]);
    expect(parsed.command).toBe("test:integration");
  });

  it("exports parseArgs with --runner flag", async () => {
    const { parseArgs } = await import("./index.js");
    const parsed = parseArgs(["node", "typokit", "test", "--runner", "jest"]);
    expect(parsed.command).toBe("test");
    expect(parsed.flags["runner"]).toBe("jest");
  });
});
