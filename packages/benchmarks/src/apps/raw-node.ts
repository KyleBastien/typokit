// Raw Node.js baseline benchmark app — zero frameworks.
// Uses only node:http with hand-written routing, JSON parsing, and validation.

import { createServer } from "node:http";
import type { Server, ServerResponse, IncomingMessage } from "node:http";
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

// ─── Helpers ─────────────────────────────────────────────────

function jsonResponse(
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(json).toString(),
  });
  res.end(json);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

// ─── No-op middleware simulation ─────────────────────────────

function runNoopMiddleware(): void {
  // 5 no-op middleware passes — simulates the overhead of a 5-layer chain
  for (let _i = 0; _i < 5; _i++) {
    // no-op
  }
}

// ─── Server ──────────────────────────────────────────────────

/** Start the raw Node.js baseline benchmark app */
export async function start(dbPath?: string): Promise<BenchmarkHandle> {
  const db = new Database(dbPath ?? DEFAULT_DB_PATH, { readonly: true });
  const selectById = db.prepare(SELECT_BY_ID_SQL);

  const staticJson = JSON.stringify(BENCHMARK_RESPONSE);
  const staticJsonLength = Buffer.byteLength(staticJson).toString();

  const server: Server = createServer(async (req, res) => {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";

    // GET /json
    if (method === "GET" && url === "/json") {
      res.writeHead(200, {
        "content-type": "application/json",
        "content-length": staticJsonLength,
      });
      res.end(staticJson);
      return;
    }

    // POST /validate
    if (method === "POST" && url === "/validate") {
      try {
        const raw = await readBody(req);
        const body = JSON.parse(raw) as Record<string, unknown>;
        const errors = validateBody(body);
        if (errors.length > 0) {
          jsonResponse(res, 400, {
            error: 400,
            message: "Validation failed",
            fields: errors,
          });
        } else {
          jsonResponse(res, 200, body);
        }
      } catch {
        jsonResponse(res, 400, {
          error: 400,
          message: "Invalid JSON body",
        });
      }
      return;
    }

    // GET /db/:id
    if (method === "GET" && url.startsWith("/db/")) {
      const idStr = url.slice(4);
      const id = Number(idStr);
      if (Number.isNaN(id)) {
        jsonResponse(res, 400, { error: 400, message: "Invalid ID" });
        return;
      }
      const row = selectById.get(id) as Record<string, unknown> | undefined;
      if (!row) {
        jsonResponse(res, 404, {
          error: "Not Found",
          message: `Item ${id} not found`,
        });
        return;
      }
      if (typeof row.tags === "string") {
        try {
          row.tags = JSON.parse(row.tags as string);
        } catch {
          // keep as-is
        }
      }
      jsonResponse(res, 200, row);
      return;
    }

    // GET /middleware
    if (method === "GET" && url === "/middleware") {
      runNoopMiddleware();
      res.writeHead(200, {
        "content-type": "application/json",
        "content-length": staticJsonLength,
      });
      res.end(staticJson);
      return;
    }

    // GET /startup
    if (method === "GET" && url === "/startup") {
      jsonResponse(res, 200, { uptime: process.uptime() });
      return;
    }

    // 404 fallback
    jsonResponse(res, 404, { error: 404, message: "Not Found" });
  });

  return new Promise<BenchmarkHandle>((resolve) => {
    server.listen(0, () => {
      const addr = server.address() as AddressInfo;
      resolve({
        port: addr.port,
        async close() {
          db.close();
          return new Promise<void>((res) => server.close(() => res()));
        },
      });
    });
  });
}
