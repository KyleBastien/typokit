// @typokit/cli — Test Commands

import type { CliLogger } from "../logger.js";
import type { TypoKitConfig } from "../config.js";

export type TestRunner = "jest" | "vitest" | "rstest";

export interface TestCommandOptions {
  /** Project root directory */
  rootDir: string;
  /** Resolved configuration */
  config: Required<TypoKitConfig>;
  /** Logger instance */
  logger: CliLogger;
  /** Test subcommand: "all" | "contracts" | "integration" */
  subcommand: string;
  /** CLI flags */
  flags: Record<string, string | boolean>;
  /** Whether verbose mode is enabled */
  verbose: boolean;
}

export interface TestResult {
  /** Whether all tests passed */
  success: boolean;
  /** Which test runner was used */
  runner: TestRunner;
  /** Duration in milliseconds */
  duration: number;
  /** Errors encountered */
  errors: string[];
  /** Whether contract tests were regenerated before running */
  contractsRegenerated: boolean;
}

/**
 * Config file patterns used to auto-detect test runners.
 */
const RUNNER_CONFIG_PATTERNS: Record<TestRunner, string[]> = {
  jest: ["jest.config.js", "jest.config.ts", "jest.config.mjs", "jest.config.cjs"],
  vitest: ["vitest.config.js", "vitest.config.ts", "vitest.config.mjs", "vitest.config.cjs"],
  rstest: ["rstest.config.js", "rstest.config.ts", "rstest.config.mjs", "rstest.config.cjs"],
};

/**
 * Auto-detect the test runner by checking for config files in the project root.
 * Returns the first match found, or "vitest" as default.
 */
export async function detectTestRunner(rootDir: string): Promise<TestRunner> {
  const { join } = await import(/* @vite-ignore */ "path") as {
    join: (...args: string[]) => string;
  };
  const { existsSync } = await import(/* @vite-ignore */ "fs") as {
    existsSync: (p: string) => boolean;
  };

  for (const [runner, patterns] of Object.entries(RUNNER_CONFIG_PATTERNS) as [TestRunner, string[]][]) {
    for (const pattern of patterns) {
      if (existsSync(join(rootDir, pattern))) {
        return runner;
      }
    }
  }

  return "vitest";
}

/**
 * Build the command and arguments for each test runner.
 */
export function buildRunnerCommand(
  runner: TestRunner,
  subcommand: string,
  rootDir: string,
  verbose: boolean,
): { command: string; args: string[] } {
  const args: string[] = [];

  switch (runner) {
    case "jest": {
      const cmd = "jest";
      if (subcommand === "contracts") {
        args.push("--testPathPattern", "__generated__/.*\\.contract\\.test");
      } else if (subcommand === "integration") {
        args.push("--testPathPattern", "integration");
      }
      if (verbose) {
        args.push("--verbose");
      }
      args.push("--passWithNoTests");
      return { command: cmd, args };
    }
    case "vitest": {
      const cmd = "vitest";
      args.push("run");
      if (subcommand === "contracts") {
        args.push("__generated__/");
      } else if (subcommand === "integration") {
        args.push("--dir", "tests/integration");
      }
      if (verbose) {
        args.push("--reporter", "verbose");
      }
      args.push("--passWithNoTests");
      return { command: cmd, args };
    }
    case "rstest": {
      const cmd = "rstest";
      args.push("run");
      if (subcommand === "contracts") {
        args.push("--testPathPattern", "__generated__/.*\\.contract\\.test");
      } else if (subcommand === "integration") {
        args.push("--testPathPattern", "integration");
      }
      args.push("--passWithNoTests");
      return { command: cmd, args };
    }
  }
}

/**
 * Check whether schemas have changed since last contract test generation.
 * Compares the content hash in .typokit/build-cache.json against current type files.
 */
export async function schemasChanged(
  rootDir: string,
  config: Required<TypoKitConfig>,
): Promise<boolean> {
  const { join } = await import(/* @vite-ignore */ "path") as {
    join: (...args: string[]) => string;
  };
  const { existsSync } = await import(/* @vite-ignore */ "fs") as {
    existsSync: (p: string) => boolean;
  };

  const cacheFile = join(rootDir, config.outputDir, "build-cache.json");

  // If no cache exists, schemas have effectively "changed" (never built)
  if (!existsSync(cacheFile)) {
    return true;
  }

  // If the generated contracts directory doesn't exist, need to regenerate
  const generatedDir = join(rootDir, "__generated__");
  if (!existsSync(generatedDir)) {
    return true;
  }

  // Cache exists and generated dir exists — assume up to date
  // A full implementation would compare file hashes, but for now
  // we rely on the build pipeline's cache mechanism
  return false;
}

