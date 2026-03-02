// @typokit/cli — Build Command

import type { CliLogger } from "../logger.js";
import type { TypoKitConfig } from "../config.js";
import type { BuildResult, BuildContext, GeneratedOutput } from "@typokit/types";
import type { TypoKitPlugin, BuildPipelineInstance } from "@typokit/core";

export interface BuildCommandOptions {
  /** Project root directory */
  rootDir: string;
  /** Resolved configuration */
  config: Required<TypoKitConfig>;
  /** Logger instance */
  logger: CliLogger;
  /** Whether verbose mode is enabled */
  verbose: boolean;
  /** Plugins to register with the build pipeline */
  plugins?: TypoKitPlugin[];
}

/** Structured build error with source context */
export interface BuildError {
  source: string;
  phase: "transform" | "compile";
  message: string;
  file?: string;
  line?: number;
  errorType?: string;
}

/**
 * Resolve glob patterns to actual file paths.
 */
async function resolveFilePatterns(
  rootDir: string,
  patterns: string[],
): Promise<string[]> {
  const { join, resolve } = await import(/* @vite-ignore */ "path") as {
    join: (...args: string[]) => string;
    resolve: (...args: string[]) => string;
  };
  const { readdirSync, statSync, existsSync } = await import(/* @vite-ignore */ "fs") as {
    readdirSync: (p: string, opts?: { recursive?: boolean }) => string[];
    statSync: (p: string) => { isFile(): boolean; isDirectory(): boolean };
    existsSync: (p: string) => boolean;
  };

  const files: string[] = [];

  for (const pattern of patterns) {
    if (pattern.includes("*")) {
      // Simple glob matching: support **/*.ext and **/name.ts patterns
      const parts = pattern.split("/");
      const hasDoubleGlob = parts.includes("**");
      const lastPart = parts[parts.length - 1];

      // Determine the base directory (everything before the first glob)
      const baseParts: string[] = [];
      for (const part of parts) {
        if (part.includes("*")) break;
        baseParts.push(part);
      }
      const baseDir = baseParts.length > 0 ? join(rootDir, ...baseParts) : rootDir;

      if (!existsSync(baseDir)) continue;

      // List files recursively if **
      const entries = hasDoubleGlob
        ? listFilesRecursive(baseDir, existsSync, readdirSync, statSync, join)
        : readdirSync(baseDir).map(f => join(baseDir, f));

      // Match against the filename pattern
      const filePattern = lastPart.replace(/\*/g, ".*");
      const regex = new RegExp(`^${filePattern}$`);

      for (const entry of entries) {
        const name = entry.split(/[\\/]/).pop() ?? "";
        if (regex.test(name)) {
          files.push(resolve(entry));
        }
      }
    } else {
      // Direct path
      const fullPath = resolve(join(rootDir, pattern));
      if (existsSync(fullPath)) {
        files.push(fullPath);
      }
    }
  }

  return [...new Set(files)].sort();
}

function listFilesRecursive(
  dir: string,
  existsSync: (p: string) => boolean,
  readdirSync: (p: string) => string[],
  statSync: (p: string) => { isFile(): boolean; isDirectory(): boolean },
  join: (...args: string[]) => string,
): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        if (entry !== "node_modules" && entry !== "dist" && entry !== ".typokit") {
          results.push(...listFilesRecursive(fullPath, existsSync, readdirSync, statSync, join));
        }
      } else if (stat.isFile()) {
        results.push(fullPath);
      }
    } catch {
      // Skip files that can't be stat'd
    }
  }
  return results;
}

/**
 * Parse TypeScript compiler errors into structured BuildError objects.
 */
function parseCompilerErrors(stderr: string): BuildError[] {
  const errors: BuildError[] = [];
  const lines = stderr.split("\n");

  for (const line of lines) {
    // Match tsc error format: file(line,col): error TSxxxx: message
    const match = line.match(/^(.+?)\((\d+),\d+\):\s*error\s+(TS\d+):\s*(.+)/);
    if (match) {
      errors.push({
        source: "tsc",
        phase: "compile",
        message: match[4],
        file: match[1],
        line: parseInt(match[2], 10),
        errorType: match[3],
      });
    }
  }

  // If no structured errors found but there's stderr content, add a generic error
  if (errors.length === 0 && stderr.trim()) {
    errors.push({
      source: "compiler",
      phase: "compile",
      message: stderr.trim().split("\n")[0],
    });
  }

  return errors;
}

/**
 * Run the TypeScript compiler step.
 */
async function runCompiler(
  options: BuildCommandOptions,
): Promise<{ success: boolean; errors: BuildError[] }> {
  const { spawnSync } = await import(/* @vite-ignore */ "child_process") as {
    spawnSync: (cmd: string, args: string[], opts: {
      cwd?: string;
      encoding?: string;
    }) => { status: number | null; stdout: string; stderr: string; error?: Error };
  };

  const { config, rootDir, logger } = options;
  const compiler = config.compiler;
  const args = [...config.compilerArgs];

  let command: string;
  switch (compiler) {
    case "tsc":
      command = "tsc";
      if (args.length === 0) {
        args.push("-p", "tsconfig.json");
      }
      break;
    case "tsup":
      command = "tsup";
      break;
    case "swc":
      command = "swc";
      if (args.length === 0) {
        args.push("src", "-d", config.distDir);
      }
      break;
    default:
      command = "tsc";
      args.push("-p", "tsconfig.json");
  }

  logger.step("compile", `Running ${compiler}: ${command} ${args.join(" ")}`);

  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: "utf-8",
  });

  if (result.error) {
    return {
      success: false,
      errors: [{
        source: compiler,
        phase: "compile",
        message: result.error.message,
        errorType: "SPAWN_ERROR",
      }],
    };
  }

  if (result.status !== 0) {
    const errors = parseCompilerErrors(result.stderr || result.stdout);
    return { success: false, errors };
  }

  if (options.verbose && result.stdout) {
    logger.verbose(result.stdout.trim());
  }

  return { success: true, errors: [] };
}

