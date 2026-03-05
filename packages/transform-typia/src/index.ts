// @typokit/transform-typia — Typia Validation Bridge
//
// Generates runtime validation code from type metadata.
// Typia is installed as a dependency for transformer integration;
// this module bridges Rust-extracted TypeMetadata to generated validators.

import type { TypeMetadata } from "@typokit/types";

/**
 * Error thrown when validator generation fails for a type.
 */
export class ValidatorGenerationError extends Error {
  public readonly typeName: string;
  public readonly reason: string;

  constructor(typeName: string, reason: string) {
    super(`Failed to generate validator for type "${typeName}": ${reason}`);
    this.typeName = typeName;
    this.reason = reason;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Generate a runtime validator function as a code string from type metadata.
 * The generated function validates input against the type's shape and returns
 * `{ success: true, data }` or `{ success: false, errors }`.
 */
export function generateValidator(typeMetadata: TypeMetadata): string {
  try {
    assertValidMetadata(typeMetadata);
    return buildValidatorCode(typeMetadata);
  } catch (err) {
    if (err instanceof ValidatorGenerationError) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    throw new ValidatorGenerationError(typeMetadata.name, reason);
  }
}

/**
 * Generate validators for multiple types in batch.
 * Types can cross-reference each other for nested validation.
 * Returns Map<typeName, generatedCode>.
 */
export function generateValidatorBatch(
  types: TypeMetadata[],
): Map<string, string> {
  const result = new Map<string, string>();
  const registry = new Map<string, TypeMetadata>();
  for (const t of types) {
    registry.set(t.name, t);
  }

  for (const metadata of types) {
    try {
      assertValidMetadata(metadata);
      const code = buildValidatorCode(metadata, registry);
      result.set(metadata.name, code);
    } catch (err) {
      if (err instanceof ValidatorGenerationError) throw err;
      const reason = err instanceof Error ? err.message : String(err);
      throw new ValidatorGenerationError(metadata.name, reason);
    }
  }

  return result;
}

// ── Internal helpers ─────────────────────────────────────────────

function assertValidMetadata(metadata: TypeMetadata): void {
  if (!metadata.name || typeof metadata.name !== "string") {
    throw new ValidatorGenerationError(
      metadata.name ?? "<unnamed>",
      "TypeMetadata must have a non-empty string name",
    );
  }
  if (!metadata.properties || typeof metadata.properties !== "object") {
    throw new ValidatorGenerationError(
      metadata.name,
      "TypeMetadata must have a properties object",
    );
  }
}

function buildValidatorCode(
  metadata: TypeMetadata,
  registry?: Map<string, TypeMetadata>,
): string {
  const fnName = `validate${metadata.name}`;
  const propEntries = Object.entries(metadata.properties);
  const lines: string[] = [];

  lines.push(`function ${fnName}(input) {`);
  lines.push(`  if (typeof input !== "object" || input === null) {`);
  lines.push(
    `    return { success: false, errors: [{ path: "$input", expected: "object", actual: input === null ? "null" : typeof input }] };`,
  );
  lines.push(`  }`);

  if (propEntries.length === 0) {
    lines.push(`  return { success: true, data: input };`);
    lines.push(`}`);
    return lines.join("\n");
  }

  lines.push(`  var errors = [];`);

  for (const [propName, propDef] of propEntries) {
    const accessor = `input[${JSON.stringify(propName)}]`;
    const typeCheck = generateTypeCheck(accessor, propDef.type, registry);

    if (propDef.optional) {
      lines.push(`  if (${accessor} !== undefined) {`);
      lines.push(`    if (!(${typeCheck})) {`);
      lines.push(
        `      errors.push({ path: ${JSON.stringify(propName)}, expected: ${JSON.stringify(propDef.type)}, actual: typeof ${accessor} });`,
      );
      lines.push(`    }`);
      lines.push(`  }`);
    } else {
      lines.push(`  if (${accessor} === undefined) {`);
      lines.push(
        `    errors.push({ path: ${JSON.stringify(propName)}, expected: ${JSON.stringify(propDef.type)}, actual: "undefined" });`,
      );
      lines.push(`  } else if (!(${typeCheck})) {`);
      lines.push(
        `    errors.push({ path: ${JSON.stringify(propName)}, expected: ${JSON.stringify(propDef.type)}, actual: typeof ${accessor} });`,
      );
      lines.push(`  }`);
    }
  }

  lines.push(
    `  return errors.length === 0 ? { success: true, data: input } : { success: false, errors: errors };`,
  );
  lines.push(`}`);
  return lines.join("\n");
}

function generateTypeCheck(
  expr: string,
  typeStr: string,
  registry?: Map<string, TypeMetadata>,
): string {
  typeStr = typeStr.trim();

  // Union types: "string | number"
  const unionParts = splitUnionType(typeStr);
  if (unionParts.length > 1) {
    const checks = unionParts.map((p) =>
      generateTypeCheck(expr, p.trim(), registry),
    );
    return `(${checks.join(" || ")})`;
  }

  // Array shorthand: "string[]"
  if (typeStr.endsWith("[]")) {
    const elementType = typeStr.slice(0, -2).trim();
    return `(Array.isArray(${expr}) && ${expr}.every(function(item) { return ${generateTypeCheck("item", elementType, registry)}; }))`;
  }

  // Array generic: "Array<string>"
  const arrayGenericMatch = typeStr.match(/^Array<(.+)>$/);
  if (arrayGenericMatch) {
    const elementType = arrayGenericMatch[1].trim();
    return `(Array.isArray(${expr}) && ${expr}.every(function(item) { return ${generateTypeCheck("item", elementType, registry)}; }))`;
  }

  // Record<K, V>
  const recordMatch = typeStr.match(/^Record<(.+),\s*(.+)>$/);
  if (recordMatch) {
    const valueType = recordMatch[2].trim();
    return `(typeof ${expr} === "object" && ${expr} !== null && !Array.isArray(${expr}) && Object.values(${expr}).every(function(v) { return ${generateTypeCheck("v", valueType, registry)}; }))`;
  }

  // Template literal types: `prefix_${string}`
  if (typeStr.startsWith("`") && typeStr.endsWith("`")) {
    const pattern = buildTemplateLiteralRegex(typeStr.slice(1, -1));
    return `(typeof ${expr} === "string" && /^${pattern}$/.test(${expr}))`;
  }

  // Primitive types
  switch (typeStr) {
    case "string":
      return `typeof ${expr} === "string"`;
    case "number":
      return `(typeof ${expr} === "number" && !isNaN(${expr}))`;
    case "boolean":
      return `typeof ${expr} === "boolean"`;
    case "null":
      return `${expr} === null`;
    case "undefined":
    case "void":
      return `${expr} === undefined`;
    case "any":
    case "unknown":
      return `true`;
    case "never":
      return `false`;
    case "bigint":
      return `typeof ${expr} === "bigint"`;
    case "symbol":
      return `typeof ${expr} === "symbol"`;
    case "object":
      return `(typeof ${expr} === "object" && ${expr} !== null)`;
    case "Date":
      return `(${expr} instanceof Date)`;
    default:
      // Reference type or unknown — validate as non-null object
      return `(typeof ${expr} === "object" && ${expr} !== null)`;
  }
}

/**
 * Split a type string on top-level `|` characters,
 * respecting generics `<>`, parens `()`, braces `{}`, and backtick literals.
 */
function splitUnionType(typeStr: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let inBacktick = false;

  for (let i = 0; i < typeStr.length; i++) {
    const ch = typeStr[i];
    if (ch === "`") {
      inBacktick = !inBacktick;
    }
    if (!inBacktick) {
      if (ch === "<" || ch === "(" || ch === "{") depth++;
      if (ch === ">" || ch === ")" || ch === "}") depth--;
      if (ch === "|" && depth === 0) {
        parts.push(current.trim());
        current = "";
        continue;
      }
    }
    current += ch;
  }
  if (current.trim()) {
    parts.push(current.trim());
  }
  return parts;
}

/**
 * Convert a template literal body (without surrounding backticks)
 * into a JavaScript RegExp pattern string.
 * Handles `${string}`, `${number}`, and literal characters.
 */
function buildTemplateLiteralRegex(inner: string): string {
  let pattern = "";
  let i = 0;
  while (i < inner.length) {
    if (inner[i] === "$" && inner[i + 1] === "{") {
      const end = inner.indexOf("}", i + 2);
      if (end !== -1) {
        const placeholder = inner.slice(i + 2, end);
        switch (placeholder) {
          case "string":
            pattern += ".*";
            break;
          case "number":
            pattern += "[0-9]+(?:\\.[0-9]+)?";
            break;
          default:
            pattern += ".*";
            break;
        }
        i = end + 1;
        continue;
      }
    }
    // Escape regex-special characters
    if (/[.*+?^${}()|[\]\\]/.test(inner[i])) {
      pattern += "\\" + inner[i];
    } else {
      pattern += inner[i];
    }
    i++;
  }
  return pattern;
}
