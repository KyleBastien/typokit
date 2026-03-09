// Shared route table, handler factory, and validation for TypoKit benchmark apps.
// All 4 server-adapter benchmark apps (native, fastify, hono, express) share this
// module to ensure identical route definitions and handler logic.

import type {
  CompiledRouteTable,
  HandlerMap,
  MiddlewareChain,
  TypoKitRequest,
  ValidatorMap,
  ValidationFieldError,
  ValidationResult,
} from "@typokit/types";
import {
  createRequestContext,
  executeMiddlewareChain,
  defineMiddleware,
} from "@typokit/core";
import type { MiddlewareEntry } from "@typokit/core";
import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { BENCHMARK_RESPONSE, SELECT_BY_ID_SQL } from "../shared/index.ts";
import type { CreateBenchmarkItemBody } from "../shared/index.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_DB_PATH = join(
  __dirname,
  "..",
  "..",
  "fixtures",
  "benchmark.sqlite",
);

// ─── Route Table ─────────────────────────────────────────────

/** Build the compiled route table for the 7 benchmark endpoints */
export function buildRouteTable(): CompiledRouteTable {
  return {
    segment: "",
    children: {
      json: {
        segment: "json",
        handlers: {
          GET: { ref: "get-json", middleware: [] },
        },
      },
      validate: {
        segment: "validate",
        handlers: {
          POST: {
            ref: "post-validate",
            middleware: [],
            validators: { body: "validate-body" },
          },
        },
      },
      "validate-passthrough": {
        segment: "validate-passthrough",
        handlers: {
          POST: {
            ref: "post-validate-passthrough",
            middleware: [],
          },
        },
      },
      "validate-handwritten": {
        segment: "validate-handwritten",
        handlers: {
          POST: {
            ref: "post-validate-handwritten",
            middleware: [],
          },
        },
      },
      db: {
        segment: "db",
        paramChild: {
          segment: ":id",
          paramName: "id",
          handlers: {
            GET: { ref: "get-db-id", middleware: [] },
          },
        },
      },
      middleware: {
        segment: "middleware",
        handlers: {
          GET: { ref: "get-middleware", middleware: [] },
        },
      },
      startup: {
        segment: "startup",
        handlers: {
          GET: { ref: "get-startup", middleware: [] },
        },
      },
    },
  };
}

// ─── Validation ──────────────────────────────────────────────

function isValidStatus(v: unknown): v is "active" | "archived" | "draft" {
  return v === "active" || v === "archived" || v === "draft";
}

/** Manual validator for CreateBenchmarkItemBody matching the shared schema */
function validateCreateBody(input: unknown): ValidationResult {
  if (!input || typeof input !== "object") {
    return {
      success: false,
      errors: [{ path: "", expected: "object", actual: input }],
    };
  }

  const obj = input as Record<string, unknown>;
  const errors: ValidationFieldError[] = [];

  if (
    typeof obj.title !== "string" ||
    obj.title.length < 1 ||
    obj.title.length > 255
  ) {
    errors.push({
      path: "title",
      expected: "string (1-255)",
      actual: obj.title,
    });
  }
  if (!isValidStatus(obj.status)) {
    errors.push({
      path: "status",
      expected: "'active'|'archived'|'draft'",
      actual: obj.status,
    });
  }
  if (
    typeof obj.priority !== "number" ||
    obj.priority < 1 ||
    obj.priority > 10
  ) {
    errors.push({
      path: "priority",
      expected: "number (1-10)",
      actual: obj.priority,
    });
  }
  if (!Array.isArray(obj.tags) || obj.tags.length > 10) {
    errors.push({
      path: "tags",
      expected: "string[] (0-10)",
      actual: obj.tags,
    });
  }
  if (!obj.author || typeof obj.author !== "object") {
    errors.push({
      path: "author",
      expected: "{ name, email }",
      actual: obj.author,
    });
  } else {
    const author = obj.author as Record<string, unknown>;
    if (
      typeof author.name !== "string" ||
      author.name.length < 1 ||
      author.name.length > 100
    ) {
      errors.push({
        path: "author.name",
        expected: "string (1-100)",
        actual: author.name,
      });
    }
    if (typeof author.email !== "string") {
      errors.push({
        path: "author.email",
        expected: "email string",
        actual: author.email,
      });
    }
  }
  if (
    obj.description !== undefined &&
    (typeof obj.description !== "string" || obj.description.length > 2000)
  ) {
    errors.push({
      path: "description",
      expected: "string? (0-2000)",
      actual: obj.description,
    });
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }
  return { success: true, data: input };
}

