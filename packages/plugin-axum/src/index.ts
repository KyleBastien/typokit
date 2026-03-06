// @typokit/plugin-axum — Axum Server Code Generation Plugin

import type {
  TypoKitPlugin,
  BuildPipeline,
} from "@typokit/core";
import type {
  CompileContext,
  GeneratedOutput,
} from "@typokit/types";

// ─── Native Binding Types ────────────────────────────────────

interface JsRustGeneratedOutput {
  path: string;
  content: string;
  overwrite: boolean;
}

interface NativeBindings {
  generateRustCodegen(
    typeFilePaths: string[],
    routeFilePaths: string[],
  ): JsRustGeneratedOutput[];
  computeContentHash(filePaths: string[]): string;
}

// ─── Native Addon Loader ─────────────────────────────────────

async function loadNativeAddon(): Promise<NativeBindings> {
  const g = globalThis as Record<string, unknown>;
  const proc = g["process"] as { platform: string; arch: string } | undefined;
  const platform = proc?.platform ?? "unknown";
  const arch = proc?.arch ?? "unknown";

  const triples: Record<string, Record<string, string>> = {
    win32: { x64: "win32-x64-msvc" },
    darwin: { x64: "darwin-x64", arm64: "darwin-arm64" },
    linux: { x64: "linux-x64-gnu", arm64: "linux-arm64-gnu" },
  };

  const triple = triples[platform]?.[arch];
  if (!triple) {
    throw new Error(
      `@typokit/plugin-axum: unsupported platform ${platform}-${arch}`,
    );
  }

  const { createRequire } = (await import(/* @vite-ignore */ "module")) as {
    createRequire: (url: string) => (id: string) => unknown;
  };
  const req = createRequire(import.meta.url);

  try {
    return req(`../index.${triple}.node`) as NativeBindings;
  } catch {
    try {
      return req(`@typokit/plugin-axum-${triple}`) as NativeBindings;
    } catch {
      throw new Error(
        `@typokit/plugin-axum: failed to load native addon for ${triple}. ` +
          `Make sure the native addon is built.`,
      );
    }
  }
}

let _native: NativeBindings | undefined;
let _loading: Promise<NativeBindings> | undefined;

async function getNative(): Promise<NativeBindings> {
  if (_native) return _native;
  if (!_loading) {
    _loading = loadNativeAddon().then((n) => {
      _native = n;
      return n;
    });
  }
  return _loading;
}

// ─── Plugin Options ──────────────────────────────────────────

/** Configuration options for the Axum code generation plugin */
export interface AxumPluginOptions {
  /** Database adapter (currently only 'sqlx' is supported, default: 'sqlx') */
  db?: string;
  /** Output directory for the generated Rust project (default: project root) */
  outDir?: string;
  /** Path to cache hash file (defaults to ".typokit/.cache-hash" within outDir) */
  cacheFile?: string;
}

// ─── Plugin Factory ──────────────────────────────────────────

/**
 * Create an Axum server code generation plugin.
 *
 * Generates a complete Axum server (structs, router, sqlx DB layer, handlers,
 * services, middleware, and project scaffold) from TypeScript schema types
 * and route contracts during the build pipeline.
 *
 * @example
 * ```typescript
 * import { axumPlugin } from '@typokit/plugin-axum';
 *
 * export default {
 *   plugins: [axumPlugin({ db: 'sqlx' })],
 * };
 * ```
 */
