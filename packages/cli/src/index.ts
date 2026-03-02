// @typokit/cli — Main entry point

export { createLogger } from "./logger.js";
export type { CliLogger } from "./logger.js";
export { loadConfig } from "./config.js";
export type { TypoKitConfig } from "./config.js";
export { executeBuild } from "./commands/build.js";
export type { BuildCommandOptions, BuildError } from "./commands/build.js";
export { executeDev, createDevState, detectChangedFiles, updateTrackedFiles, buildDepGraph, getAffectedOutputs, isCacheValid, updateCache } from "./commands/dev.js";
export type { DevCommandOptions, DevServerState } from "./commands/dev.js";
export { executeInspect, inspectRoutes, inspectRoute, inspectMiddleware, inspectDependencies, inspectSchema, inspectErrors, inspectPerformance, inspectServer, inspectBuildPipeline } from "./commands/inspect.js";
export type { InspectOptions, InspectResult } from "./commands/inspect.js";

/** Parse CLI arguments into a structured object */
export function parseArgs(argv: string[]): {
  command: string;
  flags: Record<string, string | boolean>;
  positional: string[];
} {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  let command = "";

  // Skip node and script path (argv[0], argv[1])
  const args = argv.slice(2);

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("-")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else if (arg.startsWith("-")) {
      const key = arg.slice(1);
      flags[key] = true;
    } else if (!command) {
      command = arg;
    } else {
      positional.push(arg);
    }
  }

  return { command, flags, positional };
}

/**
 * Run the CLI with the given argv.
 * Returns the exit code (0 = success, 1 = failure).
 */
export async function run(argv: string[]): Promise<number> {
  const { resolve } = await import(/* @vite-ignore */ "path") as {
    resolve: (...args: string[]) => string;
  };

  const { command, flags, positional } = parseArgs(argv);
  const verbose = flags["verbose"] === true || flags["v"] === true;

  const { createLogger: createLog } = await import("./logger.js");
  const logger = createLog({ verbose });

  if (!command || command === "help") {
    logger.info("Usage: typokit <command> [options]");
    logger.info("");
    logger.info("Commands:");
    logger.info("  build              Run the full build pipeline");
    logger.info("  dev                Start dev server with watch mode");
    logger.info("  inspect <sub>      Inspect framework state (routes, schema, etc.)");
    logger.info("");
    logger.info("Options:");
    logger.info("  --verbose, -v         Show detailed output");
    logger.info("  --root <dir>          Project root directory (default: cwd)");
    logger.info("  --json                Output as JSON (for inspect commands)");
    logger.info("  --format json         Alias for --json");
    logger.info("  --debug-port <port>   Debug sidecar port (default: 9800)");
    return 0;
  }

  if (command === "build") {
    const g = globalThis as Record<string, unknown>;
    const proc = g["process"] as { cwd(): string } | undefined;
    const cwd = proc?.cwd() ?? ".";
    const rootDir = typeof flags["root"] === "string"
      ? resolve(flags["root"])
      : cwd;

    const { loadConfig: loadConf } = await import("./config.js");
    const config = await loadConf(rootDir);

    const { executeBuild: execBuild } = await import("./commands/build.js");
    const result = await execBuild({
      rootDir,
      config,
      logger,
      verbose,
    });

    return result.success ? 0 : 1;
  }

  if (command === "dev") {
    const g = globalThis as Record<string, unknown>;
    const proc = g["process"] as { cwd(): string } | undefined;
    const cwd = proc?.cwd() ?? ".";
    const rootDir = typeof flags["root"] === "string"
      ? resolve(flags["root"])
      : cwd;

    const debugPort = typeof flags["debug-port"] === "string"
      ? parseInt(flags["debug-port"], 10)
      : 9800;

    const { loadConfig: loadConf } = await import("./config.js");
    const config = await loadConf(rootDir);

    const { executeDev: execDev } = await import("./commands/dev.js");
    const { state } = await execDev({
      rootDir,
      config,
      logger,
      verbose,
      debugPort,
    });

    // Keep running until stopped (dev mode is long-running)
    // The executeDev function sets up watchers and signal handlers
    // We return 0 when it stops
    if (!state.running) {
      return 1;
    }

    // In a real scenario, we'd await a signal here
    // For now, return 0 to indicate successful start
    return 0;
  }

  if (command === "inspect") {
    const g = globalThis as Record<string, unknown>;
    const proc = g["process"] as { cwd(): string } | undefined;
    const cwd = proc?.cwd() ?? ".";
    const rootDir = typeof flags["root"] === "string"
      ? resolve(flags["root"])
      : cwd;

    const { loadConfig: loadConf } = await import("./config.js");
    const config = await loadConf(rootDir);

    const { executeInspect: execInspect } = await import("./commands/inspect.js");
    const subcommand = positional[0] ?? "";
    const subPositional = positional.slice(1);

    const result = await execInspect({
      rootDir,
      config,
      logger,
      subcommand,
      positional: subPositional,
      flags,
    });

    return result.success ? 0 : 1;
  }

  logger.error(`Unknown command: ${command}`);
  logger.info("Run 'typokit help' for usage information.");
  return 1;
}

