// Competitor benchmark app — standalone tRPC 10.
// Uses tRPC standalone HTTP adapter with Zod validation and better-sqlite3.

import { initTRPC, TRPCError } from "@trpc/server";
import { createHTTPHandler } from "@trpc/server/adapters/standalone";
import { createServer } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { z } from "zod";
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

// ─── Zod schemas (tRPC's recommended validation) ────────────

const createBodySchema = z.object({
  title: z.string().min(1).max(255),
  status: z.enum(["active", "archived", "draft"]),
  priority: z.number().min(1).max(10),
  tags: z.array(z.string()).max(10),
  author: z.object({
    name: z.string().min(1).max(100),
    email: z.string().email(),
  }),
  description: z.string().max(2000).optional(),
});

const dbInputSchema = z.object({ id: z.number() });

// ─── tRPC setup ──────────────────────────────────────────────

const t = initTRPC.create();

const noopMiddleware = t.middleware(({ next }) => next());

const withFiveMiddlewares = t.procedure
  .use(noopMiddleware)
  .use(noopMiddleware)
  .use(noopMiddleware)
  .use(noopMiddleware)
  .use(noopMiddleware);

// ─── Server ──────────────────────────────────────────────────

/** Start the standalone tRPC benchmark app */
export async function start(dbPath?: string): Promise<BenchmarkHandle> {
  const db = new Database(dbPath ?? DEFAULT_DB_PATH, { readonly: true });
  const selectById = db.prepare(SELECT_BY_ID_SQL);

  const appRouter = t.router({
    json: t.procedure.query(() => BENCHMARK_RESPONSE),

    validate: t.procedure
      .input(createBodySchema)
      .mutation(({ input }) => input),

    db: t.procedure.input(dbInputSchema).query(({ input }) => {
      const row = selectById.get(input.id) as
        | Record<string, unknown>
        | undefined;
      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Item ${input.id} not found`,
        });
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

    middleware: withFiveMiddlewares.query(() => BENCHMARK_RESPONSE),

    startup: t.procedure.query(() => ({ uptime: process.uptime() })),
  });

  const trpcHandler = createHTTPHandler({ router: appRouter });

  // Wrap with URL rewriting so standard REST paths work with bombardier:
  // /db/:id → /db?input={"id":X}
  const server = createServer((req, res) => {
    const dbMatch = req.url?.match(/^\/db\/(\d+)/);
    if (dbMatch) {
      const id = Number(dbMatch[1]);
      req.url = `/db?input=${encodeURIComponent(JSON.stringify({ id }))}`;
    }
    trpcHandler(req, res);
  });

  const connections = new Set<Socket>();
  server.on("connection", (conn) => {
    connections.add(conn);
    conn.on("close", () => connections.delete(conn));
  });

  return new Promise<BenchmarkHandle>((resolve) => {
    server.listen(0, () => {
      const addr = server.address() as AddressInfo;
      resolve({
        port: addr.port,
        async close() {
          db.close();
          for (const conn of connections) conn.destroy();
          return new Promise<void>((r) => server.close(() => r()));
        },
      });
    });
  });
}
