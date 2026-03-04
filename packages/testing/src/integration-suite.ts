// @typokit/testing — Integration Test Suite

import type { TypoKitApp } from "@typokit/core";
import type { TestClient } from "./index.js";
import { createTestClient } from "./index.js";

// ─── In-Memory Database ─────────────────────────────────────

/** A simple in-memory database for integration testing */
export interface InMemoryDatabase {
  /** Insert a record into a table */
  insert(table: string, record: Record<string, unknown>): void;

  /** Find all records in a table */
  findAll(table: string): Record<string, unknown>[];

  /** Find a record by id field */
  findById(table: string, id: string): Record<string, unknown> | undefined;

  /** Delete all records from a table */
  clearTable(table: string): void;

  /** Delete all records from all tables */
  clear(): void;

  /** Get the list of table names */
  tables(): string[];
}

function createInMemoryDatabase(): InMemoryDatabase {
  const store = new Map<string, Record<string, unknown>[]>();

  return {
    insert(table: string, record: Record<string, unknown>): void {
      if (!store.has(table)) {
        store.set(table, []);
      }
      // Clone the record to prevent shared references
      store.get(table)!.push({ ...record });
    },

    findAll(table: string): Record<string, unknown>[] {
      return (store.get(table) ?? []).map((r) => ({ ...r }));
    },

    findById(
      table: string,
      id: string,
    ): Record<string, unknown> | undefined {
      const records = store.get(table);
      if (!records) return undefined;
      const found = records.find((r) => r["id"] === id);
      return found ? { ...found } : undefined;
    },

    clearTable(table: string): void {
      store.delete(table);
    },

    clear(): void {
      store.clear();
    },

    tables(): string[] {
      return [...store.keys()];
    },
  };
}

// ─── Seed Data ──────────────────────────────────────────────

/** A seed function populates an in-memory database with test data */
export type SeedFn = (db: InMemoryDatabase) => void;

const seedRegistry = new Map<string, SeedFn>();

/** Register a named seed data fixture */
export function registerSeed(name: string, seed: SeedFn): void {
  seedRegistry.set(name, seed);
}

/** Get a registered seed function by name */
export function getSeed(name: string): SeedFn | undefined {
  return seedRegistry.get(name);
}

// ─── Integration Suite ──────────────────────────────────────

/** Options for creating an integration test suite */
export interface IntegrationSuiteOptions {
  /** Whether to spin up an in-memory database (default: false) */
  database?: boolean;

  /** Name of a registered seed data fixture to apply */
  seed?: string;
}

/** An integration test suite with managed server and database lifecycle */
export interface IntegrationSuite {
  /** Start the server and seed the database */
  setup(): Promise<void>;

  /** Stop the server and clean up */
  teardown(): Promise<void>;

  /** The typed test client (available after setup) */
  readonly client: TestClient;

  /** The in-memory database (null if database option is false) */
  readonly db: InMemoryDatabase | null;
}

/**
 * Create an integration test suite for a TypoKit application.
 *
 * Sets up an isolated server and optionally an in-memory database
 * with seeded test data. Each call creates a fully independent
 * instance with no shared mutable state.
 *
 * ```ts
 * const suite = createIntegrationSuite(app, {
 *   database: true,
 *   seed: "users",
 * });
 *
 * // In beforeEach / setup
 * await suite.setup();
 *
 * // In tests
 * const res = await suite.client.get("/users");
 *
 * // In afterEach / teardown
 * await suite.teardown();
 * ```
 */
export function createIntegrationSuite(
  app: TypoKitApp,
  options: IntegrationSuiteOptions = {},
): IntegrationSuite {
  let client: TestClient | null = null;
  let db: InMemoryDatabase | null = null;

  const suite: IntegrationSuite = {
    async setup(): Promise<void> {
      // Create a fresh in-memory database if requested
      if (options.database) {
        db = createInMemoryDatabase();

        // Apply seed data if specified
        if (options.seed) {
          const seedFn = getSeed(options.seed);
          if (!seedFn) {
            throw new Error(
              `Unknown seed fixture: "${options.seed}". Register it with registerSeed() first.`,
            );
          }
          seedFn(db);
        }
      }

      // Start the server and create a test client
      client = await createTestClient(app);
    },

    async teardown(): Promise<void> {
      // Close the test client / server
      if (client) {
        await client.close();
        client = null;
      }

      // Clear the database
      if (db) {
        db.clear();
        db = null;
      }
    },

    get client(): TestClient {
      if (!client) {
        throw new Error(
          "Integration suite not set up. Call suite.setup() first.",
        );
      }
      return client;
    },

    get db(): InMemoryDatabase | null {
      return db;
    },
  };

  return suite;
}
