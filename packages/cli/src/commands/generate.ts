// @typokit/cli — Generate Commands

import type { CliLogger } from "../logger.js";
import type { TypoKitConfig } from "../config.js";

export interface GenerateCommandOptions {
  /** Project root directory */
  rootDir: string;
  /** Resolved configuration */
  config: Required<TypoKitConfig>;
  /** Logger instance */
  logger: CliLogger;
  /** Generate subcommand: db, client, openapi, tests */
  subcommand: string;
  /** CLI flags */
  flags: Record<string, string | boolean>;
  /** Whether verbose mode is enabled */
  verbose: boolean;
}

export interface GenerateResult {
  /** Whether the command succeeded */
  success: boolean;
  /** Files generated or updated */
  filesWritten: string[];
  /** Duration in milliseconds */
  duration: number;
  /** Errors encountered */
  errors: string[];
}

/**
 * Resolve glob patterns to actual file paths.
 * Reuses the same approach as build.ts.
 */
async function resolveFilePatterns(
  rootDir: string,
  patterns: string[],
): Promise<string[]> {
  const { join, resolve } = (await import(/* @vite-ignore */ "path")) as {
    join: (...args: string[]) => string;
    resolve: (...args: string[]) => string;
  };
  const { readdirSync, statSync, existsSync } = (await import(
    /* @vite-ignore */ "fs"
  )) as {
    readdirSync: (p: string) => string[];
    statSync: (p: string) => { isFile(): boolean; isDirectory(): boolean };
    existsSync: (p: string) => boolean;
  };

  const files: string[] = [];

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
      const baseDir =
        baseParts.length > 0 ? join(rootDir, ...baseParts) : rootDir;

      if (!existsSync(baseDir)) continue;

      const entries = hasDoubleGlob
        ? listFilesRecursive(baseDir, existsSync, readdirSync, statSync, join)
        : readdirSync(baseDir).map((f) => join(baseDir, f));

      const filePattern = lastPart.replace(/\*/g, ".*");
      const regex = new RegExp(`^${filePattern}$`);

      for (const entry of entries) {
        const name = entry.split(/[\\/]/).pop() ?? "";
        if (regex.test(name)) {
          files.push(resolve(entry));
        }
      }
    } else {
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
        if (
          entry !== "node_modules" &&
          entry !== "dist" &&
          entry !== ".typokit"
        ) {
          results.push(
            ...listFilesRecursive(
              fullPath,
              existsSync,
              readdirSync,
              statSync,
              join,
            ),
          );
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
 * Generate database schema artifacts using the configured database adapter.
 *
 * Resolves type files, extracts type metadata, and calls the database adapter's
 * generate() method. If no adapter is configured, reports a helpful error.
 */
async function generateDb(
  options: GenerateCommandOptions,
): Promise<GenerateResult> {
  const startTime = Date.now();
  const { config, rootDir, logger, verbose } = options;
  const filesWritten: string[] = [];
  const errors: string[] = [];

  logger.step("generate:db", "Resolving type files...");
  const typeFiles = await resolveFilePatterns(rootDir, config.typeFiles);

  if (typeFiles.length === 0) {
    logger.warn("No type files found matching configured patterns");
    return {
      success: true,
      filesWritten,
      duration: Date.now() - startTime,
      errors,
    };
  }

  if (verbose) {
    logger.verbose(`Type files: ${typeFiles.length} found`);
    for (const f of typeFiles) logger.verbose(`  ${f}`);
  }

  // Extract types using transform-native
  logger.step("generate:db", "Extracting type metadata...");
  try {
    const { parseAndExtractTypes } = (await import(
      /* @vite-ignore */ "@typokit/transform-native"
    )) as {
      parseAndExtractTypes: (files: string[]) => Promise<
        Record<
          string,
          {
            name: string;
            properties: Record<string, { type: string; optional: boolean }>;
          }
        >
      >;
    };

    const types = await parseAndExtractTypes(typeFiles);
    const typeCount = Object.keys(types).length;

    if (typeCount === 0) {
      logger.warn("No types extracted from source files");
      return {
        success: true,
        filesWritten,
        duration: Date.now() - startTime,
        errors,
      };
    }

    logger.step("generate:db", `Extracted ${typeCount} types`);

    // Generate schema artifacts using diffSchemas (generates DDL from types)
    const { diffSchemas } = (await import(
      /* @vite-ignore */ "@typokit/transform-native"
    )) as {
      diffSchemas: (
        oldTypes: Record<string, unknown>,
        newTypes: Record<string, unknown>,
        name: string,
      ) => Promise<{
        name: string;
        sql: string;
        destructive: boolean;
        changes: unknown[];
      }>;
    };

    const { join } = (await import(/* @vite-ignore */ "path")) as {
      join: (...args: string[]) => string;
    };
    const nodeFs = (await import(/* @vite-ignore */ "fs")) as {
      mkdirSync: (p: string, opts?: { recursive?: boolean }) => void;
      writeFileSync: (p: string, data: string, encoding?: string) => void;
    };

    // Diff empty schema against current types to generate full DDL
    const migration = await diffSchemas({}, types, "initial");
    const outputDir = join(rootDir, config.outputDir);
    const schemaDir = join(outputDir, "schemas");
    nodeFs.mkdirSync(schemaDir, { recursive: true });

    // Write migration SQL
    const sqlPath = join(schemaDir, "schema.sql");
    nodeFs.writeFileSync(sqlPath, migration.sql, "utf-8");
    filesWritten.push(sqlPath);
    logger.success(`Generated ${sqlPath}`);

    // Write schema metadata as JSON
    const metaPath = join(schemaDir, "schema-types.json");
    const metaJson = JSON.stringify(types, null, 2);
    nodeFs.writeFileSync(metaPath, metaJson, "utf-8");
    filesWritten.push(metaPath);
    logger.success(`Generated ${metaPath}`);

    if (verbose) {
      logger.verbose(`Migration: ${migration.name}`);
      logger.verbose(`Destructive: ${migration.destructive}`);
      logger.verbose(`Changes: ${(migration.changes as unknown[]).length}`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`generate:db failed: ${message}`);
    errors.push(message);
    return {
      success: false,
      filesWritten,
      duration: Date.now() - startTime,
      errors,
    };
  }

  const duration = Date.now() - startTime;
  logger.success(
    `generate:db complete — ${filesWritten.length} files written (${duration}ms)`,
  );
  return { success: true, filesWritten, duration, errors };
}

/**
 * Generate a type-safe API client from route contracts.
 *
 * Reads compiled routes from the .typokit/ directory and generates
 * a TypeScript client module.
 */
async function generateClient(
  options: GenerateCommandOptions,
): Promise<GenerateResult> {
  const startTime = Date.now();
  const { config, rootDir, logger, verbose } = options;
  const filesWritten: string[] = [];
  const errors: string[] = [];

  logger.step("generate:client", "Resolving route files...");
  const routeFiles = await resolveFilePatterns(rootDir, config.routeFiles);

  if (routeFiles.length === 0) {
    logger.warn("No route files found matching configured patterns");
    return {
      success: true,
      filesWritten,
      duration: Date.now() - startTime,
      errors,
    };
  }

  if (verbose) {
    logger.verbose(`Route files: ${routeFiles.length} found`);
    for (const f of routeFiles) logger.verbose(`  ${f}`);
  }

  try {
    const { compileRoutes } = (await import(
      /* @vite-ignore */ "@typokit/transform-native"
    )) as {
      compileRoutes: (files: string[]) => Promise<string>;
    };

    const { join } = (await import(/* @vite-ignore */ "path")) as {
      join: (...args: string[]) => string;
    };
    const nodeFs = (await import(/* @vite-ignore */ "fs")) as {
      mkdirSync: (p: string, opts?: { recursive?: boolean }) => void;
      writeFileSync: (p: string, data: string, encoding?: string) => void;
      existsSync: (p: string) => boolean;
      readFileSync: (p: string, encoding: string) => string;
    };

    logger.step("generate:client", "Compiling route contracts...");
    const compiledRoutes = await compileRoutes(routeFiles);

    const outputDir = join(rootDir, config.outputDir);
    const clientDir = join(outputDir, "client");
    nodeFs.mkdirSync(clientDir, { recursive: true });

    // Generate client code from compiled routes
    const clientCode = generateClientCode(compiledRoutes);

    const clientPath = join(clientDir, "index.ts");
    nodeFs.writeFileSync(clientPath, clientCode, "utf-8");
    filesWritten.push(clientPath);
    logger.success(`Generated ${clientPath}`);

    if (verbose) {
      logger.verbose(`Client code: ${clientCode.length} bytes`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`generate:client failed: ${message}`);
    errors.push(message);
    return {
      success: false,
      filesWritten,
      duration: Date.now() - startTime,
      errors,
    };
  }

  const duration = Date.now() - startTime;
  logger.success(
    `generate:client complete — ${filesWritten.length} files written (${duration}ms)`,
  );
  return { success: true, filesWritten, duration, errors };
}

/**
 * Generate a type-safe fetch client TypeScript module from compiled routes.
 */
function generateClientCode(compiledRoutes: string): string {
  const lines: string[] = [];
  lines.push("// Auto-generated by @typokit/cli — do not edit manually");
  lines.push("// Re-run `typokit generate:client` to regenerate");
  lines.push("");
  lines.push("export interface ClientOptions {");
  lines.push("  baseUrl: string;");
  lines.push("  headers?: Record<string, string>;");
  lines.push("  fetch?: typeof fetch;");
  lines.push("}");
  lines.push("");
  lines.push("export interface RequestOptions {");
  lines.push("  params?: Record<string, string>;");
  lines.push("  query?: Record<string, unknown>;");
  lines.push("  body?: unknown;");
  lines.push("  headers?: Record<string, string>;");
  lines.push("}");
  lines.push("");
  lines.push("export function createClient(options: ClientOptions) {");
  lines.push(
    "  const { baseUrl, headers: defaultHeaders, fetch: fetchFn = globalThis.fetch } = options;",
  );
  lines.push("");
  lines.push(
    "  async function request(method: string, path: string, opts?: RequestOptions) {",
  );
  lines.push("    let url = baseUrl + path;");
  lines.push("    if (opts?.params) {");
  lines.push("      for (const [key, value] of Object.entries(opts.params)) {");
  lines.push(
    "        url = url.replace(`:${key}`, encodeURIComponent(value));",
  );
  lines.push("      }");
  lines.push("    }");
  lines.push("    if (opts?.query) {");
  lines.push("      const qs = Object.entries(opts.query)");
  lines.push("        .filter(([, v]) => v !== undefined)");
  lines.push(
    "        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)",
  );
  lines.push('        .join("&");');
  lines.push('      if (qs) url += "?" + qs;');
  lines.push("    }");
  lines.push("    const res = await fetchFn(url, {");
  lines.push("      method,");
  lines.push("      headers: {");
  lines.push('        "Content-Type": "application/json",');
  lines.push("        ...defaultHeaders,");
  lines.push("        ...opts?.headers,");
  lines.push("      },");
  lines.push("      body: opts?.body ? JSON.stringify(opts.body) : undefined,");
  lines.push("    });");
  lines.push(
    "    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);",
  );
  lines.push("    return res.json();");
  lines.push("  }");
  lines.push("");
  lines.push("  return {");
  lines.push(
    '    get: (path: string, opts?: RequestOptions) => request("GET", path, opts),',
  );
  lines.push(
    '    post: (path: string, opts?: RequestOptions) => request("POST", path, opts),',
  );
  lines.push(
    '    put: (path: string, opts?: RequestOptions) => request("PUT", path, opts),',
  );
  lines.push(
    '    patch: (path: string, opts?: RequestOptions) => request("PATCH", path, opts),',
  );
  lines.push(
    '    delete: (path: string, opts?: RequestOptions) => request("DELETE", path, opts),',
  );
  lines.push("  };");
  lines.push("}");
  lines.push("");
  lines.push("// Compiled route information (for reference):");
  lines.push("// " + compiledRoutes.split("\n")[0]);
  lines.push("");
  return lines.join("\n");
}

/**
 * Generate OpenAPI 3.1 specification.
 * Supports --output <path> flag for custom output location.
 */
async function generateOpenapi(
  options: GenerateCommandOptions,
): Promise<GenerateResult> {
  const startTime = Date.now();
  const { config, rootDir, logger, verbose, flags } = options;
  const filesWritten: string[] = [];
  const errors: string[] = [];

  logger.step("generate:openapi", "Resolving source files...");
  const routeFiles = await resolveFilePatterns(rootDir, config.routeFiles);
  const typeFiles = await resolveFilePatterns(rootDir, config.typeFiles);

  if (routeFiles.length === 0) {
    logger.warn("No route files found matching configured patterns");
    return {
      success: true,
      filesWritten,
      duration: Date.now() - startTime,
      errors,
    };
  }

  if (verbose) {
    logger.verbose(`Route files: ${routeFiles.length} found`);
    logger.verbose(`Type files: ${typeFiles.length} found`);
  }

  try {
    const { generateOpenApi } = (await import(
      /* @vite-ignore */ "@typokit/transform-native"
    )) as {
      generateOpenApi: (
        routeFiles: string[],
        typeFiles: string[],
      ) => Promise<string>;
    };

    const { join, dirname } = (await import(/* @vite-ignore */ "path")) as {
      join: (...args: string[]) => string;
      dirname: (p: string) => string;
    };
    const nodeFs = (await import(/* @vite-ignore */ "fs")) as {
      mkdirSync: (p: string, opts?: { recursive?: boolean }) => void;
      writeFileSync: (p: string, data: string, encoding?: string) => void;
    };

    logger.step("generate:openapi", "Generating OpenAPI 3.1 specification...");
    const spec = await generateOpenApi(routeFiles, typeFiles);

    // Determine output path: --output flag or default
    const outputPath =
      typeof flags["output"] === "string"
        ? flags["output"]
        : join(rootDir, config.outputDir, "schemas", "openapi.json");

    const dir = dirname(outputPath);
    nodeFs.mkdirSync(dir, { recursive: true });
    nodeFs.writeFileSync(outputPath, spec, "utf-8");
    filesWritten.push(outputPath);
    logger.success(`Generated ${outputPath}`);

    if (verbose) {
      logger.verbose(`OpenAPI spec: ${spec.length} bytes`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`generate:openapi failed: ${message}`);
    errors.push(message);
    return {
      success: false,
      filesWritten,
      duration: Date.now() - startTime,
      errors,
    };
  }

  const duration = Date.now() - startTime;
  logger.success(
    `generate:openapi complete — ${filesWritten.length} files written (${duration}ms)`,
  );
  return { success: true, filesWritten, duration, errors };
}

/**
 * Regenerate contract tests from route schemas.
 */
async function generateTests(
  options: GenerateCommandOptions,
): Promise<GenerateResult> {
  const startTime = Date.now();
  const { config, rootDir, logger, verbose } = options;
  const filesWritten: string[] = [];
  const errors: string[] = [];

  logger.step("generate:tests", "Resolving route files...");
  const routeFiles = await resolveFilePatterns(rootDir, config.routeFiles);

  if (routeFiles.length === 0) {
    logger.warn("No route files found matching configured patterns");
    return {
      success: true,
      filesWritten,
      duration: Date.now() - startTime,
      errors,
    };
  }

  if (verbose) {
    logger.verbose(`Route files: ${routeFiles.length} found`);
    for (const f of routeFiles) logger.verbose(`  ${f}`);
  }

  try {
    const { generateTestStubs } = (await import(
      /* @vite-ignore */ "@typokit/transform-native"
    )) as {
      generateTestStubs: (files: string[]) => Promise<string>;
    };

    const { join } = (await import(/* @vite-ignore */ "path")) as {
      join: (...args: string[]) => string;
    };
    const nodeFs = (await import(/* @vite-ignore */ "fs")) as {
      mkdirSync: (p: string, opts?: { recursive?: boolean }) => void;
      writeFileSync: (p: string, data: string, encoding?: string) => void;
    };

    logger.step("generate:tests", "Generating contract test stubs...");
    const testCode = await generateTestStubs(routeFiles);

    const outputDir = join(rootDir, config.outputDir);
    const testsDir = join(outputDir, "tests");
    nodeFs.mkdirSync(testsDir, { recursive: true });

    const testsPath = join(testsDir, "contract.test.ts");
    nodeFs.writeFileSync(testsPath, testCode, "utf-8");
    filesWritten.push(testsPath);
    logger.success(`Generated ${testsPath}`);

    if (verbose) {
      logger.verbose(`Test stubs: ${testCode.length} bytes`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`generate:tests failed: ${message}`);
    errors.push(message);
    return {
      success: false,
      filesWritten,
      duration: Date.now() - startTime,
      errors,
    };
  }

  const duration = Date.now() - startTime;
  logger.success(
    `generate:tests complete — ${filesWritten.length} files written (${duration}ms)`,
  );
  return { success: true, filesWritten, duration, errors };
}

/**
 * Execute a generate subcommand.
 * Dispatches to the appropriate generator based on the subcommand.
 */
export async function executeGenerate(
  options: GenerateCommandOptions,
): Promise<GenerateResult> {
  const { subcommand, logger } = options;

  switch (subcommand) {
    case "db":
      return generateDb(options);
    case "client":
      return generateClient(options);
    case "openapi":
      return generateOpenapi(options);
    case "tests":
      return generateTests(options);
    default:
      logger.error(`Unknown generate subcommand: ${subcommand}`);
      logger.info("Available subcommands: db, client, openapi, tests");
      return {
        success: false,
        filesWritten: [],
        duration: 0,
        errors: [`Unknown generate subcommand: ${subcommand}`],
      };
  }
}

// Export individual generators for direct usage
export {
  generateDb,
  generateClient,
  generateOpenapi,
  generateTests,
  generateClientCode,
  resolveFilePatterns as resolveGenerateFilePatterns,
};
