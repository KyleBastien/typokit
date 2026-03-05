// Repository functions for CRUD operations using Drizzle + SQLite
import { eq, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { users, todos } from "./schema.js";

// ─── Inferred Types ─────────────────────────────────────────

export type User = InferSelectModel<typeof users>;
export type NewUser = InferInsertModel<typeof users>;
export type Todo = InferSelectModel<typeof todos>;
export type NewTodo = InferInsertModel<typeof todos>;

type DB = BetterSQLite3Database;

function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function now(): string {
  return new Date().toISOString();
}

// ─── User Repository ────────────────────────────────────────

export function createUserRepo(db: DB) {
  return {
    findAll(opts?: { page?: number; pageSize?: number }) {
      const page = opts?.page ?? 1;
      const pageSize = opts?.pageSize ?? 20;
      const offset = (page - 1) * pageSize;
      const items = db
        .select()
        .from(users)
        .limit(pageSize)
        .offset(offset)
        .all();
      const countResult = db
        .select({ count: sql<number>`count(*)` })
        .from(users)
        .get();
      const total = countResult?.count ?? 0;
      return { items, total, page, pageSize };
    },

    findById(id: string) {
      return db.select().from(users).where(eq(users.id, id)).get() ?? null;
    },

    create(input: Omit<NewUser, "id" | "createdAt" | "updatedAt">) {
      const timestamp = now();
      const row: NewUser = {
        id: uuid(),
        ...input,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      db.insert(users).values(row).run();
      return row;
    },

    update(
      id: string,
      input: Partial<Omit<NewUser, "id" | "createdAt" | "updatedAt">>,
    ) {
      const timestamp = now();
      db.update(users)
        .set({ ...input, updatedAt: timestamp })
        .where(eq(users.id, id))
        .run();
      return db.select().from(users).where(eq(users.id, id)).get() ?? null;
    },

    delete(id: string) {
      db.delete(users).where(eq(users.id, id)).run();
    },
  };
}

// ─── Todo Repository ────────────────────────────────────────

export function createTodoRepo(db: DB) {
  return {
    findAll(opts?: {
      page?: number;
      pageSize?: number;
      userId?: string;
      completed?: boolean;
    }) {
      const page = opts?.page ?? 1;
      const pageSize = opts?.pageSize ?? 20;
      const offset = (page - 1) * pageSize;

      let query = db.select().from(todos).$dynamic();

      if (opts?.userId !== undefined) {
        query = query.where(eq(todos.userId, opts.userId));
      }
      if (opts?.completed !== undefined) {
        query = query.where(eq(todos.completed, opts.completed));
      }

      const items = query.limit(pageSize).offset(offset).all();
      const countResult = db
        .select({ count: sql<number>`count(*)` })
        .from(todos)
        .get();
      const total = countResult?.count ?? 0;
      return { items, total, page, pageSize };
    },

    findById(id: string) {
      return db.select().from(todos).where(eq(todos.id, id)).get() ?? null;
    },

    create(input: Omit<NewTodo, "id" | "createdAt" | "updatedAt">) {
      const timestamp = now();
      const row: NewTodo = {
        id: uuid(),
        ...input,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      db.insert(todos).values(row).run();
      return row;
    },

    update(
      id: string,
      input: Partial<Omit<NewTodo, "id" | "createdAt" | "updatedAt">>,
    ) {
      const timestamp = now();
      db.update(todos)
        .set({ ...input, updatedAt: timestamp })
        .where(eq(todos.id, id))
        .run();
      return db.select().from(todos).where(eq(todos.id, id)).get() ?? null;
    },

    delete(id: string) {
      db.delete(todos).where(eq(todos.id, id)).run();
    },
  };
}
