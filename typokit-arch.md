# TypoKit — AI-Native Node.js Framework Architectural Document

> **Name:** TypoKit (@typokit) — Type Outputs Kit
> **Version:** 0.1 (Draft)
> **Author:** Kyle + Claude
> **Date:** 2025-02-27

---

## 1. Vision

A TypeScript-native Node.js framework where **plain TypeScript types are the single source of truth** for the entire stack — API validation, database schema, frontend contracts, documentation, and test generation. Designed from the ground up so AI coding agents produce correct, consistent code on the first attempt, and can self-diagnose when they don't.

### Core Tenets

1. **Write the type once.** A single TypeScript interface defines validation, serialization, database columns, API documentation, and client types. No Zod. No JSON Schema. No decorators. Just TypeScript.
2. **One way to do everything.** Radical convention over configuration. If there's a decision to make, the framework already made it. AI agents never have to guess at structure.
3. **Zero overhead opinions.** Opinionated doesn't mean slow. The framework compiles away abstractions at build time via a native Rust pipeline. Runtime performance matches raw `http` + hand-written validation.
4. **Tests are a first-class output.** The framework generates test harnesses, contract tests, and integration scaffolding from types. TDD is the default, not an afterthought.
5. **AI-inspectable at every layer.** Every framework component exposes structured introspection APIs that AI agents can query to understand, debug, and modify the application. Runtime code stays in TypeScript so agents can read, trace, and modify it.
6. **Bring your own server.** TypoKit's value is the schema-first type system, build pipeline, AI debugging, and testing — not the HTTP layer. Run on TypoKit's native server, or bring Fastify, Hono, Express, or even a Rust-native HTTP layer. TypoKit's typed middleware, validation, and observability work identically regardless.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                   Monorepo                          │
│                                                     │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │  @app/schema │  │  @app/server │  │ @app/client││ │
│  │             │  │              │  │            │ │
│  │ Pure TS     │──│ TypoKit      │  │ Generated  │ │
│  │ Types +     │  │ Runtime      │──│ Type-safe  │ │
│  │ Contracts   │──│              │  │ API Client │ │
│  │             │  │              │  │            │ │
│  └─────────────┘  └──────────────┘  └────────────┘ │
│         │                │                          │
│         │         ┌──────────────┐                  │
│         │         │  @app/db     │                  │
│         └────────│ Schema-driven│                  │
│                   │ Data Layer   │                  │
│                   └──────────────┘                  │
└─────────────────────────────────────────────────────┘
```

### Package Responsibilities

| Package | Purpose | AI Agent Interaction |
|---------|---------|---------------------|
| `@app/schema` | Pure TypeScript types and contracts — zero runtime dependencies | Agents generate/modify types here; everything downstream reacts |
| `@app/server` | TypoKit runtime — routing, middleware, handlers | Agents scaffold routes from schema; framework enforces correctness |
| `@app/db` | Database layer — migrations, queries, repositories | Schema changes auto-generate migration drafts |
| `@app/client` | Generated type-safe API client for frontend consumption | Fully auto-generated — agents never edit this directly |

---

## 3. Schema-First Type System

### 3.1 Philosophy: Typia-Inspired Plain TypeScript

The schema layer uses **plain TypeScript interfaces** with JSDoc tags for metadata. No runtime schema library. The framework's build step (powered by a native Rust transform pipeline) extracts validation logic, JSON Schema, and database column definitions at compile time.

```typescript
// @app/schema/src/entities/user.ts

/** @table users */
export interface User {
  /** @id @generated uuid */
  id: string;

  /** @format email @unique */
  email: string;

  /** @minLength 2 @maxLength 100 */
  displayName: string;

  /** @default "active" */
  status: "active" | "suspended" | "deleted";

  /** @generated now */
  createdAt: Date;

  /** @generated now @onUpdate now */
  updatedAt: Date;
}

/** Input type for creating a user — omit generated fields */
export type CreateUserInput = Omit<User, "id" | "createdAt" | "updatedAt">;

/** Input type for updating a user — all fields optional */
export type UpdateUserInput = Partial<CreateUserInput>;

/** Public-facing user — omit internal fields */
export type PublicUser = Omit<User, "status">;
```

### 3.2 What the Build Step Produces

From the above TypeScript, the TypoKit compiler generates:

| Output | Used By | Format |
|--------|---------|--------|
| Runtime validators | Server (request validation) | Optimized JS assertion functions (Typia via napi-rs callback) |
| JSON Schema | OpenAPI spec generation | Standard JSON Schema 2020-12 |
| Database DDL | Migration engine | SQL DDL / Drizzle schema / Kysely types |
| Type-safe client | Frontend | TypeScript types + fetch wrappers |
| Test factories | Test harness | Functions that produce valid/invalid fixture data |
| Diff report | Migration safety | Structured changeset for schema evolution |

### 3.3 Shared Type Utilities

The schema package exports utility types that enforce consistent patterns:

```typescript
// @app/schema/src/lib/api.ts

/** Standard paginated list response */
export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

/** Standard error response */
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    /** Trace ID for AI debugging correlation */
    traceId: string;
  };
}

/** Route contract — binds request and response types together */
export interface RouteContract<
  TParams = void,
  TQuery = void,
  TBody = void,
  TResponse = void,
> {
  params: TParams;
  query: TQuery;
  body: TBody;
  response: TResponse;
}
```

---

## 4. Routing & Handler System

### 4.1 Declarative Route Definition

Routes are defined as typed contracts first, handlers second. TypoKit enforces that every route has a schema before it has an implementation.

```typescript
// @app/server/src/routes/users/contracts.ts

import { CreateUserInput, PublicUser, PaginatedResponse, RouteContract } from "@app/schema";

export interface UsersRoutes {
  "GET /users": RouteContract<
    void,                              // params
    { page?: number; pageSize?: number }, // query
    void,                              // body
    PaginatedResponse<PublicUser>       // response
  >;

  "POST /users": RouteContract<
    void,                              // params
    void,                              // query
    CreateUserInput,                   // body
    PublicUser                         // response
  >;

  "GET /users/:id": RouteContract<
    { id: string },                    // params
    void,                              // query
    void,                              // body
    PublicUser                         // response
  >;
}
```

### 4.2 Handler Implementation

Handlers receive fully typed, validated context. If the handler compiles, the request has already been validated.

```typescript
// @app/server/src/routes/users/handlers.ts

import { defineHandlers } from "@typokit/core";
import { UsersRoutes } from "./contracts";
import { userService } from "../../services/user.service";

export default defineHandlers<UsersRoutes>({
  "GET /users": async ({ query, ctx }) => {
    // query is typed as { page?: number; pageSize?: number }
    // ctx includes logger, db, auth context from middleware
    return userService.list(query, ctx);
  },

  "POST /users": async ({ body, ctx }) => {
    // body is typed and validated as CreateUserInput
    return userService.create(body, ctx);
  },

  "GET /users/:id": async ({ params, ctx }) => {
    // params.id is typed as string, validated as uuid
    return userService.findByIdOrThrow(params.id, ctx);
  },
});
```

### 4.3 Middleware as Type Narrowing

Middleware doesn't just execute logic — it transforms the context type. This is critical for AI agents because the type system tells the agent exactly what's available in each handler.

```typescript
// @app/server/src/middleware/auth.ts

import { defineMiddleware } from "@typokit/core";

interface AuthenticatedContext {
  user: { id: string; email: string; roles: string[] };
}

export const requireAuth = defineMiddleware<AuthenticatedContext>(
  async ({ headers, ctx }) => {
    const token = headers.authorization?.replace("Bearer ", "");
    if (!token) throw ctx.error(401, "UNAUTHORIZED");

    const user = await ctx.services.auth.verify(token);
    return { user }; // This narrows the context type
  }
);

// Usage in route group:
// After requireAuth, all handlers receive ctx.user as AuthenticatedContext
```

### 4.4 File-Based Convention with Explicit Registration

```
src/
  routes/
    users/
      contracts.ts     # Route type contracts
      handlers.ts      # Handler implementations
      middleware.ts     # Route-specific middleware
    posts/
      contracts.ts
      handlers.ts
  middleware/
    auth.ts            # Shared middleware
    logging.ts
  services/
    user.service.ts    # Business logic
    post.service.ts
  app.ts               # Explicit route registration (no magic file-based routing)
```

File-based routing is intentionally avoided — it introduces magic that confuses AI agents. Instead, routes are explicitly registered in `app.ts` so the dependency graph is always traceable:

```typescript
// @app/server/src/app.ts

import { createApp } from "@typokit/core";
import { nativeServer } from "@typokit/server-native";
import { requireAuth } from "./middleware/auth";
import usersHandlers from "./routes/users/handlers";
import postsHandlers from "./routes/posts/handlers";

export const app = createApp({
  server: nativeServer(),
  middleware: [logging, errorHandler],
  routes: [
    { prefix: "/users", handlers: usersHandlers },
    { prefix: "/posts", handlers: postsHandlers, middleware: [requireAuth] },
  ],
});
```

---

## 5. Error Handling

### 5.1 Philosophy: Thrown Errors with Structured Error Classes

TypoKit uses **thrown errors, not Result types**. This is a deliberate choice optimized for AI agent ergonomics.

**Why not Result types:** Result types (`Result<T, E>`) force every caller to handle the error branch explicitly. In practice, AI agents generate boilerplate unwrapping code and frequently get it wrong — especially when chaining multiple Result-returning calls. The agent has to reason about both the happy path and the error path at every function boundary, increasing the surface area for mistakes.

**Why thrown errors work better:** Agents understand try/catch naturally. TypoKit's middleware pipeline provides centralized error handling — handlers throw, the framework catches and serializes consistently. The agent only thinks about the happy path in handler code. Crucially, centralized error handling enables the structured error context from Section 8.2 — the framework automatically attaches `sourceFile`, `schemaFile`, `relatedTests`, and `traceId` to every error. Result types would bury errors inside handler code where the framework can't enrich them.

### 5.2 Structured Error Class Hierarchy

```typescript
// @typokit/errors

