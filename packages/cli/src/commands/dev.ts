// @typokit/cli — Dev Command
// Starts build pipeline in watch mode + development server with hot reload

import type { CliLogger } from "../logger.js";
import type { TypoKitConfig } from "../config.js";
import type { BuildResult, GeneratedOutput } from "@typokit/types";

export interface DevCommandOptions {
  /** Project root directory */
  rootDir: string;
  /** Resolved configuration */
  config: Required<TypoKitConfig>;
  /** Logger instance */
  logger: CliLogger;
  /** Whether verbose mode is enabled */
  verbose: boolean;
  /** Debug sidecar port (default: 9800) */
  debugPort: number;
}

/** Tracked file with mtime for change detection */
interface TrackedFile {
  path: string;
  mtime: number;
}

/** Dependency graph entry: maps a file to the outputs it affects */
interface DepGraphEntry {
  /** Files that depend on this source file */
  affectedOutputs: string[];
  /** Category: "type" or "route" */
  category: "type" | "route";
}

/** In-memory AST cache entry */
interface CacheEntry {
  mtime: number;
  hash: string;
}

/** Dev server state */
export interface DevServerState {
  /** Whether the server is running */
  running: boolean;
  /** File watcher cleanup function */
  stopWatcher: (() => void) | null;
  /** Tracked files with mtimes */
  trackedFiles: Map<string, TrackedFile>;
  /** Dependency graph: source → affected outputs */
  depGraph: Map<string, DepGraphEntry>;
  /** AST cache: file path → cache entry */
  astCache: Map<string, CacheEntry>;
  /** Rebuild count */
  rebuildCount: number;
  /** Last rebuild duration in ms */
  lastRebuildMs: number;
  /** Server child process PID */
  serverPid: number | null;
}

/**
 * Create initial dev server state.
 */
export function createDevState(): DevServerState {
  return {
    running: false,
    stopWatcher: null,
    trackedFiles: new Map(),
    depGraph: new Map(),
    astCache: new Map(),
    rebuildCount: 0,
    lastRebuildMs: 0,
    serverPid: null,
  };
}

/**
 * Resolve glob patterns to actual file paths with their mtimes.
 */
async function resolveFilesWithMtime(
  rootDir: string,
  patterns: string[],
): Promise<TrackedFile[]> {
  const { join, resolve } = await import(/* @vite-ignore */ "path") as {
    join: (...args: string[]) => string;
    resolve: (...args: string[]) => string;
  };
  const { readdirSync, statSync, existsSync } = await import(/* @vite-ignore */ "fs") as {
    readdirSync: (p: string) => string[];
    statSync: (p: string) => { isFile(): boolean; isDirectory(): boolean; mtimeMs: number };
    existsSync: (p: string) => boolean;
  };

  const files: TrackedFile[] = [];

  for (const pattern of patterns) {
    if (pattern.includes("*")) {
      const parts = pattern.split("/");
      const hasDoubleGlob = parts.includes("**");
      const lastPart = parts[parts.length - 1];

      const baseParts: string[] = [];
      for (const part of parts) {
        if (part.includes("*")) break;
        baseParts.push(part);
      }
      const baseDir = baseParts.length > 0 ? join(rootDir, ...baseParts) : rootDir;

      if (!existsSync(baseDir)) continue;

      const entries = hasDoubleGlob
        ? listFilesRecursive(baseDir, existsSync, readdirSync, statSync, join)
        : readdirSync(baseDir).map(f => join(baseDir, f));

      const filePattern = lastPart.replace(/\*/g, ".*");
      const regex = new RegExp(`^${filePattern}$`);

      for (const entry of entries) {
        const name = entry.split(/[\\/]/).pop() ?? "";
        if (regex.test(name)) {
          const fullPath = resolve(entry);
          try {
            const stat = statSync(fullPath);
            if (stat.isFile()) {
              files.push({ path: fullPath, mtime: stat.mtimeMs });
            }
          } catch {
            // Skip files that can't be stat'd
          }
        }
      }
    } else {
      const fullPath = resolve(join(rootDir, pattern));
      if (existsSync(fullPath)) {
        try {
          const stat = statSync(fullPath);
          if (stat.isFile()) {
            files.push({ path: fullPath, mtime: stat.mtimeMs });
          }
        } catch {
          // Skip
        }
      }
    }
  }

  // Deduplicate by path
  const seen = new Set<string>();
  return files.filter(f => {
    if (seen.has(f.path)) return false;
    seen.add(f.path);
    return true;
  }).sort((a, b) => a.path.localeCompare(b.path));
}

