// @typokit/db-raw — Raw SQL DDL Generation
import type {
  SchemaTypeMap,
  TypeMetadata,
  GeneratedOutput,
  MigrationDraft,
  SchemaChange,
} from "@typokit/types";
import type { DatabaseAdapter, DatabaseState } from "@typokit/core";

export type RawSqlDialect = "postgresql" | "sqlite";

export interface RawSqlAdapterOptions {
  dialect?: RawSqlDialect;
  outputDir?: string;
}

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

function toEnumName(typeName: string, propName: string): string {
  return `${toSnakeCase(typeName)}_${toSnakeCase(propName)}`;
}

// ─── PostgreSQL Column Mapping ──────────────────────────────

function mapPgColumnType(prop: {
  type: string;
  optional: boolean;
  jsdoc?: Record<string, string>;
}): string {
  const jsdoc = prop.jsdoc ?? {};

  if (
    prop.type === "string" &&
    (jsdoc.id !== undefined || jsdoc.generated === "uuid")
  ) {
    return "UUID";
  }
  if (prop.type === "string" && jsdoc.maxLength) {
    return `VARCHAR(${jsdoc.maxLength})`;
  }
  if (prop.type === "string" && jsdoc.format === "email") {
    return "VARCHAR(255)";
  }
  if (prop.type === "string") {
    return "TEXT";
  }
  if (prop.type === "number") {
    return "INTEGER";
  }
  if (prop.type === "bigint") {
    return "BIGINT";
  }
  if (prop.type === "boolean") {
    return "BOOLEAN";
  }
  if (prop.type === "Date") {
    return "TIMESTAMPTZ";
  }
  // object, Record, unknown → JSONB
  return "JSONB";
}

function mapSqliteColumnType(prop: {
  type: string;
  optional: boolean;
  jsdoc?: Record<string, string>;
}): string {
  if (prop.type === "number" || prop.type === "bigint") {
    return "INTEGER";
  }
  if (prop.type === "boolean") {
    return "INTEGER";
  }
  // string, Date, object, Record, enum unions → TEXT
  return "TEXT";
}

// ─── PostgreSQL DDL Generation ──────────────────────────────

interface EnumDef {
  name: string;
  values: string[];
}