export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

// Pre-built for common HTTP error cases
export class NotFoundError extends AppError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(code, 404, message, details);
  }
}

export class ValidationError extends AppError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(code, 400, message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(code, 401, message, details);
  }
}

export class ForbiddenError extends AppError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(code, 403, message, details);
  }
}

export class ConflictError extends AppError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(code, 409, message, details);
  }
}
```

### 5.3 `ctx.fail()` — Framework-Blessed Error Helper

Handlers can throw error classes directly, or use `ctx.fail()` as syntactic sugar. This gives AI agents a single, discoverable pattern to reach for without importing error classes:

```typescript
"GET /users/:id": async ({ params, ctx }) => {
  const user = await userService.findById(params.id, ctx);
  if (!user) return ctx.fail(404, "USER_NOT_FOUND", `User ${params.id} not found`);
  return user;
}

"POST /users": async ({ body, ctx }) => {
  const existing = await userService.findByEmail(body.email, ctx);
  if (existing) return ctx.fail(409, "EMAIL_TAKEN", `Email ${body.email} is already registered`);
  return userService.create(body, ctx);
}
```

`ctx.fail()` throws the appropriate `AppError` subclass internally based on the status code. The framework's error middleware catches it, serializes it into the `ErrorResponse` schema (with traceId, route context, and structured details), and returns the response.

### 5.4 Framework Error Middleware

The framework provides a built-in error handler that catches all `AppError` instances and serializes them into the `ErrorResponse` schema:

```typescript
// Built into @typokit/core — no configuration required

// AppError instances → structured ErrorResponse with full context
// Unknown errors → 500 with generic message (details logged, never leaked)
// Validation errors (from Typia) → 400 with field-level failure details
```

In development mode, unknown errors include stack traces and source locations. In production, they're redacted to prevent information leakage — full details are sent to the debug sidecar and logging pipeline instead.

---

## 6. Server Adapter Architecture — Bring Your Own Runtime

### 6.1 Philosophy: TypoKit Is Not an HTTP Server

TypoKit's real value is the schema-first type system, the Rust build pipeline, AI debugging, test generation, structured errors, and OTel integration. None of that is tied to how HTTP bytes come off the wire. The HTTP server is the most commoditized part of the stack — and existing frameworks like Fastify and Hono have years of battle-testing, performance tuning, and community plugins.

By making the server layer pluggable, TypoKit becomes a **schema-first toolkit that runs on top of whatever HTTP layer you prefer**. Teams already on Fastify don't have to rip it out — they add TypoKit on top.

TypoKit ships a native server (`@typokit/server-native`) as the default zero-dependency option. It's fast, simple, and the right choice for most projects. But the server adapter interface is public and documented — anyone can build an adapter for their preferred framework.

### 6.2 Ownership Boundaries

The server adapter interface draws a clear line between what TypoKit owns and what the adapter owns:

**TypoKit owns (regardless of adapter):**

| Concern | Why |
|---------|-----|
| Request validation (compiled validators) | Core schema-first value — must behave identically everywhere |
| Response serialization (fast-json-stringify) | Generated from types at build time — adapter-independent |
| Typed middleware pipeline (`defineMiddleware`, type narrowing) | TypoKit's middleware chain is type-aware — can't be delegated to framework-native middleware |
| Context creation (`ctx.log`, `ctx.fail()`, `ctx.user`) | Consistent DX and AI inspectability regardless of server |
| Error handling (`AppError` → `ErrorResponse`) | Structured error context requires centralized framework control |
| Request lifecycle tracing (OTel spans) | Observability must be consistent across adapters |
| Debug sidecar integration | AI debugging requires framework-level instrumentation |
| Compiled route table (as a portable data structure) | Produced by the Rust build pipeline — any adapter can consume it |

**The adapter owns:**

| Concern | Why |
|---------|-----|
| HTTP parsing, connection handling, keep-alive | Platform-specific, performance-sensitive I/O |
| Route registration (translate TypoKit route table → framework-native routes) | Each framework has its own routing API |
| Platform-specific optimizations | Bun's `Bun.serve()`, Hono's `c.text()`, etc. |
| Framework-native middleware/plugins | Fastify plugins, Hono middleware, Express middleware |

### 6.3 Request Processing Order

When a request arrives, framework-native middleware runs first (at the HTTP layer), then TypoKit's typed middleware runs on the normalized request. This ensures TypoKit always receives a correctly normalized `TypoKitRequest`:

```
Incoming HTTP Request
        │
        ▼
┌─────────────────────────────────────┐
│  Server Adapter (Fastify/Hono/etc.) │
│                                     │
│  1. HTTP parsing                    │
│  2. Framework-native middleware     │
│     (CORS, compression, etc.)       │
│  3. Normalize → TypoKitRequest      │
└─────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────┐
│  TypoKit Core Pipeline              │
│                                     │
│  4. TypoKit middleware chain        │
│     (auth, logging — type-aware)    │
│  5. Request validation              │
│     (compiled validators)           │
│  6. Handler execution               │
│  7. Response serialization          │
│  8. Error handling (if needed)      │
│  9. OTel span completion            │
└─────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────┐
│  Server Adapter                     │
│                                     │
│  10. Write TypoKitResponse → HTTP   │
└─────────────────────────────────────┘
```

**Why framework-native middleware runs first:** Concerns like CORS, compression, rate limiting, and request ID injection are HTTP-level concerns that should execute before TypoKit sees the request. This lets teams reuse their existing framework middleware without conflict. TypoKit's typed middleware runs after normalization, ensuring the type-narrowing system always receives a consistent `TypoKitRequest` shape.

### 6.4 The `ServerAdapter` Interface

```typescript
// @typokit/core/src/adapters/server.ts

export interface ServerAdapter {
  /** Adapter name for logging and diagnostics */
  name: string;

  /**
   * Register TypoKit's compiled routes into the server framework.
   * The adapter translates the route table into framework-native registrations.
   * Each route handler receives a normalized TypoKitRequest and must return
   * a TypoKitResponse.
   */
  registerRoutes(
    routeTable: CompiledRouteTable,
    handlerMap: HandlerMap,
    middlewareChain: MiddlewareChain,
  ): void;

  /**
   * Start the server. Returns a handle for shutdown.
   */
  listen(port: number): Promise<ServerHandle>;

  /**
   * Normalize the framework's native request into TypoKit's standard format.
   * This is where Fastify's `req`, Hono's `c`, or raw `http.IncomingMessage`
   * get normalized into a consistent shape for TypoKit's validation/handler
   * pipeline.
   */
  normalizeRequest(raw: unknown): TypoKitRequest;

  /**
   * Write TypoKit's response back through the framework's native response
   * mechanism.
   */
  writeResponse(raw: unknown, response: TypoKitResponse): void;

  /**
   * Optional: expose the underlying framework instance for escape hatches.
   * e.g., the raw Fastify instance so users can register Fastify-native plugins.
   * Returns `unknown` — consumers cast to the specific framework type.
   */
  getNativeServer?(): unknown;
}
```

### 6.5 Server Adapter Packages

```
packages/
  # TypoKit's own server — the default, zero-dependency option
  server-native/          # @typokit/server-native

  # Official adapters
  server-fastify/         # @typokit/server-fastify
  server-hono/            # @typokit/server-hono
  server-express/         # @typokit/server-express (migration path)

  # Platform adapters (orthogonal to server adapters)
  platform-node/          # @typokit/platform-node
  platform-bun/           # @typokit/platform-bun
  platform-deno/          # @typokit/platform-deno
```

**Server adapters** (which HTTP framework) and **platform adapters** (which JS runtime) are orthogonal concerns. You can combine them freely:

| | Node.js | Bun | Deno |
|---|---|---|---|
| **TypoKit Native** | ✅ | ✅ | ✅ |
| **Fastify** | ✅ | ✅ (via compat) | ❌ |
| **Hono** | ✅ | ✅ | ✅ |
| **Express** | ✅ | ✅ (via compat) | ❌ |
| **Community (e.g. Rust/hyper via napi-rs)** | ✅ | ❌ | ❌ |

**Rust-native targets** (via `--target rust` codegen — see Section 12.13):

| Target | Server | Database | Runtime |
|--------|--------|----------|---------|
| **Axum** | Axum 0.8 (Tokio) | sqlx 0.8 (PostgreSQL) | Native Rust binary |

When using `--target rust`, TypoKit generates a standalone Rust project instead of TypeScript runtime code. The generated Axum server consumes the same TypeScript schema but produces a native binary — no Node.js required at runtime.

### 6.6 Usage Examples

**Default — TypoKit's native server:**

```typescript
import { createApp } from "@typokit/core";
import { nativeServer } from "@typokit/server-native";

const app = createApp({
  server: nativeServer(),
  middleware: [logging, errorHandler],
  routes: [
    { prefix: "/users", handlers: usersHandlers },
  ],
});
```

**Fastify adapter — bring your existing Fastify setup:**

```typescript
import { createApp } from "@typokit/core";
import { fastifyServer } from "@typokit/server-fastify";

const app = createApp({
  server: fastifyServer({
    logger: true,
    trustProxy: true,
  }),
  middleware: [logging, errorHandler], // TypoKit middleware — same as always
  routes: [
    { prefix: "/users", handlers: usersHandlers },
  ],
});

// Escape hatch — access the raw Fastify instance for framework-native plugins
const fastify = app.getNativeServer() as FastifyInstance;
fastify.register(fastifyCors);
fastify.register(fastifyRateLimit);
```

**Hono adapter — runs anywhere Hono runs:**

```typescript
import { createApp } from "@typokit/core";
import { honoServer } from "@typokit/server-hono";

const app = createApp({
  server: honoServer(),
  middleware: [logging, errorHandler],
  routes: [
    { prefix: "/users", handlers: usersHandlers },
  ],
});

