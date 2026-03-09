// Competitor benchmark app — standalone NestJS 10.
// Uses NestJS with Express platform, hand-written validation, and better-sqlite3.
// Requires experimentalDecorators (enabled in benchmarks tsconfig.json).

import "reflect-metadata";
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Module,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { NestModule, MiddlewareConsumer } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Request, Response, NextFunction } from "express";
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

// ─── Shared state (set in start(), used in controller) ───────

let db!: Database.Database;
let selectById!: Database.Statement;

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

// ─── NestJS controller ──────────────────────────────────────

@Controller()
class BenchmarkController {
  @Get("/json")
  getJson(): typeof BENCHMARK_RESPONSE {
    return BENCHMARK_RESPONSE;
  }

  @Post("/validate")
  validate(@Body() body: Record<string, unknown>): unknown {
    const errors = validateBody(body);
    if (errors.length > 0) {
      throw new HttpException(
        { error: 400, message: "Validation failed", fields: errors },
        HttpStatus.BAD_REQUEST,
      );
    }
    return body;
  }

  @Get("/db/:id")
  getById(@Param("id") id: string): unknown {
    const numId = Number(id);
    if (Number.isNaN(numId)) {
      throw new HttpException(
        { error: 400, message: "Invalid ID" },
        HttpStatus.BAD_REQUEST,
      );
    }
    const row = selectById.get(numId) as Record<string, unknown> | undefined;
    if (!row) {
      throw new HttpException(
        { error: "Not Found", message: `Item ${numId} not found` },
        HttpStatus.NOT_FOUND,
      );
    }
    if (typeof row.tags === "string") {
      try {
        row.tags = JSON.parse(row.tags as string);
      } catch {
        // keep as-is
      }
    }
    return row;
  }

  @Get("/middleware")
  getMiddleware(): typeof BENCHMARK_RESPONSE {
    return BENCHMARK_RESPONSE;
  }

  @Get("/startup")
  getStartup(): { uptime: number } {
    return { uptime: process.uptime() };
  }
}

// ─── No-op middleware (5 layers for /middleware) ──────────────

function noopMiddleware(
  _req: Request,
  _res: Response,
  next: NextFunction,
): void {
  next();
}

// ─── NestJS module ──────────────────────────────────────────

@Module({ controllers: [BenchmarkController] })
class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(
        noopMiddleware,
        noopMiddleware,
        noopMiddleware,
        noopMiddleware,
        noopMiddleware,
      )
      .forRoutes("/middleware");
  }
}

// ─── Server ──────────────────────────────────────────────────

/** Start the standalone NestJS benchmark app */
export async function start(dbPath?: string): Promise<BenchmarkHandle> {
  db = new Database(dbPath ?? DEFAULT_DB_PATH, { readonly: true });
  selectById = db.prepare(SELECT_BY_ID_SQL);

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
  });

  await app.listen(0);

  const url = await app.getUrl();
  const port = Number(new URL(url).port);

  return {
    port,
    async close() {
      await app.close();
      db.close();
    },
  };
}
