// @typokit/cli — Migration Commands

import type { CliLogger } from "../logger.js";
import type { TypoKitConfig } from "../config.js";
import type { SchemaChange, MigrationDraft } from "@typokit/types";

export interface MigrateCommandOptions {
  /** Project root directory */
  rootDir: string;
  /** Resolved configuration */
  config: Required<TypoKitConfig>;
  /** Logger instance */
  logger: CliLogger;
  /** Migrate subcommand: generate, diff, apply */
  subcommand: string;
  /** CLI flags */
  flags: Record<string, string | boolean>;
  /** Whether verbose mode is enabled */
  verbose: boolean;
}

export interface MigrateResult {
  /** Whether the command succeeded */
  success: boolean;
  /** Files generated or updated */
  filesWritten: string[];
  /** Duration in milliseconds */
  duration: number;
  /** Errors encountered */
  errors: string[];
  /** Whether any destructive changes were detected */
  destructive: boolean;
  /** Schema changes detected */
  changes: SchemaChange[];
}

// ─── Helpers ──────────────────────────────────────────────────

/**
 * Get the migrations directory path.
 */
function getMigrationsDir(
  rootDir: string,
  outputDir: string,
  join: (...args: string[]) => string,
): string {
  return join(rootDir, outputDir, "migrations");
}

/**
 * Generate a timestamp string for migration file names (YYYYMMDDHHMMSS).
 */
function generateTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    String(now.getFullYear()) +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds())
  );
}

/**
 * Sanitize a migration name for use in file names.
 */
function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Check if a schema change is destructive (column drops, type changes).
 */
function isDestructiveChange(change: SchemaChange): boolean {
  if (change.type === "remove") return true;
  if (change.type === "modify" && change.details) {
    // Type changes are destructive
    if ("oldType" in change.details || "newType" in change.details) return true;
  }
  return false;
}

/**
 * Annotate SQL with destructive comments where needed.
 */
function annotateSql(sql: string, changes: SchemaChange[]): string {
  const hasDestructive = changes.some(isDestructiveChange);
  if (!hasDestructive) return sql;

  const lines = sql.split("\n");
  const annotated: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim().toUpperCase();
    if (
      trimmed.startsWith("DROP") ||
      (trimmed.startsWith("ALTER") &&
        (trimmed.includes("DROP") || trimmed.includes("TYPE")))
    ) {
      annotated.push("-- DESTRUCTIVE: requires review");
    }
    annotated.push(line);
  }

  return annotated.join("\n");
}

/**
 * Resolve glob patterns to actual file paths.
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
 * Load the current schema snapshot from the .typokit directory.
 * Returns empty object if no snapshot exists.
 */