// Escape hatch — access the raw Hono instance
const hono = app.getNativeServer() as Hono;
hono.use("*", honoCompress());
```

### 6.7 The Native Server

`@typokit/server-native` is TypoKit's built-in server adapter. It's the default for new projects and the simplest option — zero external dependencies, optimized for TypoKit's compiled route tree.

Under the hood, it uses the platform's native HTTP module directly (`node:http`, `Bun.serve()`, or `Deno.serve()` depending on the platform adapter). It consumes the compiled radix tree from the Rust build pipeline for O(k) route lookup.

**When to use native:** New projects, simple APIs, maximum performance with minimal dependencies, or when you don't need an existing framework's plugin ecosystem.

**When to bring your own:** You have an existing Fastify/Hono/Express codebase and want to adopt TypoKit incrementally, or you need framework-specific plugins (Fastify's request validation hooks, Hono's Workers support, etc.).

### 6.8 Building a Custom Server Adapter

The `ServerAdapter` interface is public and documented. Community adapters follow the same pattern as official ones:

```typescript
// Example: minimal custom adapter skeleton

import type { ServerAdapter } from "@typokit/core";

export function myCustomServer(options?: MyOptions): ServerAdapter {
  let server: MyFramework;

  return {
    name: "my-custom-server",

    registerRoutes(routeTable, handlerMap, middlewareChain) {
      server = new MyFramework(options);

      // Walk the compiled route table and register each route
      // in the framework's native format
      for (const route of flattenRouteTable(routeTable)) {
        server.route(route.method, route.path, async (nativeReq, nativeRes) => {
          // Normalize → run TypoKit pipeline → write response
          const req = this.normalizeRequest(nativeReq);
          const res = await middlewareChain.execute(req, handlerMap[route.ref]);
          this.writeResponse(nativeRes, res);
        });
      }
    },

    async listen(port) {
      await server.listen(port);
      return { close: () => server.close() };
    },

    normalizeRequest(raw) {
      // Convert framework-native request → TypoKitRequest
      return { method, path, headers, body, query, params };
    },

    writeResponse(raw, response) {
      // Convert TypoKitResponse → framework-native response
      raw.status(response.status).json(response.body);
    },

    getNativeServer() {
      return server;
    },
  };
}
```

---

## 7. Database Layer — Adapter Pattern (Not an ORM)

### 7.1 Philosophy: Generate Types, Not Queries

TypoKit is **not an ORM**. It doesn't manage connections, build queries, or abstract SQL. Instead, it provides a thin adapter layer that generates database-compatible type definitions from your `@app/schema` types — and gets out of the way.

You bring your own database tool. TypoKit just bridges the gap between your TypeScript types and whatever query layer you prefer.

### 7.2 Supported Adapters

| Adapter | Generates | Use Case |
|---------|-----------|----------|
| `@typokit/db-drizzle` | Drizzle table definitions | Teams wanting type-safe SQL-close queries |
| `@typokit/db-kysely` | Kysely table interfaces | Teams wanting a pure type-safe query builder |
| `@typokit/db-prisma` | Prisma schema file | Teams already using Prisma |
| `@typokit/db-raw` | Plain SQL DDL + TypeScript interfaces | Teams writing raw SQL |
| Community adapters | Any format | Extend `DatabaseAdapter` interface |

### 7.3 Adapter Interface

Every adapter implements a single interface:

```typescript
// @typokit/core/src/adapters/database.ts

export interface DatabaseAdapter {
  /** Generate DB schema artifacts from TypoKit types */
  generate(types: SchemaTypeMap): GeneratedOutput[];

  /** Diff current DB state against types, produce migration draft */
  diff(types: SchemaTypeMap, currentState: DatabaseState): MigrationDraft;

  /** Generate typed repository helpers (optional — adapters can skip this) */
  generateRepositories?(types: SchemaTypeMap): GeneratedOutput[];
}

export interface GeneratedOutput {
  filePath: string;
  content: string;
  overwrite: boolean;
}

export interface MigrationDraft {
  name: string;
  sql: string;
  destructive: boolean;
  changes: SchemaChange[];
}
```

### 7.4 Example: Drizzle Adapter Output

```typescript
// AUTO-GENERATED by @typokit/db-drizzle from @app/schema User type
// Modify the source type in @app/schema/src/entities/user.ts instead

import { pgTable, uuid, varchar, timestamp, pgEnum } from "drizzle-orm/pg-core";

