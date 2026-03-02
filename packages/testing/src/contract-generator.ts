// @typokit/testing — Contract Test Generation
//
// Auto-generates baseline contract tests from route schemas.
// Output is test-runner-agnostic (Jest, Vitest, Rstest).

import type { HttpMethod, TypeMetadata, SchemaTypeMap } from "@typokit/types";

// ─── Types ────────────────────────────────────────────────────

/** A route definition used for contract test generation */
export interface ContractTestRoute {
  /** HTTP method */
  method: HttpMethod;
  /** Route path (e.g. "/users/:id") */
  path: string;
  /** Handler reference */
  handlerRef: string;
  /** Validator schema references */
  validators?: {
    params?: string;
    query?: string;
    body?: string;
  };
  /** Response schema name (for toMatchSchema assertions) */
  responseSchema?: string;
  /** Expected success status code (default: 200) */
  expectedStatus?: number;
}

/** Supported test runners */
export type TestRunner = "jest" | "vitest" | "rstest";

/** Options for contract test generation */
export interface ContractTestOptions {
  /** Test runner to generate imports for */
  runner: TestRunner;
  /** Import path for the app module (e.g. "../src/app") */
  appImport: string;
  /** Routes to generate tests for */
  routes: ContractTestRoute[];
  /** Schema type metadata for validators */
  schemas: SchemaTypeMap;
}

/** A generated contract test file */
export interface ContractTestOutput {
  /** Relative file path (e.g. "__generated__/users.contract.test.ts") */
  filePath: string;
  /** Generated file content */
  content: string;
}

// ─── Helpers ──────────────────────────────────────────────────

/** Deterministic seed-based data generator for inline test values */
function generateSampleValue(
  type: string,
  jsdoc?: Record<string, string>,
): unknown {
  // Check for format constraints
  const format = jsdoc?.["format"] ?? jsdoc?.["@format"];
  if (format === "email") return "test@example.com";
  if (format === "url") return "https://example.com";
  if (format === "uuid") return "550e8400-e29b-41d4-a716-446655440000";
  if (format === "date-time") return "2026-01-01T00:00:00.000Z";

  // Check for string unions
  if (type.includes("|") && type.includes('"')) {
    const values = type.split("|").map((v) => v.trim().replace(/^"|"$/g, ""));
    return values[0];
  }

  if (type === "string") return "test-value";
  if (type === "number") return 42;
  if (type === "boolean") return true;
  if (type === "string[]") return ["test-item"];
  if (type === "number[]") return [1];
  if (type.endsWith("[]")) return [];

  return "test-value";
}

/** Generate an invalid value for a given type */
function generateInvalidSampleValue(
  type: string,
  jsdoc?: Record<string, string>,
): unknown {
  const format = jsdoc?.["format"] ?? jsdoc?.["@format"];
  if (format === "email") return "not-an-email";
  if (format === "url") return "not-a-url";
  if (format === "uuid") return "not-a-uuid";
  if (format === "date-time") return "not-a-date";

  if (type === "number") return "not-a-number";
  if (type === "boolean") return "not-a-boolean";

  // String unions — use a value not in the set
  if (type.includes("|") && type.includes('"')) {
    return "__invalid_enum_value__";
  }

  return 12345;
}

/** Get the test runner import statement */
function getImportStatement(runner: TestRunner): string {
  switch (runner) {
    case "jest":
      return 'import { describe, it, expect } from "@jest/globals";';
    case "vitest":
      return 'import { describe, it, expect } from "vitest";';
    case "rstest":
      return 'import { describe, it, expect } from "@rstest/core";';
  }
}

/** Group routes by path prefix for file organization */
function groupRoutesByPrefix(
  routes: ContractTestRoute[],
): Record<string, ContractTestRoute[]> {
  const groups: Record<string, ContractTestRoute[]> = {};

  for (const route of routes) {
    // Extract first path segment as group name
    const segments = route.path.split("/").filter(Boolean);
    const prefix = segments.length > 0 ? segments[0] : "root";
    if (!groups[prefix]) {
      groups[prefix] = [];
    }
    groups[prefix].push(route);
  }

  // Sort routes within each group deterministically
  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => {
      const methodOrder = a.method.localeCompare(b.method);
      if (methodOrder !== 0) return methodOrder;
      return a.path.localeCompare(b.path);
    });
  }

  return groups;
}

/** Escape a value for use in generated TypeScript code */
function toCodeLiteral(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return `[${value.map(toCodeLiteral).join(", ")}]`;
  }
  return JSON.stringify(value);
}

