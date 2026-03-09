// Competitor benchmark app — standalone Hono on Node.js.
// Uses Hono with @hono/node-server and better-sqlite3.

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { BENCHMARK_RESPONSE, SELECT_BY_ID_SQL } from "../shared/index.ts";
import type { BenchmarkHandle } from "./typokit-node-native.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_DB_PATH = join(
  __dirname,
  "..",
  "..",
  "fixtures",
  "benchmark.sqlite",
);

// ─── Validation ──────────────────────────────────────────────

function isValidStatus(v: unknown): v is "active" | "archived" | "draft" {
  return v === "active" || v === "archived" || v === "draft";
}

interface FieldError {
  readonly field: string;
  readonly message: string;
}

function validateBody(obj: Record<string, unknown>): FieldError[] {
  const errors: FieldError[] = [];

  if (
    typeof obj.title !== "string" ||
    obj.title.length < 1 ||
    obj.title.length > 255
  ) {
    errors.push({
      field: "title",
      message: "title must be between 1 and 255 characters",
    });
  }
  if (!isValidStatus(obj.status)) {
    errors.push({
      field: "status",
      message: "status must be one of: active, archived, draft",
    });
  }
  if (
    typeof obj.priority !== "number" ||
    obj.priority < 1 ||
    obj.priority > 10
  ) {
    errors.push({
      field: "priority",
      message: "priority must be between 1 and 10",
    });
  }
  if (!Array.isArray(obj.tags) || obj.tags.length > 10) {
    errors.push({ field: "tags", message: "tags must have at most 10 items" });
  }
  if (!obj.author || typeof obj.author !== "object") {
    errors.push({
      field: "author",
      message: "author must be an object with name and email",
    });
  } else {
    const author = obj.author as Record<string, unknown>;
    if (
      typeof author.name !== "string" ||
      author.name.length < 1 ||
      author.name.length > 100
    ) {
      errors.push({
        field: "author.name",
        message: "author.name must be between 1 and 100 characters",
      });
    }
    if (typeof author.email !== "string" || !author.email.includes("@")) {
      errors.push({
        field: "author.email",
        message: "author.email must be a valid email address",
      });
    }
  }
  if (
    obj.description !== undefined &&
    (typeof obj.description !== "string" || obj.description.length > 2000)
  ) {
    errors.push({
      field: "description",
      message: "description must be at most 2000 characters",
    });
  }

  return errors;
}

// ─── No-op middleware ────────────────────────────────────────

function createNoopMiddleware(): (
  c: { set: (key: string, value: string) => void },
  next: () => Promise<void>,
) => Promise<void> {
  return async (_c, next) => {
    await next();
  };
}

// ─── Server ──────────────────────────────────────────────────

/** Start the standalone Hono benchmark app */
export async function start(dbPath?: string): Promise<BenchmarkHandle> {
  const db = new Database(dbPath ?? DEFAULT_DB_PATH, { readonly: true });
  const selectById = db.prepare(SELECT_BY_ID_SQL);

  const app = new Hono();

  // 5 no-op middleware layers for /middleware
  for (let _i = 0; _i < 5; _i++) {
    app.use("/middleware", createNoopMiddleware());
  }

  // GET /json
  app.get("/json", (c) => {
    return c.json(BENCHMARK_RESPONSE);
  });

  // POST /validate
  app.post("/validate", async (c) => {
    try {
      const body = (await c.req.json()) as Record<string, unknown>;
      const errors = validateBody(body);
      if (errors.length > 0) {
        return c.json(
          { error: 400, message: "Validation failed", fields: errors },
          400,
        );
      }
      return c.json(body);
    } catch {
      return c.json({ error: 400, message: "Invalid JSON body" }, 400);
    }
  });

  // GET /db/:id
  app.get("/db/:id", (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) {
      return c.json({ error: 400, message: "Invalid ID" }, 400);
    }
    const row = selectById.get(id) as Record<string, unknown> | undefined;
    if (!row) {
      return c.json(
        { error: "Not Found", message: `Item ${id} not found` },
        404,
      );
    }
    if (typeof row.tags === "string") {
      try {
        row.tags = JSON.parse(row.tags as string);
      } catch {
        // keep as-is
      }
    }
    return c.json(row);
  });

  // GET /middleware
  app.get("/middleware", (c) => {
    return c.json(BENCHMARK_RESPONSE);
  });

  // GET /startup
  app.get("/startup", (c) => {
    return c.json({ uptime: process.uptime() });
  });

  return new Promise<BenchmarkHandle>((resolve) => {
    const server = serve({ fetch: app.fetch, port: 0 }, (info) => {
      resolve({
        port: info.port,
        async close() {
          db.close();
          server.close();
        },
      });
    });
  });
}