function listFilesRecursive(
  dir: string,
  existsSync: (p: string) => boolean,
  readdirSync: (p: string) => string[],
  statSync: (p: string) => { isFile(): boolean; isDirectory(): boolean; mtimeMs: number },
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
      // Skip
    }
  }
  return results;
}

/**
 * Detect which files have changed since last check.
 */
export function detectChangedFiles(
  state: DevServerState,
  currentFiles: TrackedFile[],
): { changed: TrackedFile[]; added: TrackedFile[]; removed: string[] } {
  const changed: TrackedFile[] = [];
  const added: TrackedFile[] = [];
  const removed: string[] = [];

  const currentPaths = new Set(currentFiles.map(f => f.path));

  // Check for changed and added files
  for (const file of currentFiles) {
    const tracked = state.trackedFiles.get(file.path);
    if (!tracked) {
      added.push(file);
    } else if (file.mtime > tracked.mtime) {
      changed.push(file);
    }
  }

  // Check for removed files
  for (const path of state.trackedFiles.keys()) {
    if (!currentPaths.has(path)) {
      removed.push(path);
    }
  }

  return { changed, added, removed };
}

/**
 * Update the tracked files in state.
 */
export function updateTrackedFiles(
  state: DevServerState,
  files: TrackedFile[],
): void {
  state.trackedFiles.clear();
  for (const file of files) {
    state.trackedFiles.set(file.path, file);
  }
}

/**
 * Build the dependency graph from type and route files.
 * Maps each source file to the outputs it affects.
 */
export function buildDepGraph(
  typeFiles: string[],
  routeFiles: string[],
): Map<string, DepGraphEntry> {
  const graph = new Map<string, DepGraphEntry>();

  for (const file of typeFiles) {
    graph.set(file, {
      category: "type",
      affectedOutputs: [
        "validators",
        "schemas/openapi.json",
      ],
    });
  }

  for (const file of routeFiles) {
    graph.set(file, {
      category: "route",
      affectedOutputs: [
        "routes/compiled-router.ts",
        "schemas/openapi.json",
        "tests/contract.test.ts",
      ],
    });
  }

  return graph;
}

/**
 * Determine which outputs need regeneration based on changed files.
 */
export function getAffectedOutputs(
  depGraph: Map<string, DepGraphEntry>,
  changedFiles: string[],
): Set<string> {
  const affected = new Set<string>();

  for (const file of changedFiles) {
    const entry = depGraph.get(file);
    if (entry) {
      for (const output of entry.affectedOutputs) {
        affected.add(output);
      }
    }
  }

  return affected;
}

/**
 * Check if a file's AST cache is still valid.
 */
export function isCacheValid(
  cache: Map<string, CacheEntry>,
  filePath: string,
  currentMtime: number,
): boolean {
  const entry = cache.get(filePath);
  if (!entry) return false;
  return entry.mtime === currentMtime;
}

/**
 * Update the AST cache for a file.
 */
export function updateCache(
  cache: Map<string, CacheEntry>,
  filePath: string,
  mtime: number,
): void {
  cache.set(filePath, {
    mtime,
    hash: `${filePath}:${mtime}`,
  });
}

/**
 * Run an incremental rebuild for changed files only.
 * Returns the files that were actually re-processed.
 */