/** Build a valid body object literal as code string */
function buildBodyLiteral(
  schema: TypeMetadata,
  indent: string,
): string {
  const entries: string[] = [];
  for (const [key, prop] of Object.entries(schema.properties)) {
    if (prop.optional) continue;
    const value = generateSampleValue(prop.type, prop.jsdoc);
    entries.push(`${indent}  ${key}: ${toCodeLiteral(value)},`);
  }
  if (entries.length === 0) return "{}";
  return `{\n${entries.join("\n")}\n${indent}}`;
}

// ─── Generator ────────────────────────────────────────────────

/**
 * Generate contract test files from route schemas.
 *
 * Groups routes by path prefix and produces one test file per group.
 * Each file tests: valid input → expected status, missing required
 * fields → 400, invalid field formats → 400.
 *
 * ```ts
 * const outputs = generateContractTests({
 *   runner: "vitest",
 *   appImport: "../src/app",
 *   routes: [{ method: "POST", path: "/users", ... }],
 *   schemas: { CreateUserInput: { ... } },
 * });
 * ```
 */
export function generateContractTests(
  options: ContractTestOptions,
): ContractTestOutput[] {
  const { runner, appImport, routes, schemas } = options;
  const groups = groupRoutesByPrefix(routes);
  const outputs: ContractTestOutput[] = [];

  for (const [prefix, groupRoutes] of Object.entries(groups).sort(
    ([a], [b]) => a.localeCompare(b),
  )) {
    const content = generateTestFile(runner, appImport, groupRoutes, schemas);
    outputs.push({
      filePath: `__generated__/${prefix}.contract.test.ts`,
      content,
    });
  }

  return outputs;
}

/** Generate a single contract test file for a group of routes */
function generateTestFile(
  runner: TestRunner,
  appImport: string,
  routes: ContractTestRoute[],
  schemas: SchemaTypeMap,
): string {
  const lines: string[] = [];

  // Header
  lines.push("// DO NOT EDIT — regenerated on schema change");
  lines.push(`// Generated by @typokit/testing contract-generator`);
  lines.push("");

  // Imports
  lines.push(getImportStatement(runner));
  lines.push(`import { createTestClient } from "@typokit/testing";`);

  // Only import toMatchSchema if any route has a response schema
  const hasResponseSchema = routes.some((r) => r.responseSchema);
  if (hasResponseSchema) {
    lines.push(`import { toMatchSchema } from "@typokit/testing";`);
  }
  lines.push(`import { app } from ${JSON.stringify(appImport)};`);
  lines.push("");

  // Setup
  lines.push("let client: Awaited<ReturnType<typeof createTestClient>>;");
  lines.push("");
  lines.push("beforeAll(async () => {");
  lines.push("  client = await createTestClient(app);");
  lines.push("});");
  lines.push("");
  lines.push("afterAll(async () => {");
  lines.push("  await client.close();");
  lines.push("});");
  lines.push("");

  // Generate test blocks for each route
  for (const route of routes) {
    generateRouteTests(lines, route, schemas);
    lines.push("");
  }

  return lines.join("\n");
}

