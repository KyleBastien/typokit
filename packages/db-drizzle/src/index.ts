// @typokit/db-drizzle — Drizzle Schema Generation
import type {
  SchemaTypeMap,
  TypeMetadata,
  GeneratedOutput,
  MigrationDraft,
  SchemaChange,
} from "@typokit/types";
import type { DatabaseAdapter, DatabaseState } from "@typokit/core";

export type DrizzleDialect = "postgresql" | "sqlite";

export interface DrizzleAdapterOptions {
  dialect?: DrizzleDialect;
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
  if (str.endsWith("y") && !/[aeiou]y$/i.test(str)) return str.slice(0, -1) + "ies";
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

function toEnumVarName(typeName: string, propName: string): string {
  const base = typeName.charAt(0).toLowerCase() + typeName.slice(1);
  return `${base}${propName.charAt(0).toUpperCase() + propName.slice(1)}Enum`;
}

// ─── PostgreSQL Column Mapping ──────────────────────────────

interface ColumnInfo {
  drizzleCall: string;
  imports: Set<string>;
  enumDef?: { varName: string; dbName: string; values: string[] };
}

function mapPgColumn(
  propName: string,
  prop: { type: string; optional: boolean; jsdoc?: Record<string, string> },
  typeName: string,
): ColumnInfo {
  const col = toColumnName(propName);
  const jsdoc = prop.jsdoc ?? {};
  const imports = new Set<string>();
  let call: string;
  let enumDef: ColumnInfo["enumDef"] | undefined;

  // Check for union → pgEnum
  const unionValues = parseUnionValues(prop.type);
  if (unionValues) {
    const enumVarName = toEnumVarName(typeName, propName);
    const enumDbName = toEnumName(typeName, propName);
    imports.add("pgEnum");
    enumDef = { varName: enumVarName, dbName: enumDbName, values: unionValues };
    call = `${enumVarName}("${col}")`;
  } else if (prop.type === "string" && (jsdoc.id !== undefined || jsdoc.generated === "uuid")) {
    imports.add("uuid");
    call = `uuid("${col}")`;
  } else if (prop.type === "string" && jsdoc.maxLength) {
    imports.add("varchar");
    call = `varchar("${col}", { length: ${jsdoc.maxLength} })`;
  } else if (prop.type === "string" && jsdoc.format === "email") {
    imports.add("varchar");
    call = `varchar("${col}", { length: 255 })`;
  } else if (prop.type === "string") {
    imports.add("text");
    call = `text("${col}")`;
  } else if (prop.type === "number") {
    imports.add("integer");
    call = `integer("${col}")`;
  } else if (prop.type === "bigint") {
    imports.add("bigint");
    call = `bigint("${col}", { mode: "number" })`;
  } else if (prop.type === "boolean") {
    imports.add("boolean");
    call = `boolean("${col}")`;
  } else if (prop.type === "Date") {
    imports.add("timestamp");
    call = `timestamp("${col}")`;
  } else {
    // object, Record, unknown → jsonb
    imports.add("jsonb");
    call = `jsonb("${col}")`;
  }

  // Apply constraints
  if (jsdoc.generated === "uuid") {
    call += ".defaultRandom()";
  }
  if (jsdoc.generated === "now" || jsdoc.onUpdate === "now") {
    call += ".defaultNow()";
  }
  if (jsdoc.id !== undefined) {
    call += ".primaryKey()";
  }
  if (!prop.optional) {
    call += ".notNull()";
  }
  if (jsdoc.unique !== undefined) {
    call += ".unique()";
  }
  if (jsdoc.default !== undefined && jsdoc.generated === undefined) {
    const defaultVal = jsdoc.default;
    // Numeric defaults
    if (/^\d+$/.test(defaultVal)) {
      call += `.default(${defaultVal})`;
    } else {
      // Remove surrounding quotes if present
      const cleaned = defaultVal.replace(/^["']|["']$/g, "");
      call += `.default("${cleaned}")`;
    }
  }

  return { drizzleCall: call, imports, enumDef };
}

// ─── SQLite Column Mapping ──────────────────────────────────

function mapSqliteColumn(
  propName: string,
  prop: { type: string; optional: boolean; jsdoc?: Record<string, string> },
): ColumnInfo {
  const col = toColumnName(propName);
  const jsdoc = prop.jsdoc ?? {};
  const imports = new Set<string>();
  let call: string;

  if (prop.type === "number" || prop.type === "bigint") {
    imports.add("integer");
    call = `integer("${col}")`;
  } else if (prop.type === "boolean") {
    imports.add("integer");
    call = `integer("${col}", { mode: "boolean" })`;
  } else if (
    prop.type === "Date" ||
    prop.type === "object" ||
    prop.type.startsWith("Record<") ||
    parseUnionValues(prop.type)
  ) {
    imports.add("text");
    call = `text("${col}")`;
  } else {
    imports.add("text");
    call = `text("${col}")`;
  }

  if (jsdoc.id !== undefined) {
    call += ".primaryKey()";
  }
  if (!prop.optional) {
    call += ".notNull()";
  }
  if (jsdoc.unique !== undefined) {
    call += ".unique()";
  }
  if (jsdoc.default !== undefined) {
    const defaultVal = jsdoc.default.replace(/^["']|["']$/g, "");
    call += `.default("${defaultVal}")`;
  }

  return { drizzleCall: call, imports };
}

// ─── Code Generation ────────────────────────────────────────

function generatePgFile(typeName: string, meta: TypeMetadata): GeneratedOutput {
  const tableName = toTableName(typeName, meta.jsdoc);
  const tableVarName = tableName;

  const allImports = new Set<string>(["pgTable"]);
  const enumDefs: Array<{ varName: string; dbName: string; values: string[] }> = [];
  const columns: Array<{ name: string; call: string }> = [];

  for (const [propName, prop] of Object.entries(meta.properties)) {
    const col = mapPgColumn(propName, prop, typeName);
    for (const imp of col.imports) allImports.add(imp);
    if (col.enumDef) enumDefs.push(col.enumDef);
    columns.push({ name: propName, call: col.drizzleCall });
  }

  const importList = Array.from(allImports).sort().join(", ");

  let code = `// AUTO-GENERATED by @typokit/db-drizzle from ${typeName} type\n`;
  code += `// Do not edit manually — modify the source type instead\n\n`;
  code += `import { ${importList} } from "drizzle-orm/pg-core";\n`;

  // Enum definitions
  for (const e of enumDefs) {
    code += `\nexport const ${e.varName} = pgEnum("${e.dbName}", [${e.values.map((v) => `"${v}"`).join(", ")}]);\n`;
  }

  // Table definition
  code += `\nexport const ${tableVarName} = pgTable("${tableName}", {\n`;
  const columnLines = columns.map((c) => `  ${c.name}: ${c.call},`);
  code += columnLines.join("\n") + "\n";
  code += "});\n";

  return {
    filePath: `${tableName}.ts`,
    content: code,
    overwrite: true,
  };
}

function generateSqliteFile(typeName: string, meta: TypeMetadata): GeneratedOutput {
  const tableName = toTableName(typeName, meta.jsdoc);
  const tableVarName = tableName;

  const allImports = new Set<string>(["sqliteTable"]);
  const columns: Array<{ name: string; call: string }> = [];

  for (const [propName, prop] of Object.entries(meta.properties)) {
    const col = mapSqliteColumn(propName, prop);
    for (const imp of col.imports) allImports.add(imp);
    columns.push({ name: propName, call: col.drizzleCall });
  }

  const importList = Array.from(allImports).sort().join(", ");

  let code = `// AUTO-GENERATED by @typokit/db-drizzle from ${typeName} type\n`;
  code += `// Do not edit manually — modify the source type instead\n\n`;
  code += `import { ${importList} } from "drizzle-orm/sqlite-core";\n`;

  code += `\nexport const ${tableVarName} = sqliteTable("${tableName}", {\n`;
  const columnLines = columns.map((c) => `  ${c.name}: ${c.call},`);
  code += columnLines.join("\n") + "\n";
  code += "});\n";

  return {
    filePath: `${tableName}.ts`,
    content: code,
    overwrite: true,
  };
}

// ─── Diff Logic ─────────────────────────────────────────────

function diffTypes(types: SchemaTypeMap, currentState: DatabaseState): SchemaChange[] {
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
        changes.push({ type: "add", entity: tableName, field: colName, details: { tsType: prop.type } });
      } else {
        const nullable = prop.optional;
        if (existingCol.nullable !== nullable) {
          changes.push({
            type: "modify",
            entity: tableName,
            field: colName,
            details: { nullableFrom: existingCol.nullable, nullableTo: nullable },
          });
        }
      }
    }

    // Detect removed columns
    for (const colName of Object.keys(existing.columns)) {
      const hasProp = Object.keys(meta.properties).some((p) => toColumnName(p) === colName);
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

function generateMigrationSql(changes: SchemaChange[], dialect: DrizzleDialect): string {
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
      if (dialect === "postgresql") {
        lines.push(
          `ALTER TABLE "${change.entity}" DROP COLUMN "${change.field}";`,
        );
      } else {
        lines.push(`-- SQLite: cannot DROP COLUMN "${change.field}" from "${change.entity}" — recreate table`);
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

export class DrizzleDatabaseAdapter implements DatabaseAdapter {
  private readonly dialect: DrizzleDialect;
  private readonly outputDir: string;

  constructor(options?: DrizzleAdapterOptions) {
    this.dialect = options?.dialect ?? "postgresql";
    this.outputDir = options?.outputDir ?? "drizzle";
  }

  generate(types: SchemaTypeMap): GeneratedOutput[] {
    const outputs: GeneratedOutput[] = [];
    const genFn = this.dialect === "postgresql" ? generatePgFile : generateSqliteFile;

    for (const [typeName, meta] of Object.entries(types)) {
      const output = genFn(typeName, meta);
      output.filePath = `${this.outputDir}/${output.filePath}`;
      outputs.push(output);
    }

    return outputs;
  }

  diff(types: SchemaTypeMap, currentState: DatabaseState): MigrationDraft {
    const changes = diffTypes(types, currentState);
    const destructive = changes.some((c) => c.type === "remove");
    const sql = generateMigrationSql(changes, this.dialect);
    const timestamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);

    return {
      name: `${timestamp}_schema_update`,
      sql,
      destructive,
      changes,
    };
  }
}

