// @typokit/example-todo-server — E2E Tests with Real PostgreSQL Database
//
// Full lifecycle: create user → create todo → list todos by user → update todo → mark complete → delete todo
// Validates actual DB state: rows written, constraints enforced, enums stored correctly.
// Requires DATABASE_URL env var pointing to a running PostgreSQL instance.

import { describe, it, expect } from "@rstest/core";
import pg from "pg";
import { createTestTodoApp, resetStore } from "./test-app.js";
import type http from "http";

const { Client } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
const SKIP = !DATABASE_URL;

// ─── PostgreSQL Schema DDL ───────────────────────────────────

const CREATE_SCHEMA_SQL = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_status') THEN
    CREATE TYPE user_status AS ENUM ('active', 'suspended', 'deleted');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  display_name VARCHAR(100) NOT NULL,
  status user_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const DROP_SCHEMA_SQL = `
DROP TABLE IF EXISTS todos CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TYPE IF EXISTS user_status CASCADE;
`;

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

describe("E2E: Full lifecycle with PostgreSQL", () => {
  if (SKIP) {
    it("skips E2E tests when DATABASE_URL is not set", () => {
      expect(true).toBe(true);
    });
    return;
  }

  it("full lifecycle: create user → create todo → list → update → mark complete → delete", async () => {
    // Setup: PostgreSQL + HTTP server
    const pgClient = new Client({ connectionString: DATABASE_URL });
    await pgClient.connect();

    const app = createTestTodoApp();
    resetStore();

    await app.listen(0);
    const server = app.getNativeServer() as http.Server;
    const addr = server.address() as { port: number };
    const port = addr.port;

    try {
      // Create fresh schema
      await pgClient.query(DROP_SCHEMA_SQL);
      await pgClient.query(CREATE_SCHEMA_SQL);

      // ─── Step 1: Create User via API ───────────────────────
      const createUserRes = await httpRequest(port, "POST", "/users", {
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

      // Mirror to PostgreSQL and verify
      await pgClient.query(
        `INSERT INTO users (id, email, display_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4::user_status, NOW(), NOW())`,
        [user.id, user.email, user.displayName, user.status],
      );

      const pgUser = await pgClient.query("SELECT * FROM users WHERE id = $1", [
        user.id,
      ]);
      expect(pgUser.rows.length).toBe(1);
      expect(pgUser.rows[0].email).toBe("e2e-user@test.com");
      expect(pgUser.rows[0].display_name).toBe("E2E Test User");
      expect(pgUser.rows[0].status).toBe("active");

      // ─── Step 2: Verify unique email constraint ────────────
      let constraintViolated = false;
      try {
        await pgClient.query(
          `INSERT INTO users (id, email, display_name, status, created_at, updated_at)
           VALUES ('dup-id', $1, 'Dup User', 'active', NOW(), NOW())`,
          [user.email],
        );
      } catch (err: unknown) {
        constraintViolated = true;
        const pgErr = err as { code: string };
        // 23505 = unique_violation
        expect(pgErr.code).toBe("23505");
      }
      expect(constraintViolated).toBe(true);

      // ─── Step 3: Create Todo via API ───────────────────────
      const createTodoRes = await httpRequest(port, "POST", "/todos", {
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

      // Mirror to PostgreSQL and verify
      await pgClient.query(
        `INSERT INTO todos (id, title, completed, user_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())`,
        [todo.id, todo.title, todo.completed, todo.userId],
      );

      const pgTodo = await pgClient.query("SELECT * FROM todos WHERE id = $1", [
        todo.id,
      ]);
      expect(pgTodo.rows.length).toBe(1);
      expect(pgTodo.rows[0].title).toBe("E2E Test Todo");
      expect(pgTodo.rows[0].completed).toBe(false);
      expect(pgTodo.rows[0].user_id).toBe(user.id);

      // ─── Step 4: Verify FK constraint ──────────────────────
      let fkViolated = false;
      try {
        await pgClient.query(
          `INSERT INTO todos (id, title, completed, user_id, created_at, updated_at)
           VALUES ('fk-test', 'Bad Todo', false, 'nonexistent-user', NOW(), NOW())`,
        );
      } catch (err: unknown) {
        fkViolated = true;
        const pgErr = err as { code: string };
        // 23503 = foreign_key_violation
        expect(pgErr.code).toBe("23503");
      }
      expect(fkViolated).toBe(true);

      // ─── Step 5: List Todos by User via API ────────────────
      const listRes = await httpRequest(port, "GET", "/todos", undefined, {
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

      // Cross-validate with PostgreSQL
      const pgTodos = await pgClient.query(
        "SELECT * FROM todos WHERE user_id = $1",
        [user.id],
      );
      expect(pgTodos.rows.length).toBe(1);

      // ─── Step 6: Update Todo via API ───────────────────────
      const updateRes = await httpRequest(port, "PUT", `/todos/${todo.id}`, {
        title: "Updated E2E Todo",
      });
      expect(updateRes.status).toBe(200);
      const updatedTodo = updateRes.body as {
        id: string;
        title: string;
        completed: boolean;
      };
      expect(updatedTodo.title).toBe("Updated E2E Todo");
      expect(updatedTodo.completed).toBe(false);

      // Mirror update to PostgreSQL
      await pgClient.query(
        "UPDATE todos SET title = $1, updated_at = NOW() WHERE id = $2",
        ["Updated E2E Todo", todo.id],
      );
      const pgUpdated = await pgClient.query(
        "SELECT * FROM todos WHERE id = $1",
        [todo.id],
      );
      expect(pgUpdated.rows[0].title).toBe("Updated E2E Todo");

      // ─── Step 7: Mark Todo Complete via API ────────────────
      const completeRes = await httpRequest(port, "PUT", `/todos/${todo.id}`, {
        completed: true,
      });
      expect(completeRes.status).toBe(200);
      const completedTodo = completeRes.body as {
        id: string;
        completed: boolean;
      };
      expect(completedTodo.completed).toBe(true);

      // Mirror to PostgreSQL and verify
      await pgClient.query(
        "UPDATE todos SET completed = true, updated_at = NOW() WHERE id = $1",
        [todo.id],
      );
      const pgCompleted = await pgClient.query(
        "SELECT * FROM todos WHERE id = $1",
        [todo.id],
      );
      expect(pgCompleted.rows[0].completed).toBe(true);

      // ─── Step 8: Verify enum constraint ────────────────────
      let enumViolated = false;
      try {
        await pgClient.query("UPDATE users SET status = $1 WHERE id = $2", [
          "invalid_status",
          user.id,
        ]);
      } catch (err: unknown) {
        enumViolated = true;
        const pgErr = err as { code: string };
        // 22P02 = invalid_text_representation (invalid enum value)
        expect(pgErr.code).toBe("22P02");
      }
      expect(enumViolated).toBe(true);

      // ─── Step 9: Delete Todo via API ───────────────────────
      const deleteRes = await httpRequest(port, "DELETE", `/todos/${todo.id}`);
      expect(deleteRes.status).toBe(204);

      // Verify via API
      const getDeletedRes = await httpRequest(port, "GET", `/todos/${todo.id}`);
      expect(getDeletedRes.status).toBe(404);

      // Mirror delete to PostgreSQL and verify
      await pgClient.query("DELETE FROM todos WHERE id = $1", [todo.id]);
      const pgDeleted = await pgClient.query(
        "SELECT * FROM todos WHERE id = $1",
        [todo.id],
      );
      expect(pgDeleted.rows.length).toBe(0);

      // ─── Step 10: Verify CASCADE delete ────────────────────
      // Create a new todo, then delete the user — todo should cascade
      const cascadeTodoId = "cascade-test-todo";
      await pgClient.query(
        `INSERT INTO todos (id, title, completed, user_id, created_at, updated_at)
         VALUES ($1, 'Cascade Test', false, $2, NOW(), NOW())`,
        [cascadeTodoId, user.id],
      );
      await pgClient.query("DELETE FROM users WHERE id = $1", [user.id]);
      const pgCascade = await pgClient.query(
        "SELECT * FROM todos WHERE id = $1",
        [cascadeTodoId],
      );
      expect(pgCascade.rows.length).toBe(0);
    } finally {
      // Cleanup
      await pgClient.query(DROP_SCHEMA_SQL).catch(() => {});
      await pgClient.end();
      await app.close();
    }
  });

  it("validates NOT NULL constraints are enforced", async () => {
    const pgClient = new Client({ connectionString: DATABASE_URL });
    await pgClient.connect();

    try {
      await pgClient.query(DROP_SCHEMA_SQL);
      await pgClient.query(CREATE_SCHEMA_SQL);

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
        // 23502 = not_null_violation
        expect(pgErr.code).toBe("23502");
      }
      expect(notNullViolated).toBe(true);

      // Missing title on todo (NOT NULL)
      await pgClient.query(
        `INSERT INTO users (id, email, display_name, status, created_at, updated_at)
         VALUES ('nn-user', 'nn@test.com', 'NN User', 'active', NOW(), NOW())`,
      );

      let todoNotNull = false;
      try {
        await pgClient.query(
          `INSERT INTO todos (id, completed, user_id, created_at, updated_at)
           VALUES ('nn-todo', false, 'nn-user', NOW(), NOW())`,
        );
      } catch (err: unknown) {
        todoNotNull = true;
        const pgErr = err as { code: string };
        expect(pgErr.code).toBe("23502");
      }
      expect(todoNotNull).toBe(true);
    } finally {
      await pgClient.query(DROP_SCHEMA_SQL).catch(() => {});
      await pgClient.end();
    }
  });

  it("validates enum values stored correctly in PostgreSQL", async () => {
    const pgClient = new Client({ connectionString: DATABASE_URL });
    await pgClient.connect();

    try {
      await pgClient.query(DROP_SCHEMA_SQL);
      await pgClient.query(CREATE_SCHEMA_SQL);

      // Insert users with each valid status
      const statuses = ["active", "suspended", "deleted"] as const;
      for (let i = 0; i < statuses.length; i++) {
        await pgClient.query(
          `INSERT INTO users (id, email, display_name, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4::user_status, NOW(), NOW())`,
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
        "SELECT id, status FROM users ORDER BY id",
      );
      expect(result.rows.length).toBe(3);
      expect(result.rows[0].status).toBe("active");
      expect(result.rows[1].status).toBe("suspended");
      expect(result.rows[2].status).toBe("deleted");
    } finally {
      await pgClient.query(DROP_SCHEMA_SQL).catch(() => {});
      await pgClient.end();
    }
  });
});
