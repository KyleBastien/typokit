// Competitor benchmark app — standalone Elysia (Bun).
// Uses Elysia with built-in validation and bun:sqlite.

import { Elysia, t } from "elysia";
import { Database } from "bun:sqlite";
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

// ─── Elysia validation schema (TypeBox via Elysia's t) ──────

const createBodySchema = t.Object({
  title: t.String({ minLength: 1, maxLength: 255 }),
  status: t.Union([
    t.Literal("active"),
    t.Literal("archived"),
    t.Literal("draft"),
  ]),
  priority: t.Number({ minimum: 1, maximum: 10 }),
  tags: t.Array(t.String(), { maxItems: 10 }),
  author: t.Object({
    name: t.String({ minLength: 1, maxLength: 100 }),
    email: t.String(),
  }),
  description: t.Optional(t.String({ maxLength: 2000 })),
});

// ─── Server ──────────────────────────────────────────────────

/** Start the standalone Elysia benchmark app */
export async function start(dbPath?: string): Promise<BenchmarkHandle> {
  const db = new Database(dbPath ?? DEFAULT_DB_PATH, { readonly: true });
  const selectById = db.prepare(SELECT_BY_ID_SQL);

  const app = new Elysia()
    // GET /json
    .get("/json", () => BENCHMARK_RESPONSE)
    // POST /validate — uses Elysia's built-in TypeBox validation
    .post("/validate", ({ body }) => body, { body: createBodySchema })
    // GET /db/:id
    .get("/db/:id", ({ params, set }) => {
      const id = Number(params.id);
      if (Number.isNaN(id)) {
        set.status = 400;
        return { error: 400, message: "Invalid ID" };
      }
      const row = selectById.get(id) as Record<string, unknown> | null;
      if (!row) {
        set.status = 404;
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
    })
    // GET /middleware — 5 no-op middleware layers
    .get("/middleware", () => BENCHMARK_RESPONSE, {
      beforeHandle: [() => {}, () => {}, () => {}, () => {}, () => {}],
    })
    // GET /startup
    .get("/startup", () => ({ uptime: process.uptime() }))
    .listen(0);

  return {
    port: app.server?.port ?? 0,
    async close() {
      db.close();
      app.stop();
    },
  };
}