/** Build the validator map for routes that need validation */
export function buildValidatorMap(): ValidatorMap {
  return {
    "validate-body": validateCreateBody,
  };
}

// ─── Middleware ───────────────────────────────────────────────

/** 5 no-op middleware layers for the /middleware endpoint benchmark */
const noopMiddleware: MiddlewareEntry[] = Array.from({ length: 5 }, (_, i) => ({
  name: `noop-${i}`,
  middleware: defineMiddleware<Record<string, unknown>>(async () => ({})),
  priority: i,
}));

// ─── Handler Map ─────────────────────────────────────────────

export interface BenchmarkAppResources {
  handlerMap: HandlerMap;
  validatorMap: ValidatorMap;
  middlewareChain: MiddlewareChain;
  close: () => void;
}

/** Inline hand-written if/typeof validation (bypasses TypoKit validator framework) */
export function handwrittenValidate(
  input: unknown,
): { ok: true; data: CreateBenchmarkItemBody } | { ok: false; error: string } {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "body must be an object" };
  }
  const obj = input as Record<string, unknown>;
  if (
    typeof obj.title !== "string" ||
    obj.title.length < 1 ||
    obj.title.length > 255
  ) {
    return { ok: false, error: "title must be string (1-255)" };
  }
  if (
    obj.status !== "active" &&
    obj.status !== "archived" &&
    obj.status !== "draft"
  ) {
    return { ok: false, error: "status must be active|archived|draft" };
  }
  if (
    typeof obj.priority !== "number" ||
    obj.priority < 1 ||
    obj.priority > 10
  ) {
    return { ok: false, error: "priority must be number (1-10)" };
  }
  if (!Array.isArray(obj.tags) || obj.tags.length > 10) {
    return { ok: false, error: "tags must be string[] (0-10)" };
  }
  if (!obj.author || typeof obj.author !== "object") {
    return { ok: false, error: "author must be { name, email }" };
  }
  const author = obj.author as Record<string, unknown>;
  if (
    typeof author.name !== "string" ||
    author.name.length < 1 ||
    author.name.length > 100
  ) {
    return { ok: false, error: "author.name must be string (1-100)" };
  }
  if (typeof author.email !== "string") {
    return { ok: false, error: "author.email must be string" };
  }
  if (
    obj.description !== undefined &&
    (typeof obj.description !== "string" || obj.description.length > 2000)
  ) {
    return { ok: false, error: "description must be string? (0-2000)" };
  }
  return { ok: true, data: input as CreateBenchmarkItemBody };
}

/** Build handler map and associated resources for all 7 benchmark endpoints */
export function buildAppResources(dbPath?: string): BenchmarkAppResources {
  const db = new Database(dbPath ?? DEFAULT_DB_PATH, { readonly: true });
  const selectById = db.prepare(SELECT_BY_ID_SQL);

  const handlerMap: HandlerMap = {
    "get-json": () => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: BENCHMARK_RESPONSE,
    }),

    "post-validate": (req: TypoKitRequest) => {
      const body = req.body as CreateBenchmarkItemBody;
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: body,
      };
    },

    "post-validate-passthrough": (req: TypoKitRequest) => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: req.body as CreateBenchmarkItemBody,
    }),

    "post-validate-handwritten": (req: TypoKitRequest) => {
      const result = handwrittenValidate(req.body);
      if (!result.ok) {
        return {
          status: 400,
          headers: { "content-type": "application/json" },
          body: { error: result.error },
        };
      }
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: result.data,
      };
    },

    "get-db-id": (req: TypoKitRequest) => {
      const id = Number(req.params.id);
      const row = selectById.get(id) as Record<string, unknown> | undefined;
      if (!row) {
        return {
          status: 404,
          headers: { "content-type": "application/json" },
          body: { error: "Not Found", message: `Item ${id} not found` },
        };
      }
      // Parse the tags JSON string back to array
      if (typeof row.tags === "string") {
        try {
          row.tags = JSON.parse(row.tags as string);
        } catch {
          // keep as-is
        }
      }
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: row,
      };
    },

    "get-middleware": async (req: TypoKitRequest) => {
      const _ctx = await executeMiddlewareChain(
        req,
        createRequestContext(),
        noopMiddleware,
      );
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: BENCHMARK_RESPONSE,
      };
    },

    "get-startup": () => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: { uptime: process.uptime() },
    }),
  };

  return {
    handlerMap,
    validatorMap: buildValidatorMap(),
    middlewareChain: { entries: [] },
    close: () => db.close(),
  };
}
