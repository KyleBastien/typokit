// Competitor benchmark app — standalone H3 (Nitro/UnJS).
// Uses H3 with hand-written validation and better-sqlite3.

import {
  createApp,
  createRouter,
  defineEventHandler,
  readBody,
  getRouterParam,
  toNodeListener,
  setResponseStatus,
} from "h3";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
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

function noopHook(): void {
  // intentionally empty — measures middleware chain overhead
}

// ─── Server ──────────────────────────────────────────────────

/** Start the standalone H3 benchmark app */
export async function start(dbPath?: string): Promise<BenchmarkHandle> {
  const db = new Database(dbPath ?? DEFAULT_DB_PATH, { readonly: true });
  const selectById = db.prepare(SELECT_BY_ID_SQL);

  const app = createApp();
  const router = createRouter();

  // GET /json
  router.get(
    "/json",
    defineEventHandler(() => BENCHMARK_RESPONSE),
  );

  // POST /validate
  router.post(
    "/validate",
    defineEventHandler(async (event) => {
      const body = (await readBody(event)) as Record<string, unknown>;
      const errors = validateBody(body);
      if (errors.length > 0) {
        setResponseStatus(event, 400);
        return { error: 400, message: "Validation failed", fields: errors };
      }
      return body;
    }),
  );

  // GET /db/:id
  router.get(
    "/db/:id",
    defineEventHandler((event) => {
      const id = Number(getRouterParam(event, "id"));
      if (Number.isNaN(id)) {
        setResponseStatus(event, 400);
        return { error: 400, message: "Invalid ID" };
      }
      const row = selectById.get(id) as Record<string, unknown> | undefined;
      if (!row) {
        setResponseStatus(event, 404);
        return { error: "Not Found", message: `Item ${id} not found` };
      }
      if (typeof row.tags === "string") {
        try {
          row.tags = JSON.parse(row.tags as string);
        } catch {
          // keep as-is
        }
      }
      return row;
    }),
  );

  // GET /middleware — 5 layers of no-op onRequest hooks
  router.get(
    "/middleware",
    defineEventHandler({
      onRequest: [noopHook, noopHook, noopHook, noopHook, noopHook],
      handler: () => BENCHMARK_RESPONSE,
    }),
  );

  // GET /startup
  router.get(
    "/startup",
    defineEventHandler(() => ({ uptime: process.uptime() })),
  );

  app.use(router);

  const server = createServer(toNodeListener(app));

  return new Promise<BenchmarkHandle>((resolve) => {
    server.listen(0, () => {
      const addr = server.address() as AddressInfo;
      resolve({
        port: addr.port,
        async close() {
          db.close();
          return new Promise<void>((r) => server.close(() => r()));
        },
      });
    });
  });
}
