// Competitor benchmark app — standalone Fastify 5.
// Uses Fastify with JSON Schema validation and better-sqlite3.

import Fastify from "fastify";
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

// ─── JSON Schema for Fastify validation ──────────────────────

const createBodySchema = {
  type: "object" as const,
  required: ["title", "status", "priority", "tags", "author"],
  properties: {
    title: { type: "string" as const, minLength: 1, maxLength: 255 },
    status: { type: "string" as const, enum: ["active", "archived", "draft"] },
    priority: { type: "number" as const, minimum: 1, maximum: 10 },
    tags: {
      type: "array" as const,
      items: { type: "string" as const },
      maxItems: 10,
    },
    author: {
      type: "object" as const,
      required: ["name", "email"],
      properties: {
        name: { type: "string" as const, minLength: 1, maxLength: 100 },
        email: { type: "string" as const },
      },
    },
    description: { type: "string" as const, maxLength: 2000 },
  },
};

// ─── No-op middleware simulation ─────────────────────────────

function buildNoopHooks(): {
  preHandler: Array<
    (req: unknown, reply: unknown, done: (err?: Error) => void) => void
  >;
} {
  const hooks = Array.from({ length: 5 }, () => {
    return (_req: unknown, _reply: unknown, done: (err?: Error) => void) => {
      done();
    };
  });
  return { preHandler: hooks };
}

// ─── Server ──────────────────────────────────────────────────

/** Start the standalone Fastify benchmark app */
export async function start(dbPath?: string): Promise<BenchmarkHandle> {
  const db = new Database(dbPath ?? DEFAULT_DB_PATH, { readonly: true });
  const selectById = db.prepare(SELECT_BY_ID_SQL);

  const fastify = Fastify({ logger: false });

  // GET /json
  fastify.get("/json", async () => {
    return BENCHMARK_RESPONSE;
  });

  // POST /validate — uses Fastify's built-in JSON Schema validation
  fastify.post(
    "/validate",
    { schema: { body: createBodySchema } },
    async (request) => {
      return request.body;
    },
  );

  // GET /db/:id
  fastify.get<{ Params: { id: string } }>("/db/:id", async (request, reply) => {
    const id = Number(request.params.id);
    if (Number.isNaN(id)) {
      return reply.status(400).send({ error: 400, message: "Invalid ID" });
    }
    const row = selectById.get(id) as Record<string, unknown> | undefined;
    if (!row) {
      return reply
        .status(404)
        .send({ error: "Not Found", message: `Item ${id} not found` });
    }
    if (typeof row.tags === "string") {
      try {
        row.tags = JSON.parse(row.tags as string);
      } catch {
        // keep as-is
      }
    }
    return row;
  });

  // GET /middleware — 5 no-op preHandler hooks
  fastify.get("/middleware", buildNoopHooks(), async () => {
    return BENCHMARK_RESPONSE;
  });

  // GET /startup
  fastify.get("/startup", async () => {
    return { uptime: process.uptime() };
  });

  await fastify.listen({ port: 0 });

  const address = fastify.server.address();
  const port =
    typeof address === "object" && address !== null ? address.port : 0;

  return {
    port,
    async close() {
      await fastify.close();
      db.close();
    },
  };
}