export const userStatusEnum = pgEnum("user_status", ["active", "suspended", "deleted"]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  displayName: varchar("display_name", { length: 100 }).notNull(),
  status: userStatusEnum("status").default("active").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```

### 7.5 Example: Raw SQL Adapter Output

```sql
-- AUTO-GENERATED by @typokit/db-raw from @app/schema User type
-- Migration: 20250227_001_create_users

CREATE TYPE user_status AS ENUM ('active', 'suspended', 'deleted');

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  display_name VARCHAR(100) NOT NULL,
  status user_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 7.6 Migration Philosophy

Migrations are **generated as drafts, never auto-applied**.

```bash
# Detects type changes in @app/schema, generates migration draft
typokit migrate:generate --name add-user-avatar

# Outputs structured diff for AI review  
typokit migrate:diff

# AI agent can inspect the migration
typokit inspect migration 20250227_add_user_avatar --format json
```

The framework never auto-applies destructive migrations (column drops, type changes). It generates them with `-- DESTRUCTIVE: requires review` comments and blocks CI until reviewed.

**TypoKit owns the schema-to-migration pipeline. Your chosen database tool owns everything after that — connections, queries, transactions, pooling.** The framework has no opinions on how you query your data.

---

## 8. Testing Architecture

### 8.1 Philosophy

> If the schema defines the contract, TypoKit can test the contract. Developers only write tests for business logic.

### 8.2 Auto-Generated Contract Tests

TypoKit generates baseline contract tests from route schemas:

```typescript
// Auto-generated: __generated__/users.contract.test.ts
// DO NOT EDIT — regenerated on schema change

import { describe, it, expect } from "vitest";
import { createTestClient } from "@typokit/testing";
import { app } from "../src/app";

const client = createTestClient(app);

describe("POST /users", () => {
  it("accepts valid CreateUserInput", async () => {
    const res = await client.post("/users", {
      body: { email: "test@example.com", displayName: "Test User" },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchSchema("PublicUser");
  });

  it("rejects missing required fields", async () => {
    const res = await client.post("/users", { body: {} });
    expect(res.status).toBe(400);
    expect(res.body).toMatchSchema("ErrorResponse");
  });

  it("rejects invalid email format", async () => {
    const res = await client.post("/users", {
      body: { email: "not-an-email", displayName: "Test" },
    });
    expect(res.status).toBe(400);
  });
});
```

### 8.3 Test Client — Zero Ceremony Integration Tests

The integration test client starts a real server instance. No mocks, no stubs — real HTTP, real validation, real middleware pipeline. Designed to be as frictionless as possible:

```typescript
// tests/integration/users.test.ts

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createIntegrationSuite } from "@typokit/testing";
import { app } from "../../src/app";

const suite = createIntegrationSuite(app, {
  // Real database — spins up a test container or uses a test schema
  database: true,
  // Seed data from fixtures derived from schema types
  seed: "default",
});

describe("Users API", () => {
  beforeAll(() => suite.setup());
  afterAll(() => suite.teardown());

  it("creates and retrieves a user", async () => {
    const created = await suite.client.post("/users", {
      body: { email: "integration@test.com", displayName: "Integration Test" },
    });

    expect(created.status).toBe(200);

    const fetched = await suite.client.get(`/users/${created.body.id}`);
    expect(fetched.body.email).toBe("integration@test.com");
  });
});
```

### 8.4 Test Factories from Types

TypoKit generates type-safe factories that produce valid fixture data:

```typescript
import { createFactory } from "@typokit/testing";
import { CreateUserInput } from "@app/schema";

const userFactory = createFactory<CreateUserInput>();

// Generates a fully valid CreateUserInput with random but valid data
const user = userFactory.build();

// Override specific fields
const admin = userFactory.build({ displayName: "Admin User" });

// Generate invalid variants for negative testing
const invalid = userFactory.buildInvalid("email"); // Invalid email specifically
```

### 8.5 CI Consistency

TypoKit's test runner enforces determinism:

- All auto-generated tests are idempotent — same schema always generates same tests
- Database tests use isolated schemas/transactions per test (auto-rolled back)
- No shared mutable state between tests by default
- Built-in test ordering and parallelization that respects database isolation
- Flaky test detection: if a test passes/fails inconsistently across 3 runs, it's flagged

---

## 9. AI Debugging & Introspection System

### 9.1 The TypoKit "Brain"

TypoKit exposes an introspection API — a structured, queryable interface to its internal state. AI agents can connect to this during development to understand exactly what the framework is doing.

```bash
# CLI introspection (returns structured JSON)
typokit inspect routes                    # All registered routes with schemas
typokit inspect route "GET /users/:id"    # Single route detail
typokit inspect middleware                # Full middleware chain with types
typokit inspect dependencies              # Service dependency graph
typokit inspect schema User               # Type details + where it's used
typokit inspect errors --last 10          # Recent errors with full context
typokit inspect performance --route "/users" # Latency percentiles, bottlenecks
typokit inspect server                    # Active server adapter + platform info
```

### 9.2 Structured Error Context

Every error emitted by TypoKit includes enough context for an AI agent to self-correct:

```json
{
  "error": "VALIDATION_FAILED",
  "traceId": "abc-123",
  "route": "POST /users",
  "phase": "request_validation",
  "schema": "CreateUserInput",
  "server": "fastify",
  "failures": [
    {
      "path": "$.email",
      "expected": "string & format:email",
      "received": "number (42)",
      "suggestion": "The 'email' field expects a valid email string. Check the request body construction."
    }
  ],
  "sourceFile": "src/routes/users/handlers.ts",
  "schemaFile": "@app/schema/src/entities/user.ts:8",
  "relatedTests": ["__generated__/users.contract.test.ts:15"]
}
```

### 9.3 Runtime Debug Server

The debug sidecar is provided by `@typokit/plugin-debug` and runs on a separate port. In development it starts automatically. In production it's opt-in with security controls.

**Development mode** (default: enabled, no auth):

```typescript
debugPlugin({ enabled: true })
// Starts on port 9800 by default
```

**Production mode** (opt-in, secured):

```typescript
debugPlugin({
  enabled: true,
  security: {
    /** API key required on all requests via X-Debug-Key header */
    apiKey: process.env.DEBUG_API_KEY,

    /** IP/CIDR allowlist — only these sources can reach the sidecar */
    allowlist: ["10.0.0.0/8", "172.16.0.0/12"],

    /** Bind to internal interface only — never exposed to public */
    host: "127.0.0.1",

    /** Rate limiting to prevent abuse */
    rateLimit: { windowMs: 60_000, maxRequests: 100 },

    /** Redact sensitive headers/body fields from request traces */
    redact: ["authorization", "cookie", "x-api-key", "*.password", "*.ssn"],
  },
})
```

**Production use cases for AI agents:**

| Agent Task | Debug Endpoint | Example |
|-----------|----------------|---------|
| Generate monitoring config | `GET /_debug/routes` | Agent reads all routes + expected response codes → generates Datadog/Grafana monitors |
| Adjust alerting thresholds | `GET /_debug/performance?window=24h` | Agent reads p50/p95/p99 latencies → updates alert thresholds |
| Diagnose incidents | `GET /_debug/errors?since=1h` | Agent reads structured errors → correlates with deploy timeline |
| Capacity planning | `GET /_debug/health` | Agent reads connection pool saturation, memory, event loop lag → recommends scaling |
| Generate runbooks | `GET /_debug/routes` + `GET /_debug/dependencies` | Agent maps the full service topology → generates incident response runbooks |

The debug sidecar in production is **read-only** — it exposes no mutation endpoints. It cannot modify routes, restart the server, or change configuration. It's a diagnostic viewport, nothing more.

### 9.4 Request Lifecycle Tracing

Every request records its full lifecycle as structured data, emitted as OpenTelemetry spans (see Section 10). The tracing captures both the server adapter phase and the TypoKit core pipeline:

```json
{
  "traceId": "abc-123",
  "route": "POST /users",
  "server": "fastify",
  "lifecycle": [
    { "phase": "received", "timestamp": "...", "durationMs": 0 },
    { "phase": "server:normalize", "timestamp": "...", "durationMs": 1 },
    { "phase": "middleware:logging", "timestamp": "...", "durationMs": 1 },
    { "phase": "middleware:auth", "timestamp": "...", "durationMs": 12 },
    { "phase": "validation:body", "timestamp": "...", "durationMs": 2, "result": "pass" },
    { "phase": "handler", "timestamp": "...", "durationMs": 45 },
    { "phase": "serialization", "timestamp": "...", "durationMs": 1 },
    { "phase": "server:write", "timestamp": "...", "durationMs": 0 },
    { "phase": "response", "timestamp": "...", "durationMs": 0, "status": 200 }
  ],
  "totalMs": 62
}
```

---

## 10. Observability — Logging & Telemetry

### 10.1 Philosophy

TypoKit ships a **built-in structured logger** that automatically correlates with OpenTelemetry traces. OTel is the foundation for tracing and metrics, but the logging API is TypoKit's own — simple, typed, and discoverable by AI agents.

OpenTelemetry's tracing and metrics APIs are excellent, but its logging API is still maturing and the DX isn't great for application-level logging. TypoKit bridges this gap: a thin, opinionated logger that feeds into OTel when configured.

### 10.2 The `ctx.log` API

Every handler and middleware receives a structured logger via context. Log entries are automatically enriched with request metadata:

```typescript
"POST /users": async ({ body, ctx }) => {
  ctx.log.info("Creating user", { email: body.email });
  // This log entry automatically includes:
  // - traceId (from OTel context)
  // - route ("POST /users")
  // - phase ("handler")
  // - requestId
  // - server adapter name

  const user = await userService.create(body, ctx);
  ctx.log.info("User created", { userId: user.id });
  return user;
}
```

Log levels: `trace`, `debug`, `info`, `warn`, `error`, `fatal`.

### 10.3 Log Sink Architecture

The logger emits structured JSON and routes to multiple sinks simultaneously:

```
ctx.log (TypoKit's API — simple, typed)
    │
    ├── Default sink: structured JSON to stdout (works everywhere, zero config)
    ├── OTel sink: pushes to OTel Collector via log bridge (opt-in)
    └── Debug sidecar sink: feeds /_debug/logs endpoint (dev mode)
```

All sinks receive the same structured data. The default stdout sink is always active and requires no configuration — `typokit dev` and `typokit build` apps emit structured JSON logs out of the box.

### 10.4 OpenTelemetry Integration

OTel powers tracing and metrics. The request lifecycle tracing from Section 9.4 maps directly to OTel spans — each middleware phase, validation step, and handler execution becomes a span.

```typescript
createApp({
  telemetry: {
    // Tracing: auto-instruments the request lifecycle
    tracing: true, // default: true in dev, configurable in prod

    // Metrics: request count, latency histograms, error rates
    metrics: true,

    // Export: where to send telemetry
    exporter: "otlp", // or "console" for dev
  },
});
```

**What's auto-instrumented:**

| Signal | Source | Example |
|--------|--------|---------|
| Traces | Request lifecycle | Each middleware, validation, handler phase = one span |
| Metrics | Request handling | `http.server.request.duration`, `http.server.active_requests`, error rate counters |
| Logs | `ctx.log` calls | Structured JSON with traceId correlation |

**Integration with the debug sidecar:**

The debug sidecar reads from the same OTel signals — `/_debug/performance` reads from metrics, `/_debug/errors` reads from the structured log stream, `/_debug/traces` reads from the trace store. No separate instrumentation required.

### 10.5 Configuration

```typescript
createApp({
  logging: {
    // Minimum log level (default: "info" in prod, "debug" in dev)
    level: "info",

    // Redact sensitive fields from log output
    redact: ["*.password", "*.token", "authorization"],
  },
  telemetry: {
    tracing: true,
    metrics: true,
    exporter: "otlp",
    // OTel Collector endpoint (default: http://localhost:4318)
    endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    // Service name for OTel resource
    serviceName: "my-api",
  },
});
```

---

## 11. OpenAPI & Client Generation

### 11.1 OpenAPI as Build Artifact

TypoKit generates a complete OpenAPI 3.1 spec from the route contracts and TypeScript types. This is never hand-written.

```bash
typokit generate:openapi --output ./dist/openapi.json
```

### 11.2 Type-Safe Client Generation

From the same contracts, TypoKit generates a type-safe fetch client:

```typescript
// Auto-generated: @app/client/src/index.ts

import { createClient } from "@typokit/client";
import type { UsersRoutes } from "@app/schema";

const api = createClient<UsersRoutes>({ baseUrl: "http://localhost:3000" });

// Fully typed — autocomplete on routes, params, query, body, and response
const users = await api.get("/users", { query: { page: 1, pageSize: 10 } });
// typeof users = PaginatedResponse<PublicUser>

const user = await api.post("/users", {
  body: { email: "new@user.com", displayName: "New User" },
});
// typeof user = PublicUser
```

---

## 12. Build Pipeline — Native Rust Transform

### 12.1 The Split: Rust Builds, TypeScript Runs

TypoKit draws a hard line between **build time** and **runtime**:

| Phase | Language | Rationale |
|-------|----------|-----------|
| **Build time** — AST parsing, type extraction, codegen, route compilation, OpenAPI generation, schema diffing | **Rust** (via napi-rs) | CPU-intensive computation that benefits from native performance. Developers experience this as build speed. |
| **Runtime** — server adapters, middleware, handlers, error handling, logging, debug sidecar | **TypeScript** | AI agents must be able to read, trace, and modify runtime behavior. Native code behind FFI boundaries breaks the "AI-inspectable at every layer" tenet. |

This follows the proven pattern established by SWC, Turbopack, Biome, oxc, and Lightning CSS — Rust core for heavy computation, JS/TS interface for developer interaction. No native code runs in production (unless the user explicitly opts into a Rust-based server adapter). No FFI in the default hot path.

```
Build Time (Rust via napi-rs)              Runtime (TypeScript)
─────────────────────────────              ──────────────────────
                                           
@typokit/transform-native                 @typokit/core
  ├── TS AST parsing                         ├── ServerAdapter interface
  ├── Type metadata extraction               ├── Middleware pipeline
  ├── Route tree compilation                 ├── Handler execution
  ├── OpenAPI spec generation                ├── Error handling (AppError)
  ├── Schema diffing (migrations)            ├── ctx.log
  ├── Test stub generation                   └── Plugin lifecycle
  ├── Validator codegen (Typia callback)
  └── Rust codegen (Axum/sqlx target)      @typokit/server-native (TS)
@typokit/cli (calls native transform)     @typokit/server-fastify (TS)
                                           @typokit/server-hono (TS)
                                           
                                           @typokit/plugin-debug (TS)
                                             └── Debug sidecar
                                           
                                           @typokit/platform-*
                                             ├── platform-node
                                             ├── platform-bun
                                             └── platform-deno
```

### 12.2 The Problem with TS Compiler Plugins

The "plain TypeScript → runtime validation" magic requires a **TypeScript compiler transform** that runs at build time. This is the single highest-risk DX surface in the framework. Custom TS transforms are notorious for:

- Breaking with TypeScript version upgrades
- Not integrating cleanly with bundlers (Webpack, Rspack, Vite, esbuild)
- Causing headaches in monorepo tools (Nx, Turborepo)
- Confusing AI agents that don't understand the transform step

TS compiler plugins (`ttypescript`, `ts-patch`) require patching the TypeScript installation. This is fragile, invisible to bundlers, and a nightmare in Nx/Turborepo workspaces. By owning the build command and implementing the transform in Rust, TypoKit avoids all of these problems. The transform is a **pre-compilation code generation step** — it reads TypeScript source, generates plain TypeScript files, and then standard tools compile them normally.

### 12.3 Strategy: TypoKit-Owned Build Command

Rather than asking users to configure a TS transform into their existing build tool, TypoKit owns the build step entirely:

```bash
# TypoKit IS the build tool for the server package
typokit build              # Production build
typokit dev                # Dev mode with watch + debug sidecar
```

Under the hood:
1. TypoKit's **Rust-native transform** runs first — parsing TypeScript ASTs, extracting type metadata, and generating optimized validator functions, route tables, and schema artifacts into a `.typokit/` cache directory
2. Then it invokes the user's chosen TypeScript compiler (tsc, tsup, SWC) on the transformed output
3. The two-step process is invisible to the user — one command, one output

```
@app/schema (pure TS)
       │
       ▼
┌─────────────────────────────┐
│  TypoKit Native Transform   │  ← Rust via napi-rs — TypoKit owns this step
│  - Parse TS ASTs            │
│  - Extract type metadata    │
│  - Generate route table     │
│  - Generate OpenAPI spec    │
│  - Generate test stubs      │
│  - Validator codegen        │
│    (Typia callback to JS)   │
│  Output: .typokit/          │
└─────────────────────────────┘
       │
       ▼
┌─────────────────────────────┐
│  Standard TS Compile        │  ← user's existing toolchain
│  (tsc / tsup / SWC)        │
│  Output: dist/              │
└─────────────────────────────┘
```

### 12.4 Native Transform Architecture

The Rust transform is published as a prebuilt native binary via napi-rs, supporting all major platforms:

```
@typokit/transform-native
  ├── src/                         # Rust source
  │   ├── parser.rs                # TS AST parsing (using swc_ecma_parser)
  │   ├── type_extractor.rs        # JSDoc + type metadata extraction
  │   ├── route_compiler.rs        # Radix tree construction + serialization
  │   ├── openapi_generator.rs     # OpenAPI 3.1 spec generation
  │   ├── schema_differ.rs         # Type diff for migration generation
  │   ├── test_stub_generator.rs   # Contract test scaffolding
  │   └── typia_bridge.rs          # napi-rs callback to Typia JS API
  │
  ├── npm/                         # Prebuilt platform packages
  │   ├── darwin-arm64/            # @typokit/transform-native-darwin-arm64
  │   ├── darwin-x64/              # @typokit/transform-native-darwin-x64
  │   ├── linux-arm64-gnu/         # @typokit/transform-native-linux-arm64-gnu
  │   ├── linux-x64-gnu/           # @typokit/transform-native-linux-x64-gnu
  │   ├── linux-x64-musl/          # @typokit/transform-native-linux-x64-musl
  │   └── win32-x64-msvc/          # @typokit/transform-native-win32-x64-msvc
  │
  └── index.js                     # JS entry — loads correct platform binary
```

**Platform support:** macOS (arm64, x64), Linux (arm64 GNU, x64 GNU, x64 musl for Alpine/Docker), Windows (x64 MSVC). Published via napi-rs's standard platform-specific optional dependencies pattern — `npm install` automatically selects the right binary for the current platform.

**CI/Docker consideration:** The `linux-x64-musl` target ensures the native transform works in Alpine-based Docker images (common in CI environments). No Rust toolchain required on the user's machine — prebuilt binaries only.

### 12.5 Typia Integration via napi-rs Callback

Typia is a TypeScript transformer written in TypeScript. Rather than rewriting Typia's validation logic in Rust (which would take months and produce an inferior result), TypoKit uses a **callback pattern** — the Rust transform handles everything except validation codegen, then calls back into Typia's JS API for that step.

```
Rust Transform Pipeline
────────────────────────────────────────────────────────────

1. Parse TS source files (swc_ecma_parser)        ← Rust
2. Extract type metadata (JSDoc, generics, unions) ← Rust
3. Generate route table + radix tree               ← Rust
4. Generate OpenAPI spec                           ← Rust
5. Generate test stubs                             ← Rust
6. Generate schema diff (migrations)               ← Rust
7. For each type needing validation:               
   ├── Pass type metadata to JS via napi-rs        ← Rust → JS boundary
   ├── Typia generates validator code              ← JS (Typia)
   └── Receive generated validator as string       ← JS → Rust boundary
8. Collect all outputs → write to .typokit/        ← Rust
```

**Why this hybrid works:**

Typia handles hundreds of edge cases in TypeScript validation — union discrimination, template literals, mapped types, conditional types, recursive types. It's best-in-class for exactly this problem. Steps 1–6 and 8 are where the heavy computation lives (AST parsing and traversal), and those run at native speed. Step 7 crosses the JS boundary only for validation codegen, which is a fraction of the total work.

**Dependency boundary:**

```
@typokit/transform-native (Rust)
  └── swc_ecma_parser (Rust crate — TS AST parsing)
  └── napi-rs (Rust crate — JS interop)
  └── Calls into:
      @typokit/transform-typia (JS/TS)
        └── typia (npm dependency — pinned to known-good version in lockfile)
        └── Thin wrapper that:
            1. Receives type metadata from Rust transform
            2. Calls Typia's programmatic API to generate validators
            3. Returns generated validator code as strings
            4. Handles Typia version compatibility
```

If Typia's maintenance situation changes, `@typokit/transform-typia` is the only package that needs replacement — either with a fork or a custom validator generator. The Rust transform and all other TypoKit packages are unaffected.

### 12.6 The `.typokit/` Directory

```
.typokit/
  validators/
    User.validator.ts          # Generated validation function (via Typia)
    CreateUserInput.validator.ts
  routes/
    route-table.ts             # Compiled route registry
    compiled-router.ts         # Compiled radix tree
  schemas/
    openapi.json               # Generated OpenAPI spec
  tests/
    users.contract.test.ts     # Generated contract tests
  client/
    index.ts                   # Generated type-safe client
```

This directory is:
- **Gitignored** — generated on build, never committed
- **Inspectable** — AI agents can read it to understand what TypoKit produced (all outputs are TypeScript/JSON, not Rust artifacts)
- **Cacheable** — only regenerated when source types change (content-hash based)

### 12.7 Tapable Build Pipeline

TypoKit's build step is internally structured as a **tapable hook pipeline**, inspired by Rspack/Webpack's plugin architecture. The hooks are exposed as a **TypeScript API** — plugin authors write hooks in TypeScript, and the Rust transform calls them at the appropriate points via napi-rs.

```typescript
// @typokit/core/src/build/pipeline.ts

export interface BuildPipeline {
  hooks: {
    /** Runs before any transforms — plugins can register additional type sources */
    beforeTransform: AsyncSeriesHook<[BuildContext]>;

    /** Runs after types are parsed — plugins can inspect/modify the type map */
    afterTypeParse: AsyncSeriesHook<[SchemaTypeMap, BuildContext]>;

    /** Runs after validators are generated — plugins can add custom validators */
    afterValidators: AsyncSeriesHook<[GeneratedOutput[], BuildContext]>;

    /** Runs after the route table is compiled */
    afterRouteTable: AsyncSeriesHook<[CompiledRouteTable, BuildContext]>;

    /** Runs after all generation — plugins emit their own artifacts */
    emit: AsyncSeriesHook<[GeneratedOutput[], BuildContext]>;

    /** Runs after build completes — cleanup, reporting */
    done: AsyncSeriesHook<[BuildResult]>;
  };
}
```

**Plugins tap into specific build phases (in TypeScript):**

```typescript
// @typokit/plugin-ws/src/build.ts

import type { TypoKitPlugin } from "@typokit/core";

export const wsPlugin: TypoKitPlugin = {
  name: "@typokit/plugin-ws",

  onBuild(pipeline) {
    // After types are parsed, extract WebSocket channel contracts
    pipeline.hooks.afterTypeParse.tap("ws-plugin", (typeMap, ctx) => {
      const wsChannels = extractWsChannels(typeMap);
      ctx.set("wsChannels", wsChannels);
    });

    // At emit phase, generate WS handler types and validators
    pipeline.hooks.emit.tap("ws-plugin", (outputs, ctx) => {
      const wsChannels = ctx.get("wsChannels");
      if (wsChannels.length > 0) {
        outputs.push(
          generateWsValidators(wsChannels),
          generateWsRouteTable(wsChannels),
        );
      }
    });
  },
};
```

**How hooks interact with the Rust pipeline:** The Rust transform drives the overall pipeline execution. At each hook point, it calls back into JS via napi-rs to execute registered plugin hooks. The `SchemaTypeMap`, `CompiledRouteTable`, and other data structures are serialized to JS-friendly formats at the boundary. Plugin hooks run in JS, and their outputs (additional `GeneratedOutput[]` entries) are collected back by Rust for final file writing.

**Why tapable hooks:**

- Plugins run at precise points in the pipeline — no ambiguity about ordering
- Each hook receives typed context — AI agents can reason about what data is available at each phase
- Hooks are async-series by default — no race conditions, deterministic execution
- The pipeline is inspectable: `typokit inspect build-pipeline --json` shows all registered hooks and their order
- Plugin authors write TypeScript, not Rust — the native boundary is invisible to them

### 12.8 Integration with Existing Build Tools

TypoKit's build step integrates as a `prebuild` hook, not a plugin:

**package.json (simple):**
```json
{
  "scripts": {
    "build": "typokit build",
    "dev": "typokit dev"
  }
}
```

**Nx workspace:**
```json
{
  "targets": {
    "build": {
      "executor": "@typokit/nx:build"
    }
  }
}
```

**Turborepo:**
```json
{
  "pipeline": {
    "build": {
      "dependsOn": ["^build"]
    }
  }
}
```

The Nx executor and Turborepo integration are thin wrappers — they just call `typokit build` with the right working directory. No custom Webpack/Rspack loaders. No plugin configuration. One command that works everywhere.

TypoKit's own repo is an **Nx monorepo** (see Section 12.11 for the full package map). End-user projects are monorepo-agnostic — TypoKit provides adapter packages for popular tools, but doesn't require any specific one.

### 12.9 Dev Mode Fast Refresh

In `typokit dev`, the native transform runs incrementally:

- File watcher detects changes to `@app/schema` types
- Rust transform re-parses only changed files (AST cache in memory)
- Only affected validators/routes are regenerated (dependency graph tracked in Rust)
- Hot reload applies changes without full restart
- Debug sidecar stays running across reloads

Target: **< 50ms from file save to server ready with updated routes.**

### 12.10 Build Performance Targets

| Metric | Target | Comparison (pure TS approach) |
|--------|--------|-------------------------------|
| Cold build (50 types, 20 routes) | < 500ms | ~2-4s with ts-morph |
| Cold build (200 types, 100 routes) | < 2s | ~10-15s with ts-morph |
| Incremental rebuild (1 type changed) | < 50ms | ~500ms-1s with ts-morph |
| Hot reload (dev mode, 1 file) | < 50ms | ~200ms with ts-morph |
| Memory usage (200 types) | < 100MB | ~300-500MB with ts-morph |

These targets are achievable because the Rust transform uses SWC's parser (which is already proven to be 20-70x faster than TypeScript's own parser) and performs all AST traversal, metadata extraction, and code generation in native memory without JS garbage collection pressure.