export async function incrementalRebuild(
  options: DevCommandOptions,
  state: DevServerState,
  changedPaths: string[],
): Promise<{ success: boolean; duration: number; filesProcessed: number }> {
  const startTime = Date.now();
  const { config, logger, verbose } = options;

  // Determine affected outputs
  const affected = getAffectedOutputs(state.depGraph, changedPaths);
  if (affected.size === 0) {
    logger.verbose("No affected outputs — skipping rebuild");
    return { success: true, duration: 0, filesProcessed: 0 };
  }

  if (verbose) {
    logger.verbose(`Affected outputs: ${[...affected].join(", ")}`);
  }

  // Filter to only changed files that aren't cache-valid
  const filesToProcess: string[] = [];
  for (const path of changedPaths) {
    const tracked = state.trackedFiles.get(path);
    if (tracked && !isCacheValid(state.astCache, path, tracked.mtime)) {
      filesToProcess.push(path);
    }
  }

  if (filesToProcess.length === 0) {
    logger.verbose("All changed files still cached — skipping rebuild");
    return { success: true, duration: 0, filesProcessed: 0 };
  }

  logger.step("rebuild", `Incremental rebuild: ${filesToProcess.length} file(s) changed`);

  try {
    // Re-run the native transform pipeline with all files
    // (the pipeline is fast enough, and the Rust side handles caching)
    const allTypeFiles = [...state.depGraph.entries()]
      .filter(([, e]) => e.category === "type")
      .map(([p]) => p);
    const allRouteFiles = [...state.depGraph.entries()]
      .filter(([, e]) => e.category === "route")
      .map(([p]) => p);

    const { buildPipeline } = await import(
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

    const result = await buildPipeline({
      typeFiles: allTypeFiles,
      routeFiles: allRouteFiles,
      outputDir: config.outputDir,
    });

    // Update AST cache for processed files
    for (const path of filesToProcess) {
      const tracked = state.trackedFiles.get(path);
      if (tracked) {
        updateCache(state.astCache, path, tracked.mtime);
      }
    }

    const duration = Date.now() - startTime;
    state.lastRebuildMs = duration;
    state.rebuildCount++;

    if (result.regenerated) {
      logger.success(`Rebuild complete in ${duration}ms — ${result.filesWritten.length} files written`);
    } else {
      logger.success(`Rebuild complete in ${duration}ms — cache hit`);
    }

    return { success: true, duration, filesProcessed: filesToProcess.length };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Rebuild failed: ${message}`);
    const duration = Date.now() - startTime;
    return { success: false, duration, filesProcessed: filesToProcess.length };
  }
}

/**
 * Start file watching using fs.watch (recursive where supported).
 * Falls back to polling on platforms that don't support recursive.
 */
async function startFileWatcher(
  options: DevCommandOptions,
  state: DevServerState,
  onChanges: (changedPaths: string[]) => void,
): Promise<() => void> {
  const { rootDir, config, logger, verbose } = options;

  // Collect directories to watch based on config patterns
  const watchDirs = new Set<string>();
  const { join } = await import(/* @vite-ignore */ "path") as {
    join: (...args: string[]) => string;
  };
  const { existsSync } = await import(/* @vite-ignore */ "fs") as {
    existsSync: (p: string) => boolean;
  };

  // Watch the src directory by default
  const srcDir = join(rootDir, "src");
  if (existsSync(srcDir)) {
    watchDirs.add(srcDir);
  } else {
    watchDirs.add(rootDir);
  }

  if (verbose) {
    logger.verbose(`Watching directories: ${[...watchDirs].join(", ")}`);
  }

  // Debounce timer to batch rapid changes
  const g = globalThis as unknown as {
    setTimeout: (fn: () => void, ms: number) => number;
    clearTimeout: (id: number) => void;
  };
  let debounceTimer: number | null = null;
  const pendingChanges = new Set<string>();
  const DEBOUNCE_MS = 50;

  const watchers: Array<{ close(): void }> = [];

  try {
    const fs = await import(/* @vite-ignore */ "fs") as {
      watch: (path: string, options: { recursive?: boolean }, listener: (event: string, filename: string | null) => void) => { close(): void };
    };

    for (const dir of watchDirs) {
      const watcher = fs.watch(dir, { recursive: true }, (_event: string, filename: string | null) => {
        if (!filename) return;

        const fullPath = join(dir, filename);

        // Only track .ts files matching our patterns
        if (!fullPath.endsWith(".ts")) return;

        // Check if this file is in our tracked set
        if (state.trackedFiles.has(fullPath) || state.depGraph.has(fullPath)) {
          pendingChanges.add(fullPath);
        } else {
          // Could be a new file matching our patterns — add it
          const isTypePattern = config.typeFiles.some(p =>
            matchesGlobPattern(fullPath, rootDir, p));
          const isRoutePattern = config.routeFiles.some(p =>
            matchesGlobPattern(fullPath, rootDir, p));
          if (isTypePattern || isRoutePattern) {
            pendingChanges.add(fullPath);
          }
        }

        // Debounce
        if (debounceTimer) {
          g.clearTimeout(debounceTimer);
        }
        debounceTimer = g.setTimeout(() => {
          const changes = [...pendingChanges];
          pendingChanges.clear();
          if (changes.length > 0) {
            onChanges(changes);
          }
        }, DEBOUNCE_MS);
      });

      watchers.push(watcher);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`fs.watch failed: ${message} — falling back to polling`);
    // Polling fallback
    const gTimer = globalThis as unknown as {
      setInterval: (fn: () => void, ms: number) => number;
      clearInterval: (id: number) => void;
    };
    const POLL_INTERVAL = 500;
    const pollTimer = gTimer.setInterval(async () => {
      const typeFiles = await resolveFilesWithMtime(rootDir, config.typeFiles);
      const routeFiles = await resolveFilesWithMtime(rootDir, config.routeFiles);
      const allFiles = [...typeFiles, ...routeFiles];

      const { changed, added, removed } = detectChangedFiles(state, allFiles);
      const changedPaths = [
        ...changed.map(f => f.path),
        ...added.map(f => f.path),
        ...removed,
      ];

      if (changedPaths.length > 0) {
        updateTrackedFiles(state, allFiles);
        onChanges(changedPaths);
      }
    }, POLL_INTERVAL);

    return () => {
      gTimer.clearInterval(pollTimer);
    };
  }

  logger.step("watch", `File watcher started`);

  return () => {
    for (const watcher of watchers) {
      watcher.close();
    }
    if (debounceTimer) {
      g.clearTimeout(debounceTimer);
    }
  };
}

/**
 * Simple glob pattern matching for a file against a pattern.
 */
function matchesGlobPattern(filePath: string, rootDir: string, pattern: string): boolean {
  // Normalize separators
  const normalized = filePath.replace(/\\/g, "/");
  const normalizedRoot = rootDir.replace(/\\/g, "/");

  // Get relative path
  let relative = normalized;
  if (normalized.startsWith(normalizedRoot)) {
    relative = normalized.slice(normalizedRoot.length).replace(/^\//, "");
  }

  // Convert glob to regex
  const regexStr = pattern
    .replace(/\*\*/g, "___DOUBLESTAR___")
    .replace(/\*/g, "[^/]*")
    .replace(/___DOUBLESTAR___/g, ".*");

  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(relative);
}

/**
 * Execute the dev command.
 *
 * 1. Run initial full build
 * 2. Start file watcher for incremental rebuilds
 * 3. Start the development server (delegates to server adapter)
 * 4. Handle graceful shutdown
 */
export async function executeDev(
  options: DevCommandOptions,
): Promise<{ state: DevServerState; stop: () => void }> {
  const { config, rootDir, logger, verbose, debugPort } = options;

  logger.step("dev", "Starting development mode...");
  if (verbose) {
    logger.verbose(`Debug port: ${debugPort}`);
    logger.verbose(`Root: ${rootDir}`);
  }

  const state = createDevState();

  // Step 1: Resolve all source files
  logger.step("dev", "Resolving source files...");
  const typeFiles = await resolveFilesWithMtime(rootDir, config.typeFiles);
  const routeFiles = await resolveFilesWithMtime(rootDir, config.routeFiles);
  const allFiles = [...typeFiles, ...routeFiles];

  logger.step("dev", `Found ${typeFiles.length} type file(s), ${routeFiles.length} route file(s)`);

  // Initialize tracked files
  updateTrackedFiles(state, allFiles);

  // Build dependency graph
  state.depGraph = buildDepGraph(
    typeFiles.map(f => f.path),
    routeFiles.map(f => f.path),
  );

  // Step 2: Run initial full build
  logger.step("dev", "Running initial build...");
  const initialBuild = await runFullBuild(options, state);

  if (!initialBuild.success) {
    logger.error("Initial build failed — watching for changes to retry...");
  } else {
    logger.success(`Initial build complete in ${initialBuild.duration}ms`);
  }

  // Step 3: Start file watcher
  state.running = true;

  const stopWatcher = await startFileWatcher(options, state, async (changedPaths: string[]) => {
    if (!state.running) return;

    const fileNames = changedPaths.map(p => p.split(/[\\/]/).pop()).join(", ");
    logger.step("change", `Detected: ${fileNames}`);

    // Re-resolve files to get updated mtimes
    const updatedTypeFiles = await resolveFilesWithMtime(rootDir, config.typeFiles);
    const updatedRouteFiles = await resolveFilesWithMtime(rootDir, config.routeFiles);
    const updatedFiles = [...updatedTypeFiles, ...updatedRouteFiles];

    // Update tracked files and dep graph
    updateTrackedFiles(state, updatedFiles);
    state.depGraph = buildDepGraph(
      updatedTypeFiles.map(f => f.path),
      updatedRouteFiles.map(f => f.path),
    );

    // Incremental rebuild
    const result = await incrementalRebuild(options, state, changedPaths);

    if (result.success) {
      logger.step("ready", `Server ready — rebuild #${state.rebuildCount} (${result.duration}ms)`);
    }
  });

  state.stopWatcher = stopWatcher;

  // Step 4: Setup graceful shutdown
  const stop = (): void => {
    if (!state.running) return;
    state.running = false;

    logger.step("dev", "Shutting down...");

    if (state.stopWatcher) {
      state.stopWatcher();
      state.stopWatcher = null;
    }

    logger.step("dev", "Dev server stopped");
  };

  // Register signal handlers for graceful shutdown
  const g = globalThis as Record<string, unknown>;
  const proc = g["process"] as {
    on(event: string, handler: () => void): void;
    removeListener(event: string, handler: () => void): void;
  } | undefined;

  const sigintHandler = (): void => stop();
  const sigtermHandler = (): void => stop();

  if (proc) {
    proc.on("SIGINT", sigintHandler);
    proc.on("SIGTERM", sigtermHandler);
  }

  logger.success("Dev mode active — watching for changes (Ctrl+C to stop)");
  logger.step("dev", `Debug sidecar port: ${debugPort}`);

  return { state, stop };
}

