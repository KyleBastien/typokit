// @typokit/db-prisma — Prisma Schema Generation
import type {
  SchemaTypeMap,
  GeneratedOutput,
  MigrationDraft,
  SchemaChange,
} from "@typokit/types";
import type { DatabaseAdapter, DatabaseState } from "@typokit/core";

export interface PrismaAdapterOptions {
  provider?: PrismaProvider;
  outputDir?: string;
}

export type PrismaProvider = "postgresql" | "sqlite";

// ─── Helpers ─────────────────────────────────────────────────

function toSnakeCase(str: string): string {
  return str
    .replace(/([A-Z])/g, (_, letter, index) =>
      index === 0 ? letter.toLowerCase() : `_${letter.toLowerCase()}`,
    )
    .replace(/__+/g, "_");
}

function pluralize(str: string): string {
  if (str.endsWith("s")) return str;
  if (str.endsWith("y") && !/[aeiou]y$/i.test(str))
    return str.slice(0, -1) + "ies";
  return str + "s";
}

function toTableName(typeName: string, jsdoc?: Record<string, string>): string {
  if (jsdoc?.table) return jsdoc.table;
  return pluralize(toSnakeCase(typeName));
}

function toColumnName(propName: string): string {
  return toSnakeCase(propName);
}

/** Parse string union type like `"a" | "b" | "c"` into values */
export function parseUnionValues(typeStr: string): string[] | null {
  const trimmed = typeStr.trim();
  if (!trimmed.includes("|")) return null;

  const parts = trimmed.split("|").map((p) => p.trim());
  const values: string[] = [];
  for (const part of parts) {
    const match = /^"([^"]*)"$/.exec(part);
    if (!match) return null;
    values.push(match[1]);
  }
  return values.length > 0 ? values : null;
}

