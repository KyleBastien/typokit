// Bun-specific app resource builder using bun:sqlite instead of better-sqlite3.
// Reuses route table, validators, and middleware definitions from the shared
// Node module so all benchmark apps (Node and Bun) exercise identical logic.

import type { HandlerMap, TypoKitRequest } from "@typokit/types";
import {
  createRequestContext,
  executeMiddlewareChain,
  defineMiddleware,
} from "@typokit/core";
import type { MiddlewareEntry } from "@typokit/core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { BENCHMARK_RESPONSE, SELECT_BY_ID_SQL } from "../shared/index.ts";
import type { CreateBenchmarkItemBody } from "../shared/index.ts";
import { buildValidatorMap, handwrittenValidate } from "./shared-routes.ts";
import type { BenchmarkAppResources } from "./shared-routes.ts";
// bun:sqlite types declared in ../bun-sqlite.d.ts
import { Database } from "bun:sqlite";

export {
  buildRouteTable,
  buildValidatorMap,
  handwrittenValidate,
} from "./shared-routes.ts";
export type { BenchmarkAppResources } from "./shared-routes.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_DB_PATH = join(
  __dirname,
  "..",
  "..",
  "fixtures",
  "benchmark.sqlite",
);

// ─── Middleware ───────────────────────────────────────────────

/** 5 no-op middleware layers for the /middleware endpoint benchmark */
const noopMiddleware: MiddlewareEntry[] = Array.from({ length: 5 }, (_, i) => ({
  name: `noop-${i}`,
  middleware: defineMiddleware<Record<string, unknown>>(async () => ({})),
  priority: i,
}));

// ─── Handler Map (Bun) ──────────────────────────────────────

/** Build handler map and associated resources using bun:sqlite */
export function buildAppResourcesBun(dbPath?: string): BenchmarkAppResources {
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
      const row = selectById.get(id) as Record<string, unknown> | null;
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