/**
 * Run a full build (used for initial build in dev mode).
 */
async function runFullBuild(
  options: DevCommandOptions,
  state: DevServerState,
): Promise<BuildResult> {
  const startTime = Date.now();
  const { config, logger, verbose } = options;
  const outputs: GeneratedOutput[] = [];
  const errors: string[] = [];

  const typeFiles = [...state.depGraph.entries()]
    .filter(([, e]) => e.category === "type")
    .map(([p]) => p);
  const routeFiles = [...state.depGraph.entries()]
    .filter(([, e]) => e.category === "route")
    .map(([p]) => p);

  if (typeFiles.length > 0 || routeFiles.length > 0) {
    try {
      const { buildPipeline } = await import(
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

      const result = await buildPipeline({
        typeFiles,
        routeFiles,
        outputDir: config.outputDir,
      });

      if (result.regenerated) {
        for (const f of result.filesWritten) {
          outputs.push({ filePath: f, content: "", overwrite: true });
        }
      }

      // Initialize AST cache for all files
      for (const [path, tracked] of state.trackedFiles) {
        updateCache(state.astCache, path, tracked.mtime);
      }

      if (verbose) {
        logger.verbose(`Content hash: ${result.contentHash}`);
      }
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
  }

  const duration = Date.now() - startTime;
  state.rebuildCount++;
  state.lastRebuildMs = duration;

  return {
    success: true,
    outputs,
    duration,
    errors: [],
  };
}