function toPascalCase(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function toEnumName(typeName: string, propName: string): string {
  return `${typeName}${toPascalCase(propName)}`;
}

// ─── Prisma Type Mapping ────────────────────────────────────

interface PrismaFieldInfo {
  line: string;
  enumDef?: { name: string; values: string[] };
}

function mapPrismaField(
  propName: string,
  prop: { type: string; optional: boolean; jsdoc?: Record<string, string> },
  typeName: string,
  _provider: PrismaProvider,
): PrismaFieldInfo {
  const col = toColumnName(propName);
  const jsdoc = prop.jsdoc ?? {};
  const attrs: string[] = [];
  let prismaType: string;
  let enumDef: PrismaFieldInfo["enumDef"] | undefined;

  // Check for union → enum
  const unionValues = parseUnionValues(prop.type);
  if (unionValues) {
    const enumName = toEnumName(typeName, propName);
    enumDef = { name: enumName, values: unionValues };
    prismaType = enumName;
  } else if (
    prop.type === "string" &&
    (jsdoc.id !== undefined || jsdoc.generated === "uuid")
  ) {
    prismaType = "String";
  } else if (prop.type === "string") {
    prismaType = "String";
  } else if (prop.type === "number") {
    prismaType = "Int";
  } else if (prop.type === "bigint") {
    prismaType = "BigInt";
  } else if (prop.type === "boolean") {
    prismaType = "Boolean";
  } else if (prop.type === "Date") {
    prismaType = "DateTime";
  } else {
    // object, Record, unknown → Json
    prismaType = "Json";
  }

  // Optional marker
  if (prop.optional) {
    prismaType += "?";
  }

  // @id
  if (jsdoc.id !== undefined) {
    attrs.push("@id");
  }

  // @default
  if (jsdoc.generated === "uuid") {
    attrs.push("@default(uuid())");
  } else if (jsdoc.generated === "now") {
    attrs.push("@default(now())");
  } else if (jsdoc.generated === "autoincrement") {
    attrs.push("@default(autoincrement())");
  } else if (jsdoc.default !== undefined) {
    const defaultVal = jsdoc.default.replace(/^["']|["']$/g, "");
    if (/^\d+$/.test(defaultVal)) {
      attrs.push(`@default(${defaultVal})`);
    } else if (defaultVal === "true" || defaultVal === "false") {
      attrs.push(`@default(${defaultVal})`);
    } else if (unionValues) {
      attrs.push(`@default(${defaultVal})`);
    } else {
      attrs.push(`@default("${defaultVal}")`);
    }
  }

  // @unique
  if (jsdoc.unique !== undefined) {
    attrs.push("@unique");
  }

  // @updatedAt
  if (jsdoc.onUpdate === "now") {
    attrs.push("@updatedAt");
  }

  // @map for column name mapping
  if (col !== propName) {
    attrs.push(`@map("${col}")`);
  }

  const attrStr = attrs.length > 0 ? " " + attrs.join(" ") : "";
  const line = `  ${propName} ${prismaType}${attrStr}`;

  return { line, enumDef };
}

// ─── Code Generation ────────────────────────────────────────

function generatePrismaSchema(
  types: SchemaTypeMap,
  provider: PrismaProvider,
): GeneratedOutput {
  const enumDefs: Array<{ name: string; values: string[] }> = [];
  const models: string[] = [];

  for (const [typeName, meta] of Object.entries(types)) {
    const tableName = toTableName(typeName, meta.jsdoc);
    const fields: string[] = [];

    for (const [propName, prop] of Object.entries(meta.properties)) {
      const fieldInfo = mapPrismaField(propName, prop, typeName, provider);
      fields.push(fieldInfo.line);
      if (fieldInfo.enumDef) {
        // Only add if not already defined
        if (!enumDefs.some((e) => e.name === fieldInfo.enumDef!.name)) {
          enumDefs.push(fieldInfo.enumDef);
        }
      }
    }

    let model = `model ${typeName} {\n`;
    model += fields.join("\n") + "\n";
    // @@map for table name
    if (tableName !== typeName) {
      model += `\n  @@map("${tableName}")\n`;
    }
    model += "}";
    models.push(model);
  }

  let content = `// AUTO-GENERATED by @typokit/db-prisma\n`;
  content += `// Do not edit manually — modify the source type instead\n\n`;

  // Datasource
  content += `datasource db {\n`;
  content += `  provider = "${provider}"\n`;
  content += `  url      = env("DATABASE_URL")\n`;
  content += `}\n\n`;

  // Generator
  content += `generator client {\n`;
  content += `  provider = "prisma-client-js"\n`;
  content += `}\n`;

  // Enums
  for (const e of enumDefs) {
    content += `\nenum ${e.name} {\n`;
    for (const val of e.values) {
      content += `  ${val}\n`;
    }
    content += "}\n";
  }

  // Models
  for (const model of models) {
    content += "\n" + model + "\n";
  }

  return {
    filePath: "schema.prisma",
    content,
    overwrite: true,
  };
}

// ─── Diff Logic ─────────────────────────────────────────────

function diffTypes(
  types: SchemaTypeMap,
  currentState: DatabaseState,
): SchemaChange[] {
  const changes: SchemaChange[] = [];

  for (const [typeName, meta] of Object.entries(types)) {
    const tableName = toTableName(typeName, meta.jsdoc);
    const existing = currentState.tables[tableName];

    if (!existing) {
      changes.push({ type: "add", entity: tableName });
      continue;
    }

    for (const [propName, prop] of Object.entries(meta.properties)) {
      const colName = toColumnName(propName);
      const existingCol = existing.columns[colName];

      if (!existingCol) {
        changes.push({
          type: "add",
          entity: tableName,
          field: colName,
          details: { tsType: prop.type },
        });
      } else {
        const nullable = prop.optional;
        if (existingCol.nullable !== nullable) {
          changes.push({
            type: "modify",
            entity: tableName,
            field: colName,
            details: {
              nullableFrom: existingCol.nullable,
              nullableTo: nullable,
            },
          });
        }
      }
    }

    // Detect removed columns
    for (const colName of Object.keys(existing.columns)) {
      const hasProp = Object.keys(meta.properties).some(
        (p) => toColumnName(p) === colName,
      );
      if (!hasProp) {
        changes.push({ type: "remove", entity: tableName, field: colName });
      }
    }
  }

  // Detect removed tables
  for (const tableName of Object.keys(currentState.tables)) {
    const hasType = Object.entries(types).some(
      ([name, meta]) => toTableName(name, meta.jsdoc) === tableName,
    );
    if (!hasType) {
      changes.push({ type: "remove", entity: tableName });
    }
  }

  return changes;
}

function generateMigrationSql(
  changes: SchemaChange[],
  provider: PrismaProvider,
): string {
  const lines: string[] = [];

  for (const change of changes) {
    if (change.type === "add" && !change.field) {
      lines.push(`-- TODO: CREATE TABLE "${change.entity}" (define columns)`);
    } else if (change.type === "add" && change.field) {
      lines.push(
        `ALTER TABLE "${change.entity}" ADD COLUMN "${change.field}" TEXT;`,
      );
    } else if (change.type === "remove" && !change.field) {
      lines.push(`DROP TABLE IF EXISTS "${change.entity}";`);
    } else if (change.type === "remove" && change.field) {
      if (provider === "postgresql") {
        lines.push(
          `ALTER TABLE "${change.entity}" DROP COLUMN "${change.field}";`,
        );
      } else {
        lines.push(
          `-- SQLite: cannot DROP COLUMN "${change.field}" from "${change.entity}" — recreate table`,
        );
      }
    } else if (change.type === "modify") {
      lines.push(
        `-- TODO: ALTER TABLE "${change.entity}" modify column "${change.field}"`,
      );
    }
  }

  return lines.join("\n");
}

// ─── Adapter ────────────────────────────────────────────────

export class PrismaDatabaseAdapter implements DatabaseAdapter {
  private readonly provider: PrismaProvider;
  private readonly outputDir: string;

  constructor(options?: PrismaAdapterOptions) {
    this.provider = options?.provider ?? "postgresql";
    this.outputDir = options?.outputDir ?? "prisma";
  }

  generate(types: SchemaTypeMap): GeneratedOutput[] {
    const output = generatePrismaSchema(types, this.provider);
    output.filePath = `${this.outputDir}/${output.filePath}`;
    return [output];
  }

  diff(types: SchemaTypeMap, currentState: DatabaseState): MigrationDraft {
    const changes = diffTypes(types, currentState);
    const destructive = changes.some((c) => c.type === "remove");
    const sql = generateMigrationSql(changes, this.provider);
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:T]/g, "")
      .slice(0, 14);

    return {
      name: `${timestamp}_schema_update`,
      sql,
      destructive,
      changes,
    };
  }
}