### 12.11 TypoKit Package Map (Nx Monorepo)

TypoKit itself is developed as an Nx monorepo. Every package has a clear responsibility and minimal coupling:

```
packages/
  core/                          # @typokit/core — ServerAdapter interface, middleware,
                                 #   handler execution, error handling, plugin lifecycle (TS)
  cli/                           # @typokit/cli — build, dev, inspect, generate commands (TS)
  testing/                       # @typokit/testing — test client, factories, contract gen (TS)
  client/                        # @typokit/client — generated type-safe fetch client (TS)

  # Build & Transform (Rust + TS bridge)
  transform-native/              # @typokit/transform-native — Rust AST transform (napi-rs)
                                 #   includes rust_codegen/ module for Axum/sqlx target
  transform-typia/               # @typokit/transform-typia — Typia validation bridge (TS)

  # Server Adapters (TS)
  server-native/                 # @typokit/server-native — built-in server (raw platform HTTP
                                 #   + compiled radix tree)
  server-fastify/                # @typokit/server-fastify — Fastify adapter
  server-hono/                   # @typokit/server-hono — Hono adapter
  server-express/                # @typokit/server-express — Express adapter (migration path)

  # Platform Adapters (TS — orthogonal to server adapters)
  platform-node/                 # @typokit/platform-node — Node.js platform support
  platform-bun/                  # @typokit/platform-bun — Bun platform support
  platform-deno/                 # @typokit/platform-deno — Deno platform support

  # Database Adapters (TS)
  db-drizzle/                    # @typokit/db-drizzle — Drizzle schema generation
  db-kysely/                     # @typokit/db-kysely — Kysely type generation
  db-prisma/                     # @typokit/db-prisma — Prisma schema generation
  db-raw/                        # @typokit/db-raw — Plain SQL DDL generation

  # Plugins (TS)
  plugin-ws/                     # @typokit/plugin-ws — WebSocket support
  plugin-debug/                  # @typokit/plugin-debug — Debug sidecar server

  # Observability (TS)
  otel/                          # @typokit/otel — OpenTelemetry integration + log bridge

  # Monorepo Integrations (TS — for end-user projects)
  nx/                            # @typokit/nx — Nx executor + generator
  turbo/                         # @typokit/turbo — Turborepo integration helpers

  # Frontend Client Adapters (TS)
  client-react-query/            # @typokit/client-react-query — React Query hooks
  client-swr/                    # @typokit/client-swr — SWR hooks

  # Shared (TS)
  types/                         # @typokit/types — shared type definitions
  errors/                        # @typokit/errors — structured error class hierarchy

  # Example Applications
  example-todo-server-axum/      # Rust codegen reference app (Axum + sqlx + PostgreSQL)
```