/** Generate describe/it blocks for a single route */
function generateRouteTests(
  lines: string[],
  route: ContractTestRoute,
  schemas: SchemaTypeMap,
): void {
  const { method, path, validators, responseSchema, expectedStatus } = route;
  const successStatus = expectedStatus ?? 200;
  const methodLower = method.toLowerCase();

  lines.push(`describe("${method} ${path}", () => {`);

  // Resolve body schema if validators reference one
  const bodySchemaName = validators?.body;
  const bodySchema = bodySchemaName ? schemas[bodySchemaName] : undefined;

  // Determine if the method typically has a body
  const hasBody = ["POST", "PUT", "PATCH"].includes(method);

  // ── Test 1: Valid input → expected status ──
  if (hasBody && bodySchema) {
    const bodyLiteral = buildBodyLiteral(bodySchema, "      ");
    lines.push(`  it("accepts valid ${bodySchemaName}", async () => {`);
    lines.push(`    const res = await client.${methodLower}("${path}", {`);
    lines.push(`      body: ${bodyLiteral},`);
    lines.push(`    });`);
    lines.push(`    expect(res.status).toBe(${successStatus});`);
    if (responseSchema) {
      lines.push(`    expect(res.body).toMatchSchema("${responseSchema}");`);
    }
    lines.push(`  });`);
  } else {
    lines.push(`  it("responds with ${successStatus}", async () => {`);
    lines.push(`    const res = await client.${methodLower}("${path}");`);
    lines.push(`    expect(res.status).toBe(${successStatus});`);
    if (responseSchema) {
      lines.push(`    expect(res.body).toMatchSchema("${responseSchema}");`);
    }
    lines.push(`  });`);
  }

  // ── Test 2: Missing required fields → 400 ──
  if (hasBody && bodySchema) {
    const requiredFields = Object.entries(bodySchema.properties)
      .filter(([, prop]) => !prop.optional)
      .map(([key]) => key)
      .sort();

    if (requiredFields.length > 0) {
      lines.push("");
      lines.push(`  it("rejects missing required fields", async () => {`);
      lines.push(`    const res = await client.${methodLower}("${path}", { body: {} });`);
      lines.push(`    expect(res.status).toBe(400);`);
      lines.push(`  });`);

      // Individual field tests for more specific coverage
      for (const field of requiredFields) {
        lines.push("");
        lines.push(
          `  it("rejects missing '${field}' field", async () => {`,
        );
        // Build a body with all required fields except this one
        const partialEntries: string[] = [];
        for (const [key, prop] of Object.entries(bodySchema.properties)) {
          if (prop.optional || key === field) continue;
          const value = generateSampleValue(prop.type, prop.jsdoc);
          partialEntries.push(`        ${key}: ${toCodeLiteral(value)},`);
        }
        const partialBody =
          partialEntries.length > 0
            ? `{\n${partialEntries.join("\n")}\n      }`
            : "{}";
        lines.push(
          `    const res = await client.${methodLower}("${path}", {`,
        );
        lines.push(`      body: ${partialBody},`);
        lines.push(`    });`);
        lines.push(`    expect(res.status).toBe(400);`);
        lines.push(`  });`);
      }
    }
  }

  // ── Test 3: Invalid field formats → 400 ──
  if (hasBody && bodySchema) {
    const fieldsWithFormats = Object.entries(bodySchema.properties)
      .filter(([, prop]) => {
        const jsdoc = prop.jsdoc;
        if (!jsdoc) return false;
        return !!(jsdoc["format"] || jsdoc["@format"]);
      })
      .sort(([a], [b]) => a.localeCompare(b));

    // Also include string unions and typed fields that can be invalidated
    const fieldsWithTypes = Object.entries(bodySchema.properties)
      .filter(([, prop]) => {
        // Already covered by format
        if (prop.jsdoc?.["format"] || prop.jsdoc?.["@format"]) return false;
        return (
          prop.type === "number" ||
          prop.type === "boolean" ||
          (prop.type.includes("|") && prop.type.includes('"'))
        );
      })
      .sort(([a], [b]) => a.localeCompare(b));

    const invalidFields = [...fieldsWithFormats, ...fieldsWithTypes];

    for (const [field, prop] of invalidFields) {
      const invalidValue = generateInvalidSampleValue(prop.type, prop.jsdoc);
      lines.push("");
      lines.push(
        `  it("rejects invalid ${field} format", async () => {`,
      );
      // Build a valid body, then replace the field with invalid value
      const fullEntries: string[] = [];
      for (const [key, p] of Object.entries(bodySchema.properties)) {
        if (p.optional) continue;
        const value =
          key === field ? invalidValue : generateSampleValue(p.type, p.jsdoc);
        fullEntries.push(`        ${key}: ${toCodeLiteral(value)},`);
      }
      const fullBody =
        fullEntries.length > 0
          ? `{\n${fullEntries.join("\n")}\n      }`
          : "{}";
      lines.push(
        `    const res = await client.${methodLower}("${path}", {`,
      );
      lines.push(`      body: ${fullBody},`);
      lines.push(`    });`);
      lines.push(`    expect(res.status).toBe(400);`);
      lines.push(`  });`);
    }
  }

  lines.push(`});`);
}

/**
 * Detect the test runner used in a project by checking for known
 * config files or dependencies.
 *
 * Returns the detected runner or "vitest" as default.
 */
export function detectTestRunner(
  packageJson: Record<string, unknown>,
): TestRunner {
  const deps = {
    ...(packageJson["dependencies"] as Record<string, string> | undefined),
    ...(packageJson["devDependencies"] as Record<string, string> | undefined),
  };

  if (deps["rstest"]) return "rstest";
  if (deps["vitest"]) return "vitest";
  if (deps["jest"] || deps["@jest/globals"]) return "jest";

  // Check scripts for runner hints
  const scripts = packageJson["scripts"] as
    | Record<string, string>
    | undefined;
  if (scripts) {
    const testScript = scripts["test"] ?? "";
    if (testScript.includes("rstest")) return "rstest";
    if (testScript.includes("vitest")) return "vitest";
    if (testScript.includes("jest")) return "jest";
  }

  return "vitest";
}
