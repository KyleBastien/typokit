import type {
  GeneratedOutput,
  MigrationDraft,
  SchemaTypeMap,
} from "@typokit/types";

/**
 * Represents the current state of a database schema,
 * used by adapters to compute diffs against TypoKit types.
 */
export interface DatabaseState {
  tables: Record<string, TableState>;
}

export interface TableState {
  columns: Record<string, ColumnState>;
}

export interface ColumnState {
  type: string;
  nullable: boolean;
}

/**
 * Every database adapter implements this interface.
 * See typokit-arch.md Section 7.3.
 */
export interface DatabaseAdapter {
  /** Generate DB schema artifacts from TypoKit types */
  generate(types: SchemaTypeMap): GeneratedOutput[];

  /** Diff current DB state against types, produce migration draft */
  diff(types: SchemaTypeMap, currentState: DatabaseState): MigrationDraft;

  /** Generate typed repository helpers (optional — adapters can skip this) */
  generateRepositories?(types: SchemaTypeMap): GeneratedOutput[];
}