### 12.12 Plugin Architecture

Plugins extend TypoKit at both build time and runtime. This is how WebSocket support, the debug sidecar, and future extensions hook in without bloating core.

```typescript
// Plugin interface (TypeScript — plugins never need Rust)
export interface TypoKitPlugin {
  name: string;

  /** Hook into the build pipeline — tap into specific build phases */
  onBuild?(pipeline: BuildPipeline): void;

  /** Hook into server startup — register middleware, services, resources */
  onStart?(app: AppInstance): Promise<void>;

  /** Fires after all routes are registered and the server is listening.
   *  Use for service discovery, health check readiness, warmup. */
  onReady?(app: AppInstance): Promise<void>;

  /** Observe unhandled errors — reporting, transformation (e.g. Sentry).
   *  Called after the framework's error middleware serializes the response. */
  onError?(error: AppError, ctx: RequestContext): void;

  /** Hook into server shutdown — cleanup connections, flush buffers */
  onStop?(app: AppInstance): Promise<void>;

  /** Dev mode only — fires when schema types change and the build regenerates.
   *  Use to refresh cached state (e.g. debug sidecar route map). */
  onSchemaChange?(changes: SchemaChange[]): void;

  /** Expose CLI subcommands */
  commands?(): CliCommand[];

  /** Expose introspection endpoints for the debug sidecar */
  inspect?(): InspectEndpoint[];
}
```

**Why no `onRequest`/`onResponse` hooks:**

Plugins that need per-request behavior (rate limiting, CORS, compression, request ID injection) register middleware during `onStart` — using TypoKit's existing middleware system. For HTTP-level concerns that need to run before TypoKit's pipeline, plugins can access the native server via `app.getNativeServer()` and register framework-native middleware there (e.g., Fastify plugins). This avoids creating a parallel execution model that would confuse AI agents about what runs when.

```typescript
// Example: a plugin that registers both TypoKit and framework-native middleware
export const securityPlugin: TypoKitPlugin = {
  name: "@typokit/plugin-security",

  async onStart(app) {
    // TypoKit middleware — runs after normalization, type-aware
    app.useMiddleware(csrfProtection(this.config), { priority: -50 });

    // Framework-native middleware — runs before normalization, at HTTP level
    const native = app.getNativeServer();
    if (native && 'register' in native) {
      // Fastify-specific: register helmet for security headers
      (native as FastifyInstance).register(fastifyHelmet);
    }
  },
};
```

**Plugin registration is explicit — no auto-discovery:**

```typescript
// @app/server/src/app.ts

import { createApp } from "@typokit/core";
import { fastifyServer } from "@typokit/server-fastify";
import { wsPlugin } from "@typokit/plugin-ws";
import { debugPlugin } from "@typokit/plugin-debug";

export const app = createApp({
  server: fastifyServer({ trustProxy: true }),
  plugins: [
    wsPlugin({ /* ws config */ }),
    debugPlugin({ enabled: process.env.NODE_ENV === "development" }),
  ],
  middleware: [logging, errorHandler],
  routes: [
    { prefix: "/users", handlers: usersHandlers },
  ],
});
```

**WebSocket plugin example — same schema-first pattern:**

```typescript
// @app/server/src/ws/contracts.ts

import { RouteContract } from "@app/schema";

export interface WsChannels {
  "notifications": {
    /** Messages the server sends to the client */
    serverToClient: { type: "new_message"; payload: PublicMessage }
      | { type: "user_joined"; payload: PublicUser };

    /** Messages the client sends to the server */
    clientToServer: { type: "subscribe"; channel: string }
      | { type: "unsubscribe"; channel: string };
  };
}
```

```typescript
// @app/server/src/ws/handlers.ts

import { defineWsHandlers } from "@typokit/plugin-ws";
import { WsChannels } from "./contracts";

export default defineWsHandlers<WsChannels>({
  "notifications": {
    onConnect: async ({ ctx }) => { /* ... */ },
    onMessage: async ({ data, ctx }) => {
      // data is typed as WsChannels["notifications"]["clientToServer"]
    },
    onDisconnect: async ({ ctx }) => { /* ... */ },
  },
});
```

### 12.13 Rust Codegen Target

TypoKit's build pipeline can emit a complete, standalone **Rust project** instead of TypeScript runtime code. Running `typokit build --target rust` generates an Axum web server backed by sqlx and PostgreSQL — from the same TypeScript schemas used for TypeScript targets.

#### Architecture & Adapter Pattern

The Rust codegen target follows the same adapter philosophy as the TypeScript server and database adapters (Sections 6 and 7). TypoKit owns the schema, validation rules, and route contracts. The Rust codegen module (`transform-native/src/rust_codegen/`) translates these into idiomatic Rust code:

```
TypeScript Schema Source                 Generated Rust Project
──────────────────────                   ──────────────────────

@app/schema/                             .typokit/          ← Regenerated (overwrite: true)
  entities/user.ts        ──build──→       models/           ← Structs + serde + validator
  entities/todo.ts                         db/               ← PgPool + CRUD repository
  contracts/users.ts                       router.rs         ← Axum Router
  contracts/todos.ts                       app.rs            ← AppState
                                           error.rs          ← AppError enum
                                           migrations/       ← SQL DDL

                                         src/               ← User-owned (overwrite: false)
                                           handlers/         ← Axum handler functions
                                           services/         ← Business logic stubs
                                           middleware/       ← Auth middleware stub
                                           main.rs           ← Tokio entrypoint
                                           lib.rs            ← Module bridge
                                         Cargo.toml         ← Dependencies
```

The generated project splits into two ownership zones:

| Directory | Owner | `overwrite` | Purpose |
|-----------|-------|-------------|---------|
| `.typokit/` | Framework | `true` | Regenerated on every build — models, DB layer, router, migrations |
| `src/handlers/` | Developer | `false` | Handler stubs generated once, then user-maintained |
| `src/services/` | Developer | `false` | Service layer stubs — business logic lives here |
| `src/middleware/` | Developer | `false` | Auth middleware stub — customize for real auth |
| `src/main.rs` | Framework | `true` | Tokio entrypoint with tracing + DB pool init |
| `src/lib.rs` | Framework | `true` | Module bridge using `#[path]` to reference `.typokit/` |
| `Cargo.toml` | Framework | `true` | Dependencies: axum, tokio, serde, sqlx, validator, etc. |

