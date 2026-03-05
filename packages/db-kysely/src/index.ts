// @typokit/db-kysely — Kysely Type Generation
import type {
  SchemaTypeMap,
  TypeMetadata,
  GeneratedOutput,
  MigrationDraft,
  SchemaChange,
} from "@typokit/types";
import type { DatabaseAdapter, DatabaseState } from "@typokit/core";

export type KyselyDialect = "postgresql" | "sqlite";

export interface KyselyAdapterOptions {
  dialect?: KyselyDialect;
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

// ─── PostgreSQL Column Type Mapping ─────────────────────────

function mapPgColumnType(prop: {
  type: string;
  optional: boolean;
  jsdoc?: Record<string, string>;
}): string {
  const jsdoc = prop.jsdoc ?? {};
  const unionValues = parseUnionValues(prop.type);

  let baseType: string;

  if (unionValues) {
    baseType = unionValues.map((v) => `"${v}"`).join(" | ");
  } else if (prop.type === "string") {
    baseType = "string";
  } else if (prop.type === "number") {
    baseType = "number";
  } else if (prop.type === "bigint") {
    baseType = "number";
  } else if (prop.type === "boolean") {
    baseType = "boolean";
  } else if (prop.type === "Date") {
    baseType = "Date";
  } else {
    // object, Record, unknown → unknown (JSON)
    baseType = "unknown";
  }

  // Wrap with Generated<T> if auto-generated
  const isGenerated = jsdoc.generated !== undefined;
  const hasDefault = jsdoc.default !== undefined;
  if (isGenerated || hasDefault) {
    return `Generated<${baseType}>`;
  }

  return baseType;
}

// ─── SQLite Column Type Mapping ─────────────────────────────

function mapSqliteColumnType(prop: {
  type: string;
  optional: boolean;
  jsdoc?: Record<string, string>;
}): string {
  const jsdoc = prop.jsdoc ?? {};

  let baseType: string;

  if (prop.type === "number" || prop.type === "bigint") {
    baseType = "number";
  } else if (prop.type === "boolean") {
    baseType = "number";
  } else if (prop.type === "Date") {
    baseType = "string";
  } else if (
    prop.type === "object" ||
    prop.type.startsWith("Record<") ||
    parseUnionValues(prop.type)
  ) {
    baseType = "string";
  } else {
    baseType = "string";
  }

  const isGenerated = jsdoc.generated !== undefined;
  const hasDefault = jsdoc.default !== undefined;
  if (isGenerated || hasDefault) {
    return `Generated<${baseType}>`;
  }

  return baseType;
}

// ─── Code Generation ────────────────────────────────────────

function generateTableInterface(
  typeName: string,
  meta: TypeMetadata,
  dialect: KyselyDialect,
): { interfaceName: string; code: string; needsGenerated: boolean } {
  const mapFn =
    dialect === "postgresql" ? mapPgColumnType : mapSqliteColumnType;
  let needsGenerated = false;

  const columns: Array<{ colName: string; tsType: string; optional: boolean }> =
    [];

  for (const [propName, prop] of Object.entries(meta.properties)) {
    const colName = toColumnName(propName);
    const tsType = mapFn(prop);
    if (tsType.startsWith("Generated<")) needsGenerated = true;
    columns.push({ colName, tsType, optional: prop.optional });
  }

  const interfaceName = `${typeName}Table`;

  let code = `export interface ${interfaceName} {\n`;
  for (const col of columns) {
    const nullSuffix = col.optional ? " | null" : "";
    code += `  ${col.colName}: ${col.tsType}${nullSuffix};\n`;
  }
  code += "}\n";

  return { interfaceName, code, needsGenerated };
}

function generateFile(
  types: SchemaTypeMap,
  dialect: KyselyDialect,
): GeneratedOutput {
  const tableInterfaces: Array<{
    tableName: string;
    interfaceName: string;
    code: string;
  }> = [];
  let needsGenerated = false;

  for (const [typeName, meta] of Object.entries(types)) {
    const tableName = toTableName(typeName, meta.jsdoc);
    const result = generateTableInterface(typeName, meta, dialect);
    if (result.needsGenerated) needsGenerated = true;
    tableInterfaces.push({
      tableName,
      interfaceName: result.interfaceName,
      code: result.code,
    });
  }

  let content = `// AUTO-GENERATED by @typokit/db-kysely\n`;
  content += `// Do not edit manually — modify the source type instead\n\n`;

  if (needsGenerated) {
    content += `import type { Generated } from "kysely";\n\n`;
  }

  // Emit table interfaces
  for (const ti of tableInterfaces) {
    content += ti.code + "\n";
  }

  // Emit Database interface
  content += `export interface Database {\n`;
  for (const ti of tableInterfaces) {
    content += `  ${ti.tableName}: ${ti.interfaceName};\n`;
  }
  content += "}\n";

  return {
    filePath: `database.ts`,
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
  dialect: KyselyDialect,
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

export class KyselyDatabaseAdapter implements DatabaseAdapter {
  private readonly dialect: KyselyDialect;
  private readonly outputDir: string;

  constructor(options?: KyselyAdapterOptions) {
    this.dialect = options?.dialect ?? "postgresql";
    this.outputDir = options?.outputDir ?? "kysely";
  }

  generate(types: SchemaTypeMap): GeneratedOutput[] {
    const output = generateFile(types, this.dialect);
    output.filePath = `${this.outputDir}/${output.filePath}`;
    return [output];
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
