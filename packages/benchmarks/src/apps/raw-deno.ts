// Raw Deno baseline benchmark app — zero frameworks.
// Uses only Deno.serve() with hand-written routing, JSON parsing, and validation.

import { Database } from "@db/sqlite";
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

// ─── Validation (hand-written if/typeof checks) ─────────────

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

// ─── No-op middleware simulation ─────────────────────────────

function runNoopMiddleware(): void {
  for (let _i = 0; _i < 5; _i++) {
    // no-op
  }
}

// ─── Server ──────────────────────────────────────────────────

/** Start the raw Deno baseline benchmark app */
export async function start(dbPath?: string): Promise<BenchmarkHandle> {
  const db = new Database(dbPath ?? DEFAULT_DB_PATH, { readonly: true });
  const selectById = db.prepare(SELECT_BY_ID_SQL);

  const staticJson = JSON.stringify(BENCHMARK_RESPONSE);
  const jsonHeaders = { "content-type": "application/json" } as const;

  const server = Deno.serve(
    { port: 0, onListen: () => {} },
    async (req: Request): Promise<Response> => {
      const url = new URL(req.url);
      const path = url.pathname;
      const method = req.method;

      // GET /json
      if (method === "GET" && path === "/json") {
        return new Response(staticJson, { headers: jsonHeaders });
      }

      // POST /validate
      if (method === "POST" && path === "/validate") {
        try {
          const body = (await req.json()) as Record<string, unknown>;
          const errors = validateBody(body);
          if (errors.length > 0) {
            return Response.json(
              { error: 400, message: "Validation failed", fields: errors },
              { status: 400 },
            );
          }
          return Response.json(body);
        } catch {
          return Response.json(
            { error: 400, message: "Invalid JSON body" },
            { status: 400 },
          );
        }
      }

      // GET /db/:id
      if (method === "GET" && path.startsWith("/db/")) {
        const idStr = path.slice(4);
        const id = Number(idStr);
        if (Number.isNaN(id)) {
          return Response.json(
            { error: 400, message: "Invalid ID" },
            { status: 400 },
          );
        }
        // @db/sqlite returns undefined (not null) when no row is found
        const row = selectById.get(id) as Record<string, unknown> | undefined;
        if (!row) {
          return Response.json(
            { error: "Not Found", message: `Item ${id} not found` },
            { status: 404 },
          );
        }
        if (typeof row.tags === "string") {
          try {
            row.tags = JSON.parse(row.tags as string);
          } catch {
            // keep as-is
          }
        }
        return Response.json(row);
      }

      // GET /middleware
      if (method === "GET" && path === "/middleware") {
        runNoopMiddleware();
        return new Response(staticJson, { headers: jsonHeaders });
      }

      // GET /startup
      if (method === "GET" && path === "/startup") {
        return Response.json({ uptime: process.uptime() });
      }

      // 404 fallback
      return Response.json(
        { error: 404, message: "Not Found" },
        { status: 404 },
      );
    },
  );

  const addr = server.addr as { port: number };

  return {
    port: addr.port,
    async close() {
      db.close();
      server.shutdown();
    },
  };
}
