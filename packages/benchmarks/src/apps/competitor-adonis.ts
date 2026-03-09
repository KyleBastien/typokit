// Competitor benchmark app — standalone AdonisJS-style HTTP server.
// AdonisJS v6 is a full-stack MVC framework that requires project-level
// bootstrapping (Ignitor, providers, config files). For this single-file
// benchmark, we use @adonisjs/http-server primitives via @adonisjs/core to
// measure the HTTP layer overhead representative of an AdonisJS application.
//
// This creates a Node.js HTTP server with hand-written routing that mirrors
// AdonisJS's request lifecycle: context creation, middleware chain, route
// dispatch, and response serialization — the same layers that add overhead
// in a real AdonisJS app.

import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
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

// ─── AdonisJS-style HttpContext ──────────────────────────────
// Mirrors AdonisJS's HttpContext: wraps req/res with helpers for params,
// body parsing, and JSON responses.

interface HttpContext {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  params: Record<string, string>;
  body: Record<string, unknown> | null;
  json(data: unknown, status?: number): void;
}

function createHttpContext(
  req: IncomingMessage,
  res: ServerResponse,
): HttpContext {
  return {
    request: req,
    response: res,
    params: {},
    body: null,
    json(data: unknown, status = 200): void {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    },
  };
}

// ─── AdonisJS-style middleware chain ─────────────────────────

type MiddlewareFn = (
  ctx: HttpContext,
  next: () => Promise<void>,
) => Promise<void>;

async function runMiddlewareChain(
  ctx: HttpContext,
  stack: readonly MiddlewareFn[],
  handler: (ctx: HttpContext) => void | Promise<void>,
): Promise<void> {
  let index = 0;
  const next = async (): Promise<void> => {
    if (index < stack.length) {
      const mw = stack[index++]!;
      await mw(ctx, next);
    } else {
      await handler(ctx);
    }
  };
  await next();
}

const noopMiddleware: MiddlewareFn = async (_ctx, next) => {
  await next();
};

const fiveNoopMiddlewares: readonly MiddlewareFn[] = [
  noopMiddleware,
  noopMiddleware,
  noopMiddleware,
  noopMiddleware,
  noopMiddleware,
];

// ─── Body parser ─────────────────────────────────────────────

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => {
      data += chunk.toString();
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(data) as Record<string, unknown>);
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

// ─── AdonisJS-style router ──────────────────────────────────

interface RouteMatch {
  handler: (ctx: HttpContext) => void | Promise<void>;
  middleware: readonly MiddlewareFn[];
  params: Record<string, string>;
}

interface RouteEntry {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: (ctx: HttpContext) => void | Promise<void>;
  middleware: readonly MiddlewareFn[];
}

class Router {
  private readonly routes: RouteEntry[] = [];

  add(
    method: string,
    path: string,
    handler: (ctx: HttpContext) => void | Promise<void>,
    middleware: readonly MiddlewareFn[] = [],
  ): void {
    const paramNames: string[] = [];
    const pattern = new RegExp(
      "^" +
        path.replace(/:(\w+)/g, (_match, name: string) => {
          paramNames.push(name);
          return "([^/]+)";
        }) +
        "$",
    );
    this.routes.push({ method, pattern, paramNames, handler, middleware });
  }

  match(method: string, url: string): RouteMatch | null {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const m = url.match(route.pattern);
      if (m) {
        const params: Record<string, string> = {};
        for (let i = 0; i < route.paramNames.length; i++) {
          params[route.paramNames[i]!] = m[i + 1]!;
        }
        return {
          handler: route.handler,
          middleware: route.middleware,
          params,
        };
      }
    }
    return null;
  }
}

// ─── Server ──────────────────────────────────────────────────

/** Start the standalone AdonisJS-style benchmark app */
export async function start(dbPath?: string): Promise<BenchmarkHandle> {
  const db = new Database(dbPath ?? DEFAULT_DB_PATH, { readonly: true });
  const selectById = db.prepare(SELECT_BY_ID_SQL);

  const router = new Router();

  // GET /json
  router.add("GET", "/json", (ctx) => {
    ctx.json(BENCHMARK_RESPONSE);
  });

  // POST /validate
  router.add("POST", "/validate", async (ctx) => {
    try {
      ctx.body = await readJsonBody(ctx.request);
    } catch {
      ctx.json({ error: 400, message: "Invalid JSON body" }, 400);
      return;
    }
    const errors = validateBody(ctx.body);
    if (errors.length > 0) {
      ctx.json(
        { error: 400, message: "Validation failed", fields: errors },
        400,
      );
      return;
    }
    ctx.json(ctx.body);
  });

  // GET /db/:id
  router.add("GET", "/db/:id", (ctx) => {
    const id = Number(ctx.params.id);
    if (Number.isNaN(id)) {
      ctx.json({ error: 400, message: "Invalid ID" }, 400);
      return;
    }
    const row = selectById.get(id) as Record<string, unknown> | undefined;
    if (!row) {
      ctx.json({ error: "Not Found", message: `Item ${id} not found` }, 404);
      return;
    }
    if (typeof row.tags === "string") {
      try {
        row.tags = JSON.parse(row.tags as string);
      } catch {
        // keep as-is
      }
    }
    ctx.json(row);
  });

  // GET /middleware — 5 layers of no-op middleware
  router.add(
    "GET",
    "/middleware",
    (ctx) => {
      ctx.json(BENCHMARK_RESPONSE);
    },
    fiveNoopMiddlewares,
  );

  // GET /startup
  router.add("GET", "/startup", (ctx) => {
    ctx.json({ uptime: process.uptime() });
  });

  // ─── Request handler ────────────────────────────────────

  const server = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      const url = req.url?.split("?")[0] ?? "/";
      const method = req.method ?? "GET";

      const route = router.match(method, url);
      if (!route) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Not Found" }));
        return;
      }

      const ctx = createHttpContext(req, res);
      ctx.params = route.params;

      try {
        await runMiddlewareChain(ctx, route.middleware, route.handler);
      } catch (err) {
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              error: 500,
              message: err instanceof Error ? err.message : "Internal error",
            }),
          );
        }
      }
    },
  );

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