#### Codegen Sub-Modules

The `rust_codegen` module is organized into focused sub-modules inside `transform-native/src/rust_codegen/`:

| Module | Output Files | Responsibility |
|--------|-------------|----------------|
| `structs.rs` | `.typokit/models/*.rs` | Entity structs, validation annotations, utility type resolution, union enums |
| `router.rs` | `.typokit/router.rs` | Axum `Router<AppState>` with typed route registrations |
| `database.rs` | `.typokit/db/*.rs`, `.typokit/migrations/*.sql` | PgPool setup, CRUD repository functions, SQL migrations |
| `handlers.rs` | `src/handlers/*.rs` | Per-entity handler stubs wired to repository calls |
| `services.rs` | `src/services/*.rs` | Service-layer stubs with CRUD function signatures |
| `middleware.rs` | `src/middleware/*.rs` | Auth middleware stub using `axum::middleware::from_fn` |
| `project.rs` | `Cargo.toml`, `src/main.rs`, `src/lib.rs`, `.typokit/app.rs`, `.typokit/error.rs` | Project scaffold tying everything together |

#### TypeScript → Rust Type Mapping

| TypeScript Type | Rust Type | Notes |
|----------------|-----------|-------|
| `string` | `String` | |
| `number` | `f64` | Default for general numbers |
| `number` (with `@integer`) | `i64` | JSDoc override for integer context |
| `number` (pagination params) | `u32` | Inferred from context (page, pageSize) |
| `boolean` | `bool` | |
| `Date` | `chrono::DateTime<Utc>` | Requires `chrono` crate with serde feature |
| `T[]` / `Array<T>` | `Vec<T>` | |
| `T \| undefined` / optional | `Option<T>` | |
| `"a" \| "b" \| "c"` (union literals) | `enum` with `#[serde(rename)]` | Generates Rust enum with per-variant renames |
| `Omit<T, K>` | Concrete struct (fields removed) | Resolved at codegen time |
| `Partial<T>` | Concrete struct (all `Option<T>`) | Resolved at codegen time |
| `Pick<T, K>` | Concrete struct (only picked fields) | Resolved at codegen time |

#### TypeScript → PostgreSQL Column Type Mapping

| TypeScript Type | PostgreSQL Type | Notes |
|----------------|----------------|-------|
| `string` | `TEXT` | |
| `number` | `DOUBLE PRECISION` | Default numeric type |
| `number` (with `@integer`) | `BIGINT` | |
| `boolean` | `BOOLEAN` | |
| `Date` | `TIMESTAMPTZ` | Timestamp with timezone |
| `T[]` / `Array<T>` | `JSONB` | Stored as JSON |
| `"a" \| "b"` (union literals) | `TEXT` | Stored as text, validated in application |

#### JSDoc Annotation → Rust Attribute Mapping

**Validation annotations** (validator crate v0.19):

| JSDoc Tag | Rust Attribute | Example |
|-----------|---------------|---------|
| `@minLength N` | `#[validate(length(min = N))]` | `@minLength 2` → `#[validate(length(min = 2))]` |
| `@maxLength N` | `#[validate(length(max = N))]` | `@maxLength 100` → `#[validate(length(max = 100))]` |
| `@format email` | `#[validate(email)]` | |
| `@pattern regex` | `#[validate(regex(path = "RE_..."))]` | Generates `Lazy<Regex>` static |
| `@minimum N` | `#[validate(range(min = N))]` | `@minimum 0` → `#[validate(range(min = 0))]` |
| `@maximum N` | `#[validate(range(max = N))]` | `@maximum 999` → `#[validate(range(max = 999))]` |

Structs with any validation annotations automatically receive `#[derive(Validate)]`.

**Entity and database annotations** (sqlx):

| JSDoc Tag | Rust / SQL Effect |
|-----------|-------------------|
| `@table name` | `#[derive(sqlx::FromRow)]` on struct; `CREATE TABLE name` in migration |
| `@id` | Property used as `PRIMARY KEY` in migration |
| `@generated uuid` | `uuid::Uuid::new_v4().to_string()` in INSERT (excluded from input struct) |
| `@generated now` | `chrono::Utc::now()` in INSERT (excluded from input struct) |
| `@unique` | `UNIQUE` constraint on column in migration |

#### CLI Usage

```bash
# Generate Rust project from TypeScript schemas
typokit build --target rust

# Specify output directory
typokit build --target rust --out ./my-server

# Specify database adapter (only sqlx supported currently)
typokit build --target rust --db sqlx

# Default TypeScript target (unchanged behavior)
typokit build
typokit build --target typescript
```

Content-hash caching (`.typokit/.cache-hash`) applies to Rust codegen — unchanged schemas skip regeneration.

#### Reference Implementation

See `packages/example-todo-server-axum/` for a complete working example that demonstrates the Rust codegen target end-to-end. It reuses `@typokit/example-todo-schema` as the TypeScript type source, producing a fully functional Axum API server with the same endpoints as the TypeScript `example-todo-server`.

---

## 13. Performance Architecture

### 13.1 Compile-Time Over Runtime

TypoKit does as much as possible at build time, leveraging the native Rust transform for maximum build speed:

| Concern | Approach | Build Cost | Runtime Cost |
|---------|----------|-----------|-------------|
| Validation | Compiled to optimized assertion functions (Typia via Rust pipeline) | Native speed | Near-zero |
| Serialization | Compiled fast-json-stringify schemas | Native speed | 2-5x faster than JSON.stringify |
| Routing | Compiled radix tree loaded at startup | Native speed | O(k) lookup by path depth |
| Type checking | TypeScript compiler — zero runtime | Standard tsc | Zero |
| OpenAPI generation | Build step output (Rust) | Native speed | Zero |

### 13.2 Compiled Radix Tree Router

TypoKit compiles the route table at build time into a serialized radix tree — combining the lookup efficiency of a trie with the zero-startup-cost of a static map. The route tree is compiled by the Rust transform and serialized as plain TypeScript for runtime consumption.

The compiled radix tree is consumed directly by `@typokit/server-native`. Other server adapters (Fastify, Hono) may use the compiled route table as a data structure to register routes in their own format, or consume the radix tree directly — the adapter chooses.

#### How It Works

```
Build Time (Rust transform)               Runtime (TypeScript)
─────────────────────────────             ──────────────────────
                                          
Route contracts scanned (Rust)            Serialized tree loaded (no construction)
        │                                         │
        ▼                                         ▼
Radix tree constructed in Rust memory     Incoming path traverses tree: O(k)
        │                                 where k = path segment depth
        ▼                                         │
Tree serialized to .typokit/                      ▼
routes/compiled-router.ts (plain TS)      Static segments: direct child lookup
                                          Param segments: single wildcard match
                                          Result: handler ref + extracted params
```

#### Compiled Output

The build step produces a human/AI-readable router file:

```typescript
// .typokit/routes/compiled-router.ts — AUTO-GENERATED by Rust transform

import type { CompiledRoute } from "@typokit/core";

export const routeTree: CompiledRoute = {
  segment: "",
  children: {
    "users": {
      segment: "users",
      handlers: {
        GET: { ref: "users#list", middleware: ["logging"] },
        POST: { ref: "users#create", middleware: ["logging", "auth"] },
      },
      paramChild: {
        paramName: "id",
        handlers: {
          GET: { ref: "users#getById", middleware: ["logging"] },
          PUT: { ref: "users#update", middleware: ["logging", "auth"] },
        },
        children: {
          "posts": {
            segment: "posts",
            handlers: {
              GET: { ref: "users#listPosts", middleware: ["logging"] },
            },
          },
        },
      },
    },
    "health": {
      segment: "health",
      handlers: {
        GET: { ref: "health#check", middleware: [] },
      },
    },
  },
};
```

#### Why This Approach

| Property | Benefit |
|----------|---------|
| **Compiled at build time (in Rust)** | Zero tree construction at startup — loaded as a static object. Build-time compilation is native speed. |
| **Radix tree structure** | O(k) lookup by path depth, not route count. 5-segment path = 5 node traversals regardless of whether the app has 10 or 1,000 routes |
| **AI-inspectable** | The generated file is plain TypeScript — an AI agent can read it and trace exactly how a request will route |
| **Static routes are direct lookups** | `/health` resolves in a single object property access |
| **Parameterized routes are explicit** | Each node has at most one `paramChild` — no ambiguity, no backtracking |
| **Middleware chain visible** | Each route entry shows its full middleware stack — no runtime resolution |
| **Portable** | Any server adapter can consume the compiled route table as data |

#### Performance Targets (native server)

| Metric | Target | Comparison |
|--------|--------|------------|
| Static route lookup | < 100ns | `find-my-way`: ~250ns |
| Parameterized route lookup | < 200ns | `find-my-way`: ~300ns |
| Route table load time | < 1ms (require/import) | `find-my-way`: ~5-10ms tree construction |
| Memory overhead | Proportional to route count | Same as radix tree |

Note: When using Fastify or Hono server adapters, routing performance is determined by the adapter's framework. The compiled route table is still used — the adapter translates it into framework-native route registrations.

#### Edge Cases

- **Param vs static priority**: Static segments always win. `/users/search` matches the `search` child before the `:id` param child. This is enforced at compile time (by the Rust transform) with a clear error if ambiguous routes are detected.
- **Wildcard/catch-all**: Supported via a `wildcardChild` property on nodes. `/files/*path` captures the remaining segments. Only one wildcard per node depth.
- **Trailing slashes**: Normalized at compile time. `/users/` and `/users` resolve identically.
- **405 Method Not Allowed**: If a node matches but the HTTP method doesn't, the router returns 405 with an `Allow` header listing valid methods — generated automatically from the route table.

### 13.3 Runtime Targets (Native Server)

