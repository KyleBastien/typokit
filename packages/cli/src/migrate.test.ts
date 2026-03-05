// @typokit/cli — Migration Command Tests

import { describe, it, expect } from "@rstest/core";
import { createLogger } from "./index.js";
import type { MigrateCommandOptions } from "./commands/migrate.js";

// ─── Helper ─────────────────────────────────────────────────

function makeOptions(
  overrides: Partial<MigrateCommandOptions> = {},
): MigrateCommandOptions {
  return {
    rootDir: "/nonexistent",
    config: {
      typeFiles: [],
      routeFiles: [],
      outputDir: ".typokit",
      distDir: "dist",
      compiler: "tsc",
      compilerArgs: [],
    },
    logger: createLogger({ verbose: false }),
    subcommand: "generate",
    flags: {},
    verbose: false,
    ...overrides,
  };
}

// ─── executeMigrate dispatcher ──────────────────────────────

describe("executeMigrate", () => {
  it("returns error for unknown subcommand", async () => {
    const { executeMigrate } = await import("./commands/migrate.js");
    const result = await executeMigrate(
      makeOptions({ subcommand: "nonexistent" }),
    );

    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("Unknown migrate subcommand");
  });

  it("dispatches to migrate:generate with no type files", async () => {
    const { executeMigrate } = await import("./commands/migrate.js");
    const result = await executeMigrate(
      makeOptions({ subcommand: "generate" }),
    );

    expect(result.success).toBe(true);
    expect(result.filesWritten).toEqual([]);
    expect(result.changes).toEqual([]);
  });

  it("dispatches to migrate:diff with no type files", async () => {
    const { executeMigrate } = await import("./commands/migrate.js");
    const result = await executeMigrate(makeOptions({ subcommand: "diff" }));

    expect(result.success).toBe(true);
    expect(result.filesWritten).toEqual([]);
    expect(result.changes).toEqual([]);
  });

  it("dispatches to migrate:apply with no migrations dir", async () => {
    const { executeMigrate } = await import("./commands/migrate.js");
    const result = await executeMigrate(makeOptions({ subcommand: "apply" }));

    expect(result.success).toBe(true);
    expect(result.filesWritten).toEqual([]);
  });
});

// ─── Utility functions ──────────────────────────────────────

describe("generateTimestamp", () => {
  it("returns a 14-character timestamp string", async () => {
    const { generateTimestamp } = await import("./commands/migrate.js");
    const ts = generateTimestamp();
    expect(ts.length).toBe(14);
    expect(/^\d{14}$/.test(ts)).toBe(true);
  });
});

describe("sanitizeName", () => {
  it("converts to lowercase with underscores", async () => {
    const { sanitizeName } = await import("./commands/migrate.js");
    expect(sanitizeName("add-user-avatar")).toBe("add_user_avatar");
    expect(sanitizeName("AddUserAvatar")).toBe("adduseravatar");
    expect(sanitizeName("  spaces  here  ")).toBe("spaces_here");
  });

  it("removes leading and trailing underscores", async () => {
    const { sanitizeName } = await import("./commands/migrate.js");
    expect(sanitizeName("__test__")).toBe("test");
  });
});

describe("isDestructiveChange", () => {
  it("identifies remove changes as destructive", async () => {
    const { isDestructiveChange } = await import("./commands/migrate.js");
    expect(isDestructiveChange({ type: "remove", entity: "users" })).toBe(true);
    expect(
      isDestructiveChange({ type: "remove", entity: "users", field: "email" }),
    ).toBe(true);
  });

  it("identifies type changes as destructive", async () => {
    const { isDestructiveChange } = await import("./commands/migrate.js");
    expect(
      isDestructiveChange({
        type: "modify",
        entity: "users",
        field: "age",
        details: { oldType: "string", newType: "number" },
      }),
    ).toBe(true);
  });

  it("does not flag add changes as destructive", async () => {
    const { isDestructiveChange } = await import("./commands/migrate.js");
    expect(isDestructiveChange({ type: "add", entity: "users" })).toBe(false);
    expect(
      isDestructiveChange({ type: "add", entity: "users", field: "avatar" }),
    ).toBe(false);
  });

  it("does not flag non-type modify as destructive", async () => {
    const { isDestructiveChange } = await import("./commands/migrate.js");
    expect(
      isDestructiveChange({
        type: "modify",
        entity: "users",
        field: "name",
        details: { nullable: true },
      }),
    ).toBe(false);
  });
});

describe("annotateSql", () => {
  it("adds destructive comments to DROP statements", async () => {
    const { annotateSql } = await import("./commands/migrate.js");
    const sql = "DROP TABLE users;\nCREATE TABLE posts (id INTEGER);";
    const changes = [{ type: "remove" as const, entity: "users" }];

    const annotated = annotateSql(sql, changes);
    expect(annotated).toContain("-- DESTRUCTIVE: requires review");
    expect(annotated).toContain("DROP TABLE users;");
  });

  it("adds destructive comments to ALTER DROP statements", async () => {
    const { annotateSql } = await import("./commands/migrate.js");
    const sql = "ALTER TABLE users DROP COLUMN email;";
    const changes = [
      { type: "remove" as const, entity: "users", field: "email" },
    ];

    const annotated = annotateSql(sql, changes);
    expect(annotated).toContain("-- DESTRUCTIVE: requires review");
  });

  it("does not annotate non-destructive SQL", async () => {
    const { annotateSql } = await import("./commands/migrate.js");
    const sql = "CREATE TABLE users (id INTEGER);";
    const changes = [{ type: "add" as const, entity: "users" }];

    const annotated = annotateSql(sql, changes);
    expect(annotated).not.toContain("-- DESTRUCTIVE");
    expect(annotated).toBe(sql);
  });
});

// ─── Integration: parseArgs + run ───────────────────────────

describe("CLI migrate routing", () => {
  it("parseArgs parses migrate:generate correctly", async () => {
    const { parseArgs } = await import("./index.js");
    const result = parseArgs([
      "node",
      "typokit",
      "migrate:generate",
      "--name",
      "add-avatar",
    ]);

    expect(result.command).toBe("migrate:generate");
    expect(result.flags["name"]).toBe("add-avatar");
  });

  it("parseArgs parses migrate:diff with --json", async () => {
    const { parseArgs } = await import("./index.js");
    const result = parseArgs(["node", "typokit", "migrate:diff", "--json"]);

    expect(result.command).toBe("migrate:diff");
    expect(result.flags["json"]).toBe(true);
  });

  it("parseArgs parses migrate:apply with --force", async () => {
    const { parseArgs } = await import("./index.js");
    const result = parseArgs(["node", "typokit", "migrate:apply", "--force"]);

    expect(result.command).toBe("migrate:apply");
    expect(result.flags["force"]).toBe(true);
  });
});
