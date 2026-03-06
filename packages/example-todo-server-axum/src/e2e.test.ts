// @typokit/example-todo-server-axum — E2E Tests with Real PostgreSQL Database
//
// Full lifecycle: create user → create todo → list todos by user → update todo → mark complete → delete todo
// Validates actual DB state: rows written, constraints enforced, enums stored correctly.
// Uses embedded-postgres to spin up a local PostgreSQL instance automatically.
// Spawns the compiled Rust binary as a child process for true end-to-end testing.

import { describe, it, expect, beforeAll, afterAll } from "@rstest/core";
import pg from "pg";
import EmbeddedPostgres from "embedded-postgres";
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { resolve, join, dirname } from "node:path";
import { existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { Client } = pg;

// ─── Embedded Postgres Config ────────────────────────────────

const PG_PORT = 5434;
const PG_USER = "postgres";
const PG_PASSWORD = "password";
const PG_DATABASE = "typokit_axum_e2e";
const SERVER_PORT = 3999;

let embeddedPg: EmbeddedPostgres;
let DATABASE_URL: string;

// ─── Migration SQL ───────────────────────────────────────────

const MIGRATION_CREATE_USERS = `
DO $$ BEGIN
    CREATE TYPE user_status AS ENUM ('active', 'suspended', 'deleted');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    status user_status NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);
`;

const MIGRATION_CREATE_TODOS = `
CREATE TABLE IF NOT EXISTS todos (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    completed BOOLEAN NOT NULL DEFAULT false,
    user_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);
`;

const DROP_SCHEMA_SQL = `
DROP TABLE IF EXISTS todos CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TYPE IF EXISTS user_status CASCADE;
`;

// ─── Helper: resolve binary path ─────────────────────────────

function getBinaryPath(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const projectRoot = resolve(currentDir, "..");
  const isWindows = process.platform === "win32";
  const binaryName = isWindows ? "server.exe" : "server";
  const debugPath = join(projectRoot, "target", "debug", binaryName);
  const releasePath = join(projectRoot, "target", "release", binaryName);

  if (existsSync(debugPath)) return debugPath;
  if (existsSync(releasePath)) return releasePath;

  // Try building
  execSync("cargo build", { cwd: projectRoot, stdio: "pipe" });

  if (existsSync(debugPath)) return debugPath;
  throw new Error(`Rust binary not found at ${debugPath} after cargo build`);
}

// ─── Helper: spawn server and wait for readiness ─────────────

async function spawnServer(
  port: number,
  databaseUrl: string,
): Promise<ChildProcess> {
  const binaryPath = getBinaryPath();
  const child = spawn(binaryPath, [], {
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: databaseUrl,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Wait for the server to be ready by polling
  const maxWaitMs = 15_000;
  const pollIntervalMs = 200;
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/users?page=1&pageSize=1`);
      if (res.ok || res.status === 404) return child;
    } catch {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  child.kill();
  throw new Error(`Server did not become ready within ${maxWaitMs}ms`);
}

// ─── Helper: make HTTP requests ──────────────────────────────

interface HttpResponse {
  status: number;
  body: unknown;
}

async function httpRequest(
  port: number,
  method: string,
  path: string,
  body?: unknown,
  query?: Record<string, string>,
): Promise<HttpResponse> {
  let url = `http://127.0.0.1:${port}${path}`;
  if (query && Object.keys(query).length > 0) {
    const params = new URLSearchParams(query);
    url += `?${params.toString()}`;
  }

  const headers: Record<string, string> = {};
  let bodyStr: string | undefined;
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    bodyStr = JSON.stringify(body);
  }

  const response = await fetch(url, { method, headers, body: bodyStr });
  const contentType = response.headers.get("content-type") ?? "";
  let responseBody: unknown;
  if (contentType.includes("application/json")) {
    responseBody = await response.json();
  } else {
    responseBody = await response.text();
  }
  return { status: response.status, body: responseBody };
}

// ─── E2E Test Suite ──────────────────────────────────────────

describe("E2E: Axum server full lifecycle with PostgreSQL", () => {
  let serverProcess: ChildProcess;

  beforeAll(async () => {
    try {
      // Clean up stale data from previous runs
      const dataDir = "./data/axum-e2e-db";
      if (existsSync(dataDir)) {
        rmSync(dataDir, { recursive: true, force: true });
      }

      // Start embedded PostgreSQL
      embeddedPg = new EmbeddedPostgres({
        databaseDir: "./data/axum-e2e-db",
        user: PG_USER,
        password: PG_PASSWORD,
        port: PG_PORT,
        persistent: false,
        onLog: () => {},
        onError: () => {},
      });
      await embeddedPg.initialise();
      await embeddedPg.start();
      await embeddedPg.createDatabase(PG_DATABASE);
      DATABASE_URL = `postgresql://${PG_USER}:${PG_PASSWORD}@localhost:${PG_PORT}/${PG_DATABASE}`;

      // Run migrations
      const migrationClient = new Client({ connectionString: DATABASE_URL });
      await migrationClient.connect();
      try {
        await migrationClient.query(DROP_SCHEMA_SQL);
        await migrationClient.query(MIGRATION_CREATE_USERS);
        await migrationClient.query(MIGRATION_CREATE_TODOS);
      } finally {
        await migrationClient.end();
      }

      // Spawn the Rust server
      serverProcess = await spawnServer(SERVER_PORT, DATABASE_URL);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`beforeAll setup failed: ${msg}`);
    }
  }, 60_000);

  afterAll(async () => {
    if (serverProcess) {
      serverProcess.kill();
    }
    await embeddedPg?.stop();
  }, 15_000);

  it("full lifecycle: create user → create todo → list → update → mark complete → delete", async () => {
    const pgClient = new Client({ connectionString: DATABASE_URL });
    await pgClient.connect();

    try {
      // ─── Step 1: Create User via API ───────────────────────
      const createUserRes = await httpRequest(SERVER_PORT, "POST", "/users", {
        email: "e2e-user@test.com",
        displayName: "E2E Test User",
      });
      expect(createUserRes.status).toBe(201);

      const user = createUserRes.body as {
        id: string;
        email: string;
        displayName: string;
        status: string;
      };
      expect(user.id).toBeDefined();
      expect(user.email).toBe("e2e-user@test.com");
      expect(user.displayName).toBe("E2E Test User");
      expect(user.status).toBe("active");

      // Verify in PostgreSQL
      const pgUser = await pgClient.query("SELECT * FROM users WHERE id = $1", [
        user.id,
      ]);
      expect(pgUser.rows.length).toBe(1);
      expect(pgUser.rows[0].email).toBe("e2e-user@test.com");
      expect(pgUser.rows[0].display_name).toBe("E2E Test User");
      expect(pgUser.rows[0].status).toBe("active");

      // ─── Step 2: Verify unique email constraint via API ────
      const dupUserRes = await httpRequest(SERVER_PORT, "POST", "/users", {
        email: "e2e-user@test.com",
        displayName: "Dup User",
      });
      expect(dupUserRes.status).toBe(409);

      // ─── Step 3: Create Todo via API ───────────────────────
      const createTodoRes = await httpRequest(SERVER_PORT, "POST", "/todos", {
        title: "E2E Test Todo",
        userId: user.id,
      });
      expect(createTodoRes.status).toBe(201);

      const todo = createTodoRes.body as {
        id: string;
        title: string;
        completed: boolean;
        userId: string;
      };
      expect(todo.id).toBeDefined();
      expect(todo.title).toBe("E2E Test Todo");
      expect(todo.completed).toBe(false);
      expect(todo.userId).toBe(user.id);

      // Verify in PostgreSQL
      const pgTodo = await pgClient.query("SELECT * FROM todos WHERE id = $1", [
        todo.id,
      ]);
      expect(pgTodo.rows.length).toBe(1);
      expect(pgTodo.rows[0].title).toBe("E2E Test Todo");
      expect(pgTodo.rows[0].completed).toBe(false);
      expect(pgTodo.rows[0].user_id).toBe(user.id);

      // ─── Step 4: Verify FK constraint via API ──────────────
      const badTodoRes = await httpRequest(SERVER_PORT, "POST", "/todos", {
        title: "Bad Todo",
        userId: "nonexistent-user",
      });
      expect(badTodoRes.status).toBe(400);

      // ─── Step 5: List Todos by User via API ────────────────
      const listRes = await httpRequest(SERVER_PORT, "GET", "/todos", undefined, {
        userId: user.id,
      });
      expect(listRes.status).toBe(200);
      const listBody = listRes.body as {
        data: Array<{ id: string; userId: string }>;
        pagination: { total: number };
      };
      expect(listBody.data.length).toBe(1);
      expect(listBody.data[0].id).toBe(todo.id);
      expect(listBody.data[0].userId).toBe(user.id);
      expect(listBody.pagination.total).toBe(1);

      // ─── Step 6: Update Todo via API ───────────────────────
      const updateRes = await httpRequest(
        SERVER_PORT,
        "PUT",
        `/todos/${todo.id}`,
        {
          title: "Updated E2E Todo",
        },
      );
      expect(updateRes.status).toBe(200);
      const updatedTodo = updateRes.body as {
        id: string;
        title: string;
        completed: boolean;
      };
      expect(updatedTodo.title).toBe("Updated E2E Todo");
      expect(updatedTodo.completed).toBe(false);

      // Verify in PostgreSQL
      const pgUpdated = await pgClient.query(
        "SELECT * FROM todos WHERE id = $1",
        [todo.id],
      );
      expect(pgUpdated.rows[0].title).toBe("Updated E2E Todo");

      // ─── Step 7: Mark Todo Complete via API ────────────────
      const completeRes = await httpRequest(
        SERVER_PORT,
        "PUT",
        `/todos/${todo.id}`,
        {
          completed: true,
        },
      );
      expect(completeRes.status).toBe(200);
      const completedTodo = completeRes.body as {
        id: string;
        completed: boolean;
      };
      expect(completedTodo.completed).toBe(true);

      // Verify in PostgreSQL
      const pgCompleted = await pgClient.query(
        "SELECT * FROM todos WHERE id = $1",
        [todo.id],
      );
      expect(pgCompleted.rows[0].completed).toBe(true);

      // ─── Step 8: Delete Todo via API ───────────────────────
      const deleteRes = await httpRequest(
        SERVER_PORT,
        "DELETE",
        `/todos/${todo.id}`,
      );
      expect(deleteRes.status).toBe(204);

      // Verify via API
      const getDeletedRes = await httpRequest(
        SERVER_PORT,
        "GET",
        `/todos/${todo.id}`,
      );
      expect(getDeletedRes.status).toBe(404);

      // Verify in PostgreSQL
      const pgDeleted = await pgClient.query(
        "SELECT * FROM todos WHERE id = $1",
        [todo.id],
      );
      expect(pgDeleted.rows.length).toBe(0);

      // ─── Step 9: Soft-delete User via API ──────────────────
      const deleteUserRes = await httpRequest(
        SERVER_PORT,
        "DELETE",
        `/users/${user.id}`,
      );
      expect(deleteUserRes.status).toBe(204);

      // Verify user is soft-deleted (status = deleted)
      const pgSoftDeleted = await pgClient.query(
        "SELECT * FROM users WHERE id = $1",
        [user.id],
      );
      expect(pgSoftDeleted.rows.length).toBe(1);
      expect(pgSoftDeleted.rows[0].status).toBe("deleted");
    } finally {
      await pgClient.end();
    }
  });

  it("validates NOT NULL constraints are enforced at DB level", async () => {
    const pgClient = new Client({ connectionString: DATABASE_URL });
    await pgClient.connect();

    try {
      // Missing email (NOT NULL)
      let notNullViolated = false;
      try {
        await pgClient.query(
          `INSERT INTO users (id, display_name, status, created_at, updated_at)
           VALUES ('nn-test', 'Test User', 'active', NOW(), NOW())`,
        );
      } catch (err: unknown) {
        notNullViolated = true;
        const pgErr = err as { code: string };
        expect(pgErr.code).toBe("23502");
      }
      expect(notNullViolated).toBe(true);
    } finally {
      await pgClient.end();
    }
  });

  it("validates enum values stored correctly in PostgreSQL", async () => {
    const pgClient = new Client({ connectionString: DATABASE_URL });
    await pgClient.connect();

    try {
      // Insert users with each valid status via direct SQL
      const statuses = ["active", "suspended", "deleted"] as const;
      for (let i = 0; i < statuses.length; i++) {
        await pgClient.query(
          `INSERT INTO users (id, email, display_name, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4::user_status, NOW(), NOW())
           ON CONFLICT (id) DO NOTHING`,
          [
            `enum-user-${i}`,
            `enum${i}@test.com`,
            `Enum User ${i}`,
            statuses[i],
          ],
        );
      }

      // Verify all enum values stored correctly
      const result = await pgClient.query(
        "SELECT id, status FROM users WHERE id LIKE 'enum-user-%' ORDER BY id",
      );
      expect(result.rows.length).toBe(3);
      expect(result.rows[0].status).toBe("active");
      expect(result.rows[1].status).toBe("suspended");
      expect(result.rows[2].status).toBe("deleted");

      // Verify invalid enum value is rejected
      let enumViolated = false;
      try {
        await pgClient.query(
          `INSERT INTO users (id, email, display_name, status, created_at, updated_at)
           VALUES ('bad-enum', 'bad@test.com', 'Bad User', 'invalid_status'::user_status, NOW(), NOW())`,
        );
      } catch (err: unknown) {
        enumViolated = true;
        const pgErr = err as { code: string };
        expect(pgErr.code).toBe("22P02");
      }
      expect(enumViolated).toBe(true);
    } finally {
      // Clean up test data
      await pgClient.query("DELETE FROM users WHERE id LIKE 'enum-user-%'").catch(() => {});
      await pgClient.end();
    }
  });
});