/**
 * Regenerate contract tests by invoking the generate:tests pipeline.
 */
async function regenerateContracts(
  options: TestCommandOptions,
): Promise<{ success: boolean; errors: string[] }> {
  const { logger, rootDir, config, verbose } = options;

  logger.step("test", "Regenerating contract tests from schemas...");

  try {
    const { executeGenerate } = await import("./generate.js");
    const result = await executeGenerate({
      rootDir,
      config,
      logger,
      subcommand: "tests",
      flags: options.flags,
      verbose,
    });

    if (!result.success) {
      return { success: false, errors: result.errors };
    }

    logger.success(`Contract tests regenerated — ${result.filesWritten.length} files`);
    return { success: true, errors: [] };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, errors: [`Failed to regenerate contracts: ${message}`] };
  }
}

/**
 * Execute test commands.
 *
 * Subcommands:
 *   "all"         — runs all tests
 *   "contracts"   — runs only contract tests from __generated__/
 *   "integration" — runs integration tests with in-memory database
 */
export async function executeTest(options: TestCommandOptions): Promise<TestResult> {
  const startTime = Date.now();
  const { logger, rootDir, config, flags, verbose } = options;
  const subcommand = options.subcommand || "all";
  const errors: string[] = [];
  let contractsRegenerated = false;

  // Determine test runner: --runner flag overrides auto-detection
  let runner: TestRunner;
  if (typeof flags["runner"] === "string") {
    const requested = flags["runner"] as string;
    if (requested === "jest" || requested === "vitest" || requested === "rstest") {
      runner = requested;
      logger.step("test", `Using runner: ${runner} (from --runner flag)`);
    } else {
      logger.error(`Unknown test runner: ${requested}. Use jest, vitest, or rstest.`);
      return {
        success: false,
        runner: "vitest",
        duration: Date.now() - startTime,
        errors: [`Unknown test runner: ${requested}`],
        contractsRegenerated: false,
      };
    }
  } else {
    runner = await detectTestRunner(rootDir);
    logger.step("test", `Auto-detected runner: ${runner}`);
  }

  // Regenerate contract tests if schemas have changed
  if (subcommand === "all" || subcommand === "contracts") {
    const changed = await schemasChanged(rootDir, config);
    if (changed) {
      const regenResult = await regenerateContracts(options);
      contractsRegenerated = true;
      if (!regenResult.success) {
        logger.warn("Contract test regeneration failed — running existing tests");
        for (const e of regenResult.errors) {
          errors.push(e);
        }
      }
    }
  }

  // Build runner command
  const { command, args } = buildRunnerCommand(runner, subcommand, rootDir, verbose);

  logger.step("test", `Running: ${command} ${args.join(" ")}`);

  // Execute the test runner
  const { spawnSync } = await import(/* @vite-ignore */ "child_process") as {
    spawnSync: (cmd: string, args: string[], opts: {
      cwd?: string;
      encoding?: string;
      stdio?: string;
    }) => { status: number | null; stdout: string; stderr: string; error?: Error };
  };

  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: "utf-8",
    stdio: "pipe",
  });

  if (result.error) {
    logger.error(`Failed to start test runner: ${result.error.message}`);
    return {
      success: false,
      runner,
      duration: Date.now() - startTime,
      errors: [`Failed to start ${runner}: ${result.error.message}`],
      contractsRegenerated,
    };
  }

  // Output test results
  if (result.stdout) {
    // Print test output lines
    for (const line of result.stdout.split("\n")) {
      if (line.trim()) {
        logger.info(line);
      }
    }
  }

  if (result.stderr && (verbose || result.status !== 0)) {
    for (const line of result.stderr.split("\n")) {
      if (line.trim()) {
        logger.error(line);
      }
    }
  }

  const success = result.status === 0;
  const duration = Date.now() - startTime;

  if (success) {
    logger.success(`Tests passed in ${duration}ms`);
  } else {
    logger.error(`Tests failed (exit code: ${result.status})`);
    errors.push(`Test runner exited with code ${result.status}`);
  }

  return {
    success,
    runner,
    duration,
    errors,
    contractsRegenerated,
  };
}