The native server (`@typokit/server-native`) is a thin TypeScript layer over the platform's native HTTP module. No Express, no Fastify underneath — just the compiled router, compiled validators, and optimized serialization.

**Benchmark targets** (simple JSON response, single route, native server):

| Metric | Target |
|--------|--------|
| Overhead above raw platform HTTP | < 50μs |
| Throughput vs raw platform HTTP | > 90% |
| Cold start (50-route app) | < 100ms |

When using Fastify or Hono adapters, runtime performance is determined by those frameworks' characteristics. TypoKit's overhead on top (validation, context creation, middleware) remains the same regardless of adapter.

---

## 14. Developer Experience & AI Agent Workflow

### 14.1 CLI Commands

```bash
# Scaffolding
typokit init                          # New project from template
typokit add route users               # Scaffold route module
typokit add service auth              # Scaffold service

# Build
typokit build                         # Build TypeScript target (default)
typokit build --target rust           # Generate Rust/Axum project from TS schemas
typokit build --target rust --out dir # Specify output directory
typokit build --target rust --db sqlx # Specify DB adapter (sqlx only, currently)

# Code Generation
typokit generate:db                   # Generate DB schema from types
typokit generate:client               # Generate API client from contracts
typokit generate:openapi              # Generate OpenAPI spec
typokit generate:tests                # Regenerate contract tests

# Inspection (AI-optimized, returns JSON with --json flag)
typokit inspect routes --json         # Route table
typokit inspect schema User --json    # Type introspection
typokit inspect deps --json           # Dependency graph
typokit inspect build-pipeline --json # Build hook registration order
typokit inspect server --json         # Active server adapter + platform info

# Database
typokit migrate:generate              # Generate migration from type diff
typokit migrate:diff                  # Show pending changes
typokit migrate:apply                 # Apply migrations

# Testing
typokit test                          # Run all tests
typokit test:contracts                # Run generated contract tests only
typokit test:integration              # Run integration tests with real services

# Development
typokit dev                           # Dev server with debug sidecar
typokit dev --debug-port 9800         # Custom debug port
```

### 14.2 AI Agent Integration Pattern

TypoKit is designed for this workflow:

```
1. AI modifies types in @app/schema
2. AI runs `typokit generate:db` → gets migration draft
3. AI runs `typokit generate:tests` → contract tests update
4. AI implements handler logic
5. AI runs `typokit test:contracts` → validates against schema
6. AI runs `typokit test:integration` → validates full stack
7. If tests fail → AI queries `typokit inspect errors --json`
8. AI reads structured error, self-corrects, loops to step 4
```

### 14.3 Diff Minimization

TypoKit enforces file-per-concern so that changes are atomic:

- One type change = one file in `@app/schema`
- One route change = one `contracts.ts` + one `handlers.ts`
- One migration = one timestamped migration file
- Auto-generated code is in `.typokit/` and `__generated__/` — never mixed with human/AI code

### 14.4 No Rust Toolchain Required

End users **never need Rust installed**. The native transform is distributed as prebuilt binaries via napi-rs's platform-specific optional dependencies. `npm install` resolves the correct binary for the current platform automatically. This is the same pattern used by SWC (`@swc/core`), Turbopack, and Biome.

Contributing to TypoKit's Rust transform code requires Rust, but using the framework does not.

---

## 15. Open Questions & Decisions Needed

| # | Question | Options | Status |
|---|----------|---------|--------|
| 1 | **Framework name** | — | ✅ Decided: TypoKit (`@typokit`) — Type Outputs Kit |
| 2 | **TS transformer approach** | Typia direct, fork, custom, or hybrid? | ✅ Decided: Hybrid — Rust native transform for AST parsing/codegen, Typia for validation via napi-rs callback |
| 3 | **HTTP layer** | Raw `http`, uWebSockets.js, or thin Fastify wrapper? | ✅ Decided: Pluggable `ServerAdapter` interface — bring your own server. Native server as default, official Fastify/Hono/Express adapters. See Section 6. |
| 4 | **Database approach** | Built-in ORM vs adapter pattern? | ✅ Decided: Adapter pattern — pluggable, no ORM |
| 5 | **Runtime compatibility** | Node-only, or also Bun/Deno? | ✅ Decided: Node.js, Bun, and Deno via platform adapters (orthogonal to server adapters) |
| 6 | **Auth patterns** | Built-in JWT/session support, or auth-agnostic? | ✅ Decided: Auth-agnostic with typed middleware narrowing |
| 7 | **WebSocket support** | First-class in core, or separate package? | ✅ Decided: Official plugin package (`@typokit/plugin-ws`), same schema-first pattern |
| 8 | **Framework repo monorepo tooling** | Turborepo, Nx, or pnpm workspaces only? | ✅ Decided: Nx monorepo for TypoKit's own repo |
| 9 | **End-user monorepo support** | Prescribe a tool or be agnostic? | ✅ Decided: Agnostic — official adapter packages for Nx, Turborepo, etc. |
| 10 | **Frontend client framework** | React-only, or framework-agnostic fetch client? | ✅ Decided: Framework-agnostic fetch client in core; React Query, SWR, etc. as separate packages |
| 11 | **Router implementation** | Radix tree, trie, or static compiled map? | ✅ Decided: Compiled radix tree — built at compile time in Rust, zero startup cost. Consumed by native server directly; other adapters use as registration data. |
| 12 | **Debug sidecar security** | Dev-only, or available in production with auth? | ✅ Decided: Dev-only by default, documented secure production mode with API key + allowlist |
| 13 | **Build pipeline architecture** | Monolithic build or plugin hooks? | ✅ Decided: Tapable hook pipeline — Rust drives execution, plugins hook in via TypeScript |
| 14 | **Minimum Node.js version** | 18, 20, 22, or 24? | ✅ Decided: Node.js 24 (current LTS) |
| 15 | **Typia vendoring strategy** | npm dependency, vendored fork, or subset extraction? | ✅ Decided: npm dependency with pinned version in lockfile. Typia called via napi-rs callback from Rust transform. Isolation boundary via `@typokit/transform-typia` wrapper. |
| 16 | **Runtime plugin hooks granularity** | How granular should runtime plugin hooks be? | ✅ Decided: No `onRequest`/`onResponse` hooks — plugins register TypoKit middleware via `onStart` or framework-native middleware via `getNativeServer()`. Added `onReady`, `onError`, and `onSchemaChange` hooks. |
| 17 | **Error handling strategy** | Result types, thrown errors, or hybrid? | ✅ Decided: Thrown errors with structured `AppError` class hierarchy + `ctx.fail()` syntactic sugar. See Section 5. |
| 18 | **Logging abstraction** | Built-in logger, or bring-your-own (pino, winston)? | ✅ Decided: Built-in structured logger (`ctx.log`) with automatic OTel trace correlation. See Section 10. |
| 19 | **Build pipeline language** | Pure TypeScript or native (Rust/C++)? | ✅ Decided: Rust via napi-rs for the build transform pipeline. TypeScript for runtime. See Section 12. |
| 20 | **Server layer architecture** | Monolithic or pluggable? | ✅ Decided: Pluggable `ServerAdapter` interface. TypoKit ships `@typokit/server-native` as default. Official adapters for Fastify, Hono, Express. Community can build any adapter, including Rust-native HTTP. See Section 6. |

---

## 16. Non-Goals (v1)

To keep the scope tight and the framework lightweight:

- **No built-in frontend framework** — the client package generates typed fetch calls, not React components
- **No GraphQL** — REST-first; GraphQL adapter could come later as a plugin
- **No built-in job queues** — provide patterns and examples, but don't bundle a queue
- **No serverless-first** — optimize for long-running processes; serverless adapters are community packages
- **No built-in ORM or query builder** — the DB adapter layer generates schemas and types; you bring your own Drizzle/Kysely/Prisma/raw SQL
- **No Rust at runtime (by default)** — the native/TS split is a hard boundary. Runtime stays in TypeScript for AI inspectability. Community server adapters may use native HTTP layers, but TypoKit's default is pure TypeScript.

---

## Appendix A: Comparison with Existing Frameworks

| Feature | Express | Fastify | NestJS | Hono | TypoKit |
|---------|---------|---------|--------|------|---------|
| Schema source | None (bring your own) | JSON Schema | Decorators + class-validator | Zod (optional) | Plain TypeScript |
| Type safety | Manual | Good (with TypeBox) | Good (with transforms) | Excellent | Complete — types are the app |
| AI agent predictability | Low (too flexible) | Medium | Medium (decorator complexity) | High | Maximum (one way to do everything) |
| Build performance | N/A | N/A | Moderate (TS compiler) | N/A | Native Rust transform via napi-rs |
| Runtime overhead | Medium | Low | High | Very Low | Near-zero (compiled away) |
| Multi-runtime | Node only | Node only | Node only | Node, Bun, Deno, Workers | Node, Bun, Deno (via platform adapters) |
| Server layer | Monolithic | Monolithic | Monolithic | Monolithic | Pluggable — native, Fastify, Hono, Express, or custom |
| Test generation | None | None | None | None | Automatic from schema |
| AI debugging | None | None | None | None | First-class debug sidecar (dev + prod) |
| Frontend client | Manual | Manual | Manual (or Swagger codegen) | Hono RPC | Auto-generated, type-safe |
| DB integration | Manual | Manual | TypeORM/Prisma | Manual | Pluggable adapters (Drizzle, Kysely, Prisma, raw SQL) |
| Plugin system | Middleware only | Encapsulated plugins | Modules + DI | Middleware only | Build-time (Rust) + runtime (TS) tapable hooks |
| WebSocket | ws (manual) | @fastify/websocket | @nestjs/websockets | Hono WSS | Schema-typed plugin (@typokit/plugin-ws) |
| Error handling | Manual | Manual | Exception filters | Manual | Structured `AppError` hierarchy + `ctx.fail()` |
| Observability | Manual | Manual | Manual | Manual | Built-in structured logging + OTel tracing/metrics |