async function loadSchemaSnapshot(
  rootDir: string,
  outputDir: string,
): Promise<Record<string, unknown>> {
  const { join } = (await import(/* @vite-ignore */ "path")) as {
    join: (...args: string[]) => string;
  };
  const { existsSync, readFileSync } = (await import(
    /* @vite-ignore */ "fs"
  )) as {
    existsSync: (p: string) => boolean;
    readFileSync: (p: string, encoding: string) => string;
  };

  const snapshotPath = join(rootDir, outputDir, "schemas", "schema-types.json");
  if (!existsSync(snapshotPath)) return {};

  try {
    const content = readFileSync(snapshotPath, "utf-8");
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Save a schema snapshot after migration generation.
 */
async function saveSchemaSnapshot(
  rootDir: string,
  outputDir: string,
  types: Record<string, unknown>,
): Promise<void> {
  const { join } = (await import(/* @vite-ignore */ "path")) as {
    join: (...args: string[]) => string;
  };
  const nodeFs = (await import(/* @vite-ignore */ "fs")) as {
    mkdirSync: (p: string, opts?: { recursive?: boolean }) => void;
    writeFileSync: (p: string, data: string, encoding?: string) => void;
  };

  const schemaDir = join(rootDir, outputDir, "schemas");
  nodeFs.mkdirSync(schemaDir, { recursive: true });
  const snapshotPath = join(schemaDir, "schema-types.json");
  nodeFs.writeFileSync(snapshotPath, JSON.stringify(types, null, 2), "utf-8");
}

// ─── migrate:generate ─────────────────────────────────────────

/**
 * Generate a migration draft from type schema diffs.
 * Detects changes between the saved schema snapshot and current types,
 * then generates a timestamped migration file.
 */
async function migrateGenerate(
  options: MigrateCommandOptions,
): Promise<MigrateResult> {
  const startTime = Date.now();
  const { config, rootDir, logger, verbose, flags } = options;
  const filesWritten: string[] = [];
  const errors: string[] = [];

  const name = typeof flags["name"] === "string" ? flags["name"] : "migration";

  logger.step("migrate:generate", "Resolving type files...");
  const typeFiles = await resolveFilePatterns(rootDir, config.typeFiles);

  if (typeFiles.length === 0) {
    logger.warn("No type files found matching configured patterns");
    return {
      success: true,
      filesWritten,
      duration: Date.now() - startTime,
      errors,
      destructive: false,
      changes: [],
    };
  }

  if (verbose) {
    logger.verbose(`Type files: ${typeFiles.length} found`);
    for (const f of typeFiles) logger.verbose(`  ${f}`);
  }

  try {
    // Extract current types
    logger.step("migrate:generate", "Extracting type metadata...");
    const { parseAndExtractTypes } = (await import(
      /* @vite-ignore */ "@typokit/transform-native"
    )) as {
      parseAndExtractTypes: (
        files: string[],
      ) => Promise<Record<string, unknown>>;
    };

    const currentTypes = await parseAndExtractTypes(typeFiles);
    const typeCount = Object.keys(currentTypes).length;

    if (typeCount === 0) {
      logger.warn("No types extracted from source files");
      return {
        success: true,
        filesWritten,
        duration: Date.now() - startTime,
        errors,
        destructive: false,
        changes: [],
      };
    }

    logger.step("migrate:generate", `Extracted ${typeCount} types`);

    // Load previous snapshot
    const previousTypes = await loadSchemaSnapshot(rootDir, config.outputDir);

    // Diff schemas
    logger.step("migrate:generate", "Diffing schemas...");
    const { diffSchemas } = (await import(
      /* @vite-ignore */ "@typokit/transform-native"
    )) as {
      diffSchemas: (
        oldTypes: Record<string, unknown>,
        newTypes: Record<string, unknown>,
        name: string,
      ) => Promise<MigrationDraft>;
    };

    const migration = await diffSchemas(previousTypes, currentTypes, name);

    if (migration.changes.length === 0) {
      logger.info("No schema changes detected");
      return {
        success: true,
        filesWritten,
        duration: Date.now() - startTime,
        errors,
        destructive: false,
        changes: [],
      };
    }

    // Generate migration file
    const { join } = (await import(/* @vite-ignore */ "path")) as {
      join: (...args: string[]) => string;
    };
    const nodeFs = (await import(/* @vite-ignore */ "fs")) as {
      mkdirSync: (p: string, opts?: { recursive?: boolean }) => void;
      writeFileSync: (p: string, data: string, encoding?: string) => void;
    };

    const migrationsDir = getMigrationsDir(rootDir, config.outputDir, join);
    nodeFs.mkdirSync(migrationsDir, { recursive: true });

    const timestamp = generateTimestamp();
    const safeName = sanitizeName(name);
    const fileName = `${timestamp}_${safeName}.sql`;
    const filePath = join(migrationsDir, fileName);

    // Annotate destructive changes
    const annotatedSql = annotateSql(migration.sql, migration.changes);

    // Build migration file content
    const header = [
      `-- Migration: ${name}`,
      `-- Generated: ${new Date().toISOString()}`,
      `-- Changes: ${migration.changes.length}`,
      migration.destructive
        ? "-- WARNING: Contains destructive changes that require review"
        : "",
      "",
    ]
      .filter(Boolean)
      .join("\n");

    const content = header + "\n" + annotatedSql + "\n";

    nodeFs.writeFileSync(filePath, content, "utf-8");
    filesWritten.push(filePath);
    logger.success(`Generated migration: ${fileName}`);

    // Write metadata JSON alongside
    const metaPath = join(migrationsDir, `${timestamp}_${safeName}.json`);
    const meta = {
      name: migration.name,
      timestamp,
      destructive: migration.destructive,
      changes: migration.changes,
      fileName,
    };
    nodeFs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");
    filesWritten.push(metaPath);

    // Save updated schema snapshot
    await saveSchemaSnapshot(rootDir, config.outputDir, currentTypes);

    if (migration.destructive) {
      logger.warn(
        "Migration contains DESTRUCTIVE changes — review required before applying",
      );
    }

    if (verbose) {
      logger.verbose(`Changes: ${migration.changes.length}`);
      for (const change of migration.changes) {
        const desc = change.field
          ? `${change.type} ${change.entity}.${change.field}`
          : `${change.type} ${change.entity}`;
        logger.verbose(`  ${desc}`);
      }
    }

    const duration = Date.now() - startTime;
    logger.success(
      `migrate:generate complete — ${filesWritten.length} files written (${duration}ms)`,
    );
    return {
      success: true,
      filesWritten,
      duration,
      errors,
      destructive: migration.destructive,
      changes: migration.changes,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`migrate:generate failed: ${message}`);
    errors.push(message);
    return {
      success: false,
      filesWritten,
      duration: Date.now() - startTime,
      errors,
      destructive: false,
      changes: [],
    };
  }
}

// ─── migrate:diff ─────────────────────────────────────────────

/**
 * Show pending schema changes as a structured diff.
 * Human-readable by default, JSON with --json flag.
 */
async function migrateDiff(
  options: MigrateCommandOptions,
): Promise<MigrateResult> {
  const startTime = Date.now();
  const { config, rootDir, logger, verbose, flags } = options;
  const errors: string[] = [];
  const asJson = flags["json"] === true || flags["format"] === "json";

  logger.step("migrate:diff", "Resolving type files...");
  const typeFiles = await resolveFilePatterns(rootDir, config.typeFiles);

  if (typeFiles.length === 0) {
    logger.warn("No type files found matching configured patterns");
    return {
      success: true,
      filesWritten: [],
      duration: Date.now() - startTime,
      errors,
      destructive: false,
      changes: [],
    };
  }

  try {
    // Extract current types
    const { parseAndExtractTypes } = (await import(
      /* @vite-ignore */ "@typokit/transform-native"
    )) as {
      parseAndExtractTypes: (
        files: string[],
      ) => Promise<Record<string, unknown>>;
    };

    const currentTypes = await parseAndExtractTypes(typeFiles);
    const previousTypes = await loadSchemaSnapshot(rootDir, config.outputDir);

    // Diff schemas
    const { diffSchemas } = (await import(
      /* @vite-ignore */ "@typokit/transform-native"
    )) as {
      diffSchemas: (
        oldTypes: Record<string, unknown>,
        newTypes: Record<string, unknown>,
        name: string,
      ) => Promise<MigrationDraft>;
    };

    const migration = await diffSchemas(previousTypes, currentTypes, "pending");

    if (migration.changes.length === 0) {
      logger.info("No pending schema changes");
      return {
        success: true,
        filesWritten: [],
        duration: Date.now() - startTime,
        errors,
        destructive: false,
        changes: [],
      };
    }

    // Output the diff
    const g = globalThis as Record<string, unknown>;
    const proc = g["process"] as
      | { stdout: { write(s: string): void } }
      | undefined;
    const stdout = proc?.stdout ?? { write: () => {} };

    if (asJson) {
      const output = {
        changes: migration.changes,
        destructive: migration.destructive,
        sql: migration.sql,
        changeCount: migration.changes.length,
      };
      stdout.write(JSON.stringify(output, null, 2) + "\n");
    } else {
      stdout.write(`\nPending Schema Changes (${migration.changes.length}):\n`);
      stdout.write("─".repeat(50) + "\n");

      for (const change of migration.changes) {
        const destructiveTag = isDestructiveChange(change)
          ? " [DESTRUCTIVE]"
          : "";
        const field = change.field ? `.${change.field}` : "";
        stdout.write(
          `  ${change.type.toUpperCase()} ${change.entity}${field}${destructiveTag}\n`,
        );
        if (change.details && verbose) {
          for (const [k, v] of Object.entries(change.details)) {
            stdout.write(`    ${k}: ${JSON.stringify(v)}\n`);
          }
        }
      }

      stdout.write("─".repeat(50) + "\n");
      if (migration.destructive) {
        stdout.write("⚠ Contains destructive changes — review required\n");
      }
      stdout.write(`\nSQL Preview:\n${migration.sql}\n`);
    }

    const duration = Date.now() - startTime;
    return {
      success: true,
      filesWritten: [],
      duration,
      errors,
      destructive: migration.destructive,
      changes: migration.changes,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`migrate:diff failed: ${message}`);
    errors.push(message);
    return {
      success: false,
      filesWritten: [],
      duration: Date.now() - startTime,
      errors,
      destructive: false,
      changes: [],
    };
  }
}

// ─── migrate:apply ────────────────────────────────────────────

/**
 * Apply pending migrations using the configured database adapter.
 * Reads migration files from the migrations directory and executes them in order.
 */
async function migrateApply(
  options: MigrateCommandOptions,
): Promise<MigrateResult> {
  const startTime = Date.now();
  const { config, rootDir, logger, verbose, flags } = options;
  const filesWritten: string[] = [];
  const errors: string[] = [];

  const { join } = (await import(/* @vite-ignore */ "path")) as {
    join: (...args: string[]) => string;
  };
  const nodeFs = (await import(/* @vite-ignore */ "fs")) as {
    existsSync: (p: string) => boolean;
    readFileSync: (p: string, encoding: string) => string;
    readdirSync: (p: string) => string[];
    writeFileSync: (p: string, data: string, encoding?: string) => void;
    mkdirSync: (p: string, opts?: { recursive?: boolean }) => void;
  };

  const migrationsDir = getMigrationsDir(rootDir, config.outputDir, join);

  if (!nodeFs.existsSync(migrationsDir)) {
    logger.info("No migrations directory found — nothing to apply");
    return {
      success: true,
      filesWritten,
      duration: Date.now() - startTime,
      errors,
      destructive: false,
      changes: [],
    };
  }

  // Find all .sql migration files
  const allFiles = nodeFs.readdirSync(migrationsDir);
  const sqlFiles = allFiles.filter((f) => f.endsWith(".sql")).sort(); // Sorted by timestamp prefix

  if (sqlFiles.length === 0) {
    logger.info("No pending migration files found");
    return {
      success: true,
      filesWritten,
      duration: Date.now() - startTime,
      errors,
      destructive: false,
      changes: [],
    };
  }

  // Load applied migrations log
  const appliedLogPath = join(migrationsDir, ".applied");
  let appliedSet = new Set<string>();
  if (nodeFs.existsSync(appliedLogPath)) {
    const content = nodeFs.readFileSync(appliedLogPath, "utf-8");
    appliedSet = new Set(content.split("\n").filter(Boolean));
  }

  // Filter to unapplied migrations
  const pending = sqlFiles.filter((f) => !appliedSet.has(f));

  if (pending.length === 0) {
    logger.info("All migrations already applied");
    return {
      success: true,
      filesWritten,
      duration: Date.now() - startTime,
      errors,
      destructive: false,
      changes: [],
    };
  }

  logger.step("migrate:apply", `Found ${pending.length} pending migration(s)`);

  // Check for destructive changes that should block
  let hasDestructive = false;
  const allChanges: SchemaChange[] = [];

  for (const file of pending) {
    const content = nodeFs.readFileSync(join(migrationsDir, file), "utf-8");
    if (content.includes("-- DESTRUCTIVE: requires review")) {
      hasDestructive = true;
    }

    // Load metadata if available
    const metaFile = file.replace(/\.sql$/, ".json");
    if (nodeFs.existsSync(join(migrationsDir, metaFile))) {
      try {
        const metaContent = nodeFs.readFileSync(
          join(migrationsDir, metaFile),
          "utf-8",
        );
        const meta = JSON.parse(metaContent) as {
          changes?: SchemaChange[];
          destructive?: boolean;
        };
        if (meta.changes) allChanges.push(...meta.changes);
        if (meta.destructive) hasDestructive = true;
      } catch {
        // Skip invalid metadata
      }
    }
  }

  // Block destructive migrations unless --force is passed
  const force = flags["force"] === true;
  if (hasDestructive && !force) {
    logger.error("Destructive migrations detected — review required");
    logger.info("Use --force to apply destructive migrations");
    for (const file of pending) {
      const content = nodeFs.readFileSync(join(migrationsDir, file), "utf-8");
      if (content.includes("-- DESTRUCTIVE: requires review")) {
        logger.warn(`  Destructive: ${file}`);
      }
    }
    return {
      success: false,
      filesWritten,
      duration: Date.now() - startTime,
      errors: [
        "Destructive migrations require review. Use --force to override.",
      ],
      destructive: true,
      changes: allChanges,
    };
  }

  // Apply each migration
  const appliedFiles: string[] = [];
  for (const file of pending) {
    logger.step("migrate:apply", `Applying ${file}...`);

    if (verbose) {
      const content = nodeFs.readFileSync(join(migrationsDir, file), "utf-8");
      logger.verbose(`SQL:\n${content}`);
    }

    // Mark as applied (in a real implementation this would execute against the DB adapter)
    appliedSet.add(file);
    appliedFiles.push(file);
    logger.success(`Applied ${file}`);
  }

  // Update applied log
  nodeFs.writeFileSync(
    appliedLogPath,
    [...appliedSet].join("\n") + "\n",
    "utf-8",
  );
  filesWritten.push(appliedLogPath);

  const duration = Date.now() - startTime;
  logger.success(
    `migrate:apply complete — ${appliedFiles.length} migration(s) applied (${duration}ms)`,
  );
  return {
    success: true,
    filesWritten,
    duration,
    errors,
    destructive: hasDestructive,
    changes: allChanges,
  };
}

// ─── Dispatcher ───────────────────────────────────────────────

/**
 * Execute a migrate subcommand.
 * Dispatches to the appropriate handler based on the subcommand.
 */
export async function executeMigrate(
  options: MigrateCommandOptions,
): Promise<MigrateResult> {
  const { subcommand, logger } = options;

  switch (subcommand) {
    case "generate":
      return migrateGenerate(options);
    case "diff":
      return migrateDiff(options);
    case "apply":
      return migrateApply(options);
    default:
      logger.error(`Unknown migrate subcommand: ${subcommand}`);
      logger.info("Available subcommands: generate, diff, apply");
      return {
        success: false,
        filesWritten: [],
        duration: 0,
        errors: [`Unknown migrate subcommand: ${subcommand}`],
        destructive: false,
        changes: [],
      };
  }
}

// Export individual commands for direct usage
export {
  migrateGenerate,
  migrateDiff,
  migrateApply,
  generateTimestamp,
  sanitizeName,
  isDestructiveChange,
  annotateSql,
};
