// Competitor benchmark app — standalone Express 5.
// Uses Express with hand-written validation and better-sqlite3.

import express from "express";
import type { Request, Response } from "express";
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

// ─── No-op middleware simulation ─────────────────────────────

function noopMiddleware(_req: Request, _res: Response, next: () => void): void {
  next();
}

// ─── Server ──────────────────────────────────────────────────

/** Start the standalone Express benchmark app */
export async function start(dbPath?: string): Promise<BenchmarkHandle> {
  const db = new Database(dbPath ?? DEFAULT_DB_PATH, { readonly: true });
  const selectById = db.prepare(SELECT_BY_ID_SQL);

  const app = express();
  app.use(express.json());

  // GET /json
  app.get("/json", (_req: Request, res: Response) => {
    res.json(BENCHMARK_RESPONSE);
  });

  // POST /validate
  app.post("/validate", (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const errors = validateBody(body);
    if (errors.length > 0) {
      res.status(400).json({
        error: 400,
        message: "Validation failed",
        fields: errors,
      });
    } else {
      res.json(body);
    }
  });

  // GET /db/:id
  app.get("/db/:id", (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: 400, message: "Invalid ID" });
      return;
    }
    const row = selectById.get(id) as Record<string, unknown> | undefined;
    if (!row) {
      res
        .status(404)
        .json({ error: "Not Found", message: `Item ${id} not found` });
      return;
    }
    if (typeof row.tags === "string") {
      try {
        row.tags = JSON.parse(row.tags as string);
      } catch {
        // keep as-is
      }
    }
    res.json(row);
  });

  // GET /middleware — 5 layers of no-op middleware
  app.get(
    "/middleware",
    noopMiddleware,
    noopMiddleware,
    noopMiddleware,
    noopMiddleware,
    noopMiddleware,
    (_req: Request, res: Response) => {
      res.json(BENCHMARK_RESPONSE);
    },
  );

  // GET /startup
  app.get("/startup", (_req: Request, res: Response) => {
    res.json({ uptime: process.uptime() });
  });

  return new Promise<BenchmarkHandle>((resolve) => {
    const server = app.listen(0, () => {
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