export function axumPlugin(options: AxumPluginOptions = {}): TypoKitPlugin {
  const { db = "sqlx", outDir, cacheFile } = options;

  if (db !== "sqlx") {
    throw new Error(
      `@typokit/plugin-axum: unsupported database adapter '${db}'. Only 'sqlx' is currently supported.`,
    );
  }

  return {
    name: "plugin-axum",

    onBuild(pipeline: BuildPipeline) {
      // Tap the emit hook to generate Rust code from the parsed schemas
      pipeline.hooks.emit.tap("plugin-axum", async (outputs, ctx) => {
        const { join, dirname } = (await import(/* @vite-ignore */ "path")) as {
          join: (...args: string[]) => string;
          dirname: (p: string) => string;
        };
        const nodeFs = (await import(/* @vite-ignore */ "fs")) as {
          existsSync: (p: string) => boolean;
          mkdirSync: (p: string, opts?: { recursive?: boolean }) => void;
          readFileSync: (p: string, encoding: string) => string;
          writeFileSync: (p: string, data: string, encoding?: string) => void;
        };
        const { readdirSync, statSync } = nodeFs as unknown as {
          readdirSync: (p: string) => string[];
          statSync: (p: string) => { isFile(): boolean; isDirectory(): boolean };
        };

        const native = await getNative();
        const resolvedOutDir = outDir ?? ctx.rootDir;
        const resolvedCacheFile =
          cacheFile ?? join(resolvedOutDir, ".typokit", ".cache-hash");

        // Resolve type and route files from the build context
        const typeFiles = resolveTypeFiles(ctx.rootDir, nodeFs as any, join);
        const routeFiles = resolveRouteFiles(ctx.rootDir, nodeFs as any, join);

        if (typeFiles.length === 0 && routeFiles.length === 0) {
          return;
        }

        // Check content hash cache
        const allPaths = [...typeFiles, ...routeFiles];
        const contentHash = native.computeContentHash(allPaths);

        if (nodeFs.existsSync(resolvedCacheFile)) {
          const cachedHash = nodeFs.readFileSync(resolvedCacheFile, "utf-8").trim();
          if (cachedHash === contentHash) {
            return;
          }
        }

        // Generate Rust codegen outputs
        const rustOutputs = native.generateRustCodegen(typeFiles, routeFiles);

        // Write generated files
        for (const output of rustOutputs) {
          const fullPath = join(resolvedOutDir, output.path);
          const dir = dirname(fullPath);
          nodeFs.mkdirSync(dir, { recursive: true });

          // Respect overwrite flag: skip existing files when overwrite is false
          if (!output.overwrite && nodeFs.existsSync(fullPath)) {
            continue;
          }

          nodeFs.writeFileSync(fullPath, output.content, "utf-8");
          outputs.push({
            filePath: fullPath,
            content: output.content,
            overwrite: output.overwrite,
          });
        }

        // Write cache hash
        nodeFs.mkdirSync(dirname(resolvedCacheFile), { recursive: true });
        nodeFs.writeFileSync(resolvedCacheFile, contentHash, "utf-8");
      });

      // Tap the compile hook to run cargo build instead of the TypeScript compiler
      pipeline.hooks.compile.tap("plugin-axum", async (compileCtx: CompileContext, ctx) => {
        const { spawnSync } = (await import(/* @vite-ignore */ "child_process")) as {
          spawnSync: (
            cmd: string,
            args: string[],
            opts: { cwd?: string; encoding?: string },
          ) => {
            status: number | null;
            stdout: string;
            stderr: string;
            error?: Error;
          };
        };

        const resolvedOutDir = outDir ?? ctx.rootDir;
        const result = spawnSync("cargo", ["build"], {
          cwd: resolvedOutDir,
          encoding: "utf-8",
        });

        compileCtx.handled = true;
        compileCtx.compiler = "cargo";

        if (result.error) {
          compileCtx.result = {
            success: false,
            errors: [result.error.message],
          };
          return;
        }

        if (result.status !== 0) {
          const errorOutput = result.stderr || result.stdout || "cargo build failed";
          compileCtx.result = {
            success: false,
            errors: [errorOutput.trim()],
          };
          return;
        }

        compileCtx.result = { success: true, errors: [] };
      });
    },
  };
}

// ─── File Resolution Helpers ─────────────────────────────────

/**
 * Resolve TypeScript type definition files from the project root.
 * Looks for files matching common TypoKit type patterns.
 */
function resolveTypeFiles(
  rootDir: string,
  fs: {
    existsSync: (p: string) => boolean;
    readdirSync: (p: string) => string[];
    statSync: (p: string) => { isFile(): boolean; isDirectory(): boolean };
  },
  join: (...args: string[]) => string,
): string[] {
  return resolvePatternFiles(rootDir, "types", fs, join);
}

/**
 * Resolve TypeScript route contract files from the project root.
 * Looks for files matching common TypoKit route patterns.
 */
function resolveRouteFiles(
  rootDir: string,
  fs: {
    existsSync: (p: string) => boolean;
    readdirSync: (p: string) => string[];
    statSync: (p: string) => { isFile(): boolean; isDirectory(): boolean };
  },
  join: (...args: string[]) => string,
): string[] {
  return resolvePatternFiles(rootDir, "routes", fs, join);
}

/**
 * Resolve files from a subdirectory matching .ts extension.
 */
function resolvePatternFiles(
  rootDir: string,
  subDir: string,
  fs: {
    existsSync: (p: string) => boolean;
    readdirSync: (p: string) => string[];
    statSync: (p: string) => { isFile(): boolean; isDirectory(): boolean };
  },
  join: (...args: string[]) => string,
): string[] {
  const dir = join(rootDir, subDir);
  if (!fs.existsSync(dir)) return [];

  const results: string[] = [];
  const entries = fs.readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    try {
      const stat = fs.statSync(fullPath);
      if (stat.isFile() && entry.endsWith(".ts")) {
        results.push(fullPath);
      }
    } catch {
      // Skip files that can't be stat'd
    }
  }
  return results.sort();
}