/**
 * Execute the build command.
 *
 * 1. Resolve type and route files from config patterns
 * 2. Create build pipeline and let plugins register taps via onBuild()
 * 3. Fire beforeTransform hook
 * 4. Run the Rust native transform pipeline (buildPipeline)
 * 5. Fire afterTypeParse, afterValidators, afterRouteTable hooks
 * 6. Fire emit hook (plugins can add outputs)
 * 7. Run the TypeScript compiler
 * 8. Fire done hook
 * 9. Return structured BuildResult
 */
export async function executeBuild(
  options: BuildCommandOptions,
): Promise<BuildResult & { pipeline?: BuildPipelineInstance }> {
  const { createBuildPipeline } = await import(
    /* @vite-ignore */ "@typokit/core"
  ) as {
    createBuildPipeline: () => BuildPipelineInstance;
  };

  const startTime = Date.now();
  const { config, rootDir, logger, verbose, plugins = [] } = options;
  const errors: string[] = [];
  const outputs: GeneratedOutput[] = [];

  // Create build pipeline and let plugins register their taps
  const pipeline = createBuildPipeline();
  for (const plugin of plugins) {
    if (plugin.onBuild) {
      plugin.onBuild(pipeline);
      if (verbose) {
        logger.verbose(`Plugin "${plugin.name}" registered build hooks`);
      }
    }
  }

  const buildCtx: BuildContext = {
    rootDir,
    outDir: config.outputDir,
    dev: false,
    outputs,
  };

  // Step 1: Resolve file patterns
  logger.step("build", "Resolving source files...");
  const typeFiles = await resolveFilePatterns(rootDir, config.typeFiles);
  const routeFiles = await resolveFilePatterns(rootDir, config.routeFiles);

  if (verbose) {
    logger.verbose(`Type files: ${typeFiles.length} found`);
    for (const f of typeFiles) logger.verbose(`  ${f}`);
    logger.verbose(`Route files: ${routeFiles.length} found`);
    for (const f of routeFiles) logger.verbose(`  ${f}`);
  }

  // Step 2: Fire beforeTransform hook
  await pipeline.hooks.beforeTransform.call(buildCtx);

  // Step 3: Run native transform pipeline

  if (typeFiles.length > 0 || routeFiles.length > 0) {
    logger.step("transform", "Running native transform pipeline...");

    try {
      const { buildPipeline: nativeBuildPipeline } = await import(
        /* @vite-ignore */ "@typokit/transform-native"
      ) as {
        buildPipeline: (opts: {
          typeFiles: string[];
          routeFiles: string[];
          outputDir?: string;
        }) => Promise<{
          regenerated: boolean;
          contentHash: string;
          filesWritten: string[];
        }>;
      };

      const result = await nativeBuildPipeline({
        typeFiles,
        routeFiles,
        outputDir: config.outputDir,
      });

      if (result.regenerated) {
        logger.success(`Transform complete — ${result.filesWritten.length} files written`);
        for (const f of result.filesWritten) {
          outputs.push({ filePath: f, content: "", overwrite: true });
        }
      } else {
        logger.success("Transform skipped — cache hit");
      }

      if (verbose) {
        logger.verbose(`Content hash: ${result.contentHash}`);
        for (const f of result.filesWritten) logger.verbose(`  wrote: ${f}`);
      }

      // Fire afterTypeParse hook (types extracted during transform)
      await pipeline.hooks.afterTypeParse.call({}, buildCtx);

      // Fire afterValidators hook
      await pipeline.hooks.afterValidators.call(outputs, buildCtx);

      // Fire afterRouteTable hook
      await pipeline.hooks.afterRouteTable.call({
        segment: "",
        children: {},
        handlers: {},
      }, buildCtx);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Transform failed: ${message}`);
      errors.push(`Transform error: ${message}`);
      return {
        success: false,
        outputs,
        duration: Date.now() - startTime,
        errors,
      };
    }
  } else {
    logger.info("No type or route files found — skipping transform");
  }

  // Step 4: Fire emit hook — plugins can add their own outputs
  await pipeline.hooks.emit.call(outputs, buildCtx);

  // Step 5: Run TypeScript compiler
  logger.step("compile", "Compiling TypeScript...");
  const compileResult = await runCompiler(options);

  if (!compileResult.success) {
    for (const buildErr of compileResult.errors) {
      const parts = [buildErr.message];
      if (buildErr.file) parts.unshift(`${buildErr.file}:${buildErr.line ?? 0}`);
      if (buildErr.errorType) parts.push(`(${buildErr.errorType})`);
      const formatted = parts.join(" — ");
      logger.error(formatted);
      errors.push(formatted);
    }

    return {
      success: false,
      outputs,
      duration: Date.now() - startTime,
      errors,
    };
  }

  logger.success("Compilation complete");

  const duration = Date.now() - startTime;
  logger.success(`Build finished in ${duration}ms`);

  const buildResult: BuildResult = {
    success: true,
    outputs,
    duration,
    errors: [],
  };

  // Step 6: Fire done hook
  await pipeline.hooks.done.call(buildResult);

  return {
    ...buildResult,
    pipeline,
  };
}