function generatePgDdl(
  typeName: string,
  meta: TypeMetadata,
): { ddl: string; enums: EnumDef[] } {
  const tableName = toTableName(typeName, meta.jsdoc);
  const enums: EnumDef[] = [];
  const columns: string[] = [];

  for (const [propName, prop] of Object.entries(meta.properties)) {
    const col = toColumnName(propName);
    const jsdoc = prop.jsdoc ?? {};
    const parts: string[] = [col];

    // Check for union → CREATE TYPE enum
    const unionValues = parseUnionValues(prop.type);
    if (unionValues) {
      const enumName = toEnumName(typeName, propName);
      enums.push({ name: enumName, values: unionValues });
      parts.push(enumName);
    } else {
      parts.push(mapPgColumnType(prop));
    }

    // NOT NULL
    if (!prop.optional) {
      parts.push("NOT NULL");
    }

    // PRIMARY KEY
    if (jsdoc.id !== undefined) {
      parts.push("PRIMARY KEY");
    }

    // UNIQUE
    if (jsdoc.unique !== undefined) {
      parts.push("UNIQUE");
    }

    // DEFAULT
    if (jsdoc.generated === "uuid") {
      parts.push("DEFAULT gen_random_uuid()");
    } else if (jsdoc.generated === "now" || jsdoc.onUpdate === "now") {
      parts.push("DEFAULT now()");
    } else if (jsdoc.default !== undefined) {
      const defaultVal = jsdoc.default.replace(/^["']|["']$/g, "");
      if (/^\d+$/.test(defaultVal)) {
        parts.push(`DEFAULT ${defaultVal}`);
      } else if (defaultVal === "true" || defaultVal === "false") {
        parts.push(`DEFAULT ${defaultVal}`);
      } else {
        parts.push(`DEFAULT '${defaultVal}'`);
      }
    }

    columns.push("  " + parts.join(" "));
  }

  let ddl = "";

  // Enum type definitions
  for (const e of enums) {
    ddl += `CREATE TYPE ${e.name} AS ENUM (${e.values.map((v) => `'${v}'`).join(", ")});\n\n`;
  }

  // Table definition
  ddl += `CREATE TABLE ${tableName} (\n`;
  ddl += columns.join(",\n") + "\n";
  ddl += ");";

  return { ddl, enums };
}

// ─── SQLite DDL Generation ──────────────────────────────────

function generateSqliteDdl(typeName: string, meta: TypeMetadata): string {
  const tableName = toTableName(typeName, meta.jsdoc);
  const columns: string[] = [];

  for (const [propName, prop] of Object.entries(meta.properties)) {
    const col = toColumnName(propName);
    const jsdoc = prop.jsdoc ?? {};
    const parts: string[] = [col];

    parts.push(mapSqliteColumnType(prop));

    // NOT NULL
    if (!prop.optional) {
      parts.push("NOT NULL");
    }

    // PRIMARY KEY
    if (jsdoc.id !== undefined) {
      parts.push("PRIMARY KEY");
    }

    // UNIQUE
    if (jsdoc.unique !== undefined) {
      parts.push("UNIQUE");
    }

    // DEFAULT
    if (jsdoc.default !== undefined) {
      const defaultVal = jsdoc.default.replace(/^["']|["']$/g, "");
      if (/^\d+$/.test(defaultVal)) {
        parts.push(`DEFAULT ${defaultVal}`);
      } else if (defaultVal === "true" || defaultVal === "false") {
        parts.push(`DEFAULT ${defaultVal === "true" ? "1" : "0"}`);
      } else {
        parts.push(`DEFAULT '${defaultVal}'`);
      }
    }

    columns.push("  " + parts.join(" "));
  }

  let ddl = `CREATE TABLE ${tableName} (\n`;
  ddl += columns.join(",\n") + "\n";
  ddl += ");";

  return ddl;
}

// ─── TypeScript Interface Generation ────────────────────────

function tsTypeFromProp(prop: { type: string; optional: boolean }): string {
  const unionValues = parseUnionValues(prop.type);
  if (unionValues) {
    return unionValues.map((v) => `"${v}"`).join(" | ");
  }
  return prop.type;
}

function generateTypeScriptInterface(
  typeName: string,
  meta: TypeMetadata,
): string {
  const lines: string[] = [];
  lines.push(`export interface ${typeName} {`);

  for (const [propName, prop] of Object.entries(meta.properties)) {
    const tsType = tsTypeFromProp(prop);
    const opt = prop.optional ? "?" : "";
    lines.push(`  ${propName}${opt}: ${tsType};`);
  }

  lines.push("}");
  return lines.join("\n");
}

// ─── Full File Generation ───────────────────────────────────

function generatePgFile(typeName: string, meta: TypeMetadata): GeneratedOutput {
  const tableName = toTableName(typeName, meta.jsdoc);
  const { ddl } = generatePgDdl(typeName, meta);

  let content = `-- AUTO-GENERATED by @typokit/db-raw from ${typeName} type\n`;
  content += `-- Do not edit manually — modify the source type instead\n\n`;
  content += ddl + "\n";

  return {
    filePath: `${tableName}.sql`,
    content,
    overwrite: true,
  };
}

function generatePgTypesFile(types: SchemaTypeMap): GeneratedOutput {
  let content = `// AUTO-GENERATED by @typokit/db-raw\n`;
  content += `// Do not edit manually — modify the source types instead\n\n`;

  const interfaces: string[] = [];
  for (const [typeName, meta] of Object.entries(types)) {
    interfaces.push(generateTypeScriptInterface(typeName, meta));
  }

  content += interfaces.join("\n\n") + "\n";

  return {
    filePath: "types.ts",
    content,
    overwrite: true,
  };
}

function generateSqliteFile(
  typeName: string,
  meta: TypeMetadata,
): GeneratedOutput {
  const tableName = toTableName(typeName, meta.jsdoc);
  const ddl = generateSqliteDdl(typeName, meta);

  let content = `-- AUTO-GENERATED by @typokit/db-raw from ${typeName} type\n`;
  content += `-- Do not edit manually — modify the source type instead\n\n`;
  content += ddl + "\n";

  return {
    filePath: `${tableName}.sql`,
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
  dialect: RawSqlDialect,
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
      lines.push(`-- DESTRUCTIVE: requires review`);
      lines.push(`DROP TABLE IF EXISTS "${change.entity}";`);
    } else if (change.type === "remove" && change.field) {
      lines.push(`-- DESTRUCTIVE: requires review`);
      if (dialect === "postgresql") {
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

export class RawSqlDatabaseAdapter implements DatabaseAdapter {
  private readonly dialect: RawSqlDialect;
  private readonly outputDir: string;

  constructor(options?: RawSqlAdapterOptions) {
    this.dialect = options?.dialect ?? "postgresql";
    this.outputDir = options?.outputDir ?? "sql";
  }

  generate(types: SchemaTypeMap): GeneratedOutput[] {
    const outputs: GeneratedOutput[] = [];
    const genFn =
      this.dialect === "postgresql" ? generatePgFile : generateSqliteFile;

    for (const [typeName, meta] of Object.entries(types)) {
      const output = genFn(typeName, meta);
      output.filePath = `${this.outputDir}/${output.filePath}`;
      outputs.push(output);
    }

    // Generate TypeScript interfaces file
    const tsOutput = generatePgTypesFile(types);
    tsOutput.filePath = `${this.outputDir}/${tsOutput.filePath}`;
    outputs.push(tsOutput);

    return outputs;
  }

  diff(types: SchemaTypeMap, currentState: DatabaseState): MigrationDraft {
    const changes = diffTypes(types, currentState);
    const destructive = changes.some((c) => c.type === "remove");
    const sql = generateMigrationSql(changes, this.dialect);
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
