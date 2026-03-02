# PRD: TypoKit v1 — AI-Native Node.js Framework

## Introduction

TypoKit (`@typokit`) is a TypeScript-native Node.js framework where **plain TypeScript types are the single source of truth** for the entire stack — API validation, database schema, frontend contracts, documentation, and test generation. It is designed from the ground up so AI coding agents produce correct, consistent code on the first attempt, and can self-diagnose when they don't.

The framework compiles away abstractions at build time via a native Rust pipeline (napi-rs), provides pluggable server and database adapters, generates contract tests and type-safe clients from schemas, and exposes structured introspection APIs for AI debugging.

This PRD covers the full v1 release: all core packages, adapters, plugins, CLI, and a reference application — organized into phased user stories suitable for implementation by AI coding agents.

**Architecture Reference:** See `typokit-arch.md` for the full architectural document.

---

## Goals

- Ship all `@typokit/*` packages as open-source npm packages under the `@typokit` scope
- Achieve schema-first type system where a single TypeScript interface drives validation, DB schema, API docs, client types, and test factories
- Deliver a Rust-native build pipeline (via napi-rs) that transforms TypeScript types into runtime artifacts at native speed
- Provide pluggable `ServerAdapter` interface with a built-in native server and official Fastify/Hono/Express adapters
- Provide pluggable `DatabaseAdapter` interface with Drizzle, Kysely, Prisma, and raw SQL adapters
- Auto-generate contract tests, test factories, OpenAPI specs, and type-safe API clients from route contracts
- Deliver first-class AI debugging via a structured introspection API and debug sidecar
- Ship built-in structured logging with OpenTelemetry trace correlation
- Support Node.js 24+, with Bun and Deno via platform adapters
- Validate the entire framework with a reference application (todo API)

---

## Phased Build Plan

The stories are organized into 13 phases. Each phase depends on the completion of prior phases as indicated. Stories within a phase can generally be implemented in parallel unless noted.

```
Phase 1:  Foundation (@typokit/types, @typokit/errors, @typokit/core interfaces)
Phase 2:  Build Pipeline (@typokit/transform-typia, @typokit/transform-native, @typokit/cli)
Phase 3:  Server & Routing (@typokit/server-native, @typokit/platform-node)
Phase 4:  Database Adapters (@typokit/db-drizzle, db-kysely, db-prisma, db-raw)
Phase 5:  Testing Framework (@typokit/testing)
Phase 6:  Client Generation (@typokit/client)
Phase 7:  Observability (@typokit/otel)
Phase 8:  Plugins (@typokit/plugin-debug, @typokit/plugin-ws)
Phase 9:  Additional Server Adapters (@typokit/server-fastify, server-hono, server-express)
Phase 10: Additional Platform Adapters (@typokit/platform-bun, @typokit/platform-deno)
Phase 11: Frontend Client Adapters (@typokit/client-react-query, client-swr)
Phase 12: Monorepo Integrations (@typokit/nx, @typokit/turbo)
Phase 13: Reference Application (@typokit/example-todo-*)
```

---

## User Stories

### Phase 1: Foundation

> **Depends on:** Nothing (this is the starting point)
> **Packages:** `@typokit/types`, `@typokit/errors`, `@typokit/core` (interfaces only)

---

#### US-001: Initialize Nx Monorepo
**Description:** As a framework developer, I need the TypoKit repository set up as an Nx monorepo with pnpm (but not pnpm workspaces Nx is the only monorepo tool) so that all packages can be developed, built, and tested in a single repository.

**Acceptance Criteria:**
- [ ] Nx monorepo initialized with pnpm as package manager
- [ ] `packages/` directory structure created per the package map in the architecture doc (Section 12.11)
- [ ] TypeScript project references configured for inter-package dependencies
- [ ] Root `tsconfig.base.json` with strict mode enabled, path aliases for `@typokit/*`
- [ ] Root `.gitignore` includes `.typokit/`, `__generated__/`, `node_modules/`, `dist/`
- [ ] Root `package.json`
- [ ] Nx workspace configured with build, test, and lint targets
- [ ] Rstest configured as the test runner across all packages
- [ ] ESLint configured with a shared base config
- [ ] CI pipeline (GitHub Actions) for build + test on push/PR
- [ ] All packages compile with `nx run-many --target=build`
- [ ] Typecheck passes across the entire monorepo

---

#### US-002: Create @typokit/types — Shared Type Definitions
**Description:** As a framework developer, I need a shared types package that defines all core type interfaces used across TypoKit packages, so that every package imports from a single canonical source.

**Acceptance Criteria:**
- [ ] Package `@typokit/types` created at `packages/types/`
- [ ] `RouteContract<TParams, TQuery, TBody, TResponse>` interface defined
- [ ] `PaginatedResponse<T>` interface defined
- [ ] `ErrorResponse` interface defined (with `traceId` field)
- [ ] `TypoKitRequest` interface defined (method, path, headers, body, query, params)
- [ ] `TypoKitResponse` interface defined (status, headers, body)
- [ ] `CompiledRouteTable` and `CompiledRoute` types defined (radix tree node structure with segment, children, paramChild, wildcardChild, handlers)
- [ ] `HandlerMap` type defined (maps handler refs to handler functions)
- [ ] `MiddlewareChain` interface defined
- [ ] `RequestContext` interface defined (logger, fail(), services, etc.)
- [ ] `SchemaTypeMap` type defined (maps type names to extracted metadata)
- [ ] `GeneratedOutput` interface defined (filePath, content, overwrite)
- [ ] `MigrationDraft` interface defined (name, sql, destructive, changes)
- [ ] `SchemaChange` type defined (for schema diffing)
- [ ] `ServerHandle` interface defined (close method)
- [ ] `BuildContext` and `BuildResult` types defined
- [ ] All types exported from package entry point
- [ ] Package builds successfully
- [ ] Typecheck passes

---

#### US-003: Create @typokit/errors — Structured Error Class Hierarchy
**Description:** As a framework developer, I need a shared error package with structured error classes so that all TypoKit packages and user code use consistent, typed errors that include contextual information for AI debugging.

**Acceptance Criteria:**
- [ ] Package `@typokit/errors` created at `packages/errors/`
- [ ] `AppError` base class extending `Error` with `code` (string), `status` (number), `message` (string), `details` (optional Record)
- [ ] `NotFoundError` class (status 404)
- [ ] `ValidationError` class (status 400)
- [ ] `UnauthorizedError` class (status 401)
- [ ] `ForbiddenError` class (status 403)
- [ ] `ConflictError` class (status 409)
- [ ] Factory function `createAppError(status, code, message, details?)` that returns the correct subclass based on status code
- [ ] All error classes are JSON-serializable into the `ErrorResponse` schema
- [ ] Unit tests for each error class (correct status, code, message, serialization)
- [ ] Unit test for the factory function
- [ ] Package builds successfully
- [ ] Typecheck passes

---

#### US-004: Create @typokit/core — ServerAdapter Interface
**Description:** As a framework developer, I need the `ServerAdapter` interface defined in `@typokit/core` so that server adapters (native, Fastify, Hono, Express) can implement a standardized contract.

**Acceptance Criteria:**
- [ ] Package `@typokit/core` created at `packages/core/`
- [ ] `ServerAdapter` interface defined with: `name`, `registerRoutes()`, `listen()`, `normalizeRequest()`, `writeResponse()`, `getNativeServer?()`
- [ ] Method signatures match Section 6.4 of the architecture document
- [ ] Interface exported from `@typokit/core`
- [ ] Typecheck passes

---

#### US-005: Create @typokit/core — DatabaseAdapter Interface
**Description:** As a framework developer, I need the `DatabaseAdapter` interface defined in `@typokit/core` so that database adapters (Drizzle, Kysely, Prisma, raw SQL) can implement a standardized contract.

**Acceptance Criteria:**
- [ ] `DatabaseAdapter` interface defined with: `generate()`, `diff()`, `generateRepositories?()`
- [ ] Method signatures match Section 7.3 of the architecture document
- [ ] Interface exported from `@typokit/core`
- [ ] Typecheck passes

---

#### US-006: Create @typokit/core — Plugin Interface
**Description:** As a framework developer, I need the `TypoKitPlugin` interface defined in `@typokit/core` so that plugins can hook into both build-time and runtime lifecycle events.

**Acceptance Criteria:**
- [ ] `TypoKitPlugin` interface defined with: `name`, `onBuild?()`, `onStart?()`, `onReady?()`, `onError?()`, `onStop?()`, `onSchemaChange?()`, `commands?()`, `inspect?()`
- [ ] `BuildPipeline` interface defined with tapable hooks: `beforeTransform`, `afterTypeParse`, `afterValidators`, `afterRouteTable`, `emit`, `done`
- [ ] `AsyncSeriesHook<T>` type defined for the hook system
- [ ] `CliCommand` and `InspectEndpoint` types defined
- [ ] All types match Section 12.12 of the architecture document
- [ ] Interface exported from `@typokit/core`
- [ ] Typecheck passes

---

#### US-007: Create @typokit/core — Middleware System
**Description:** As a framework developer, I need a typed middleware system in `@typokit/core` that supports context type narrowing, so that middleware can add typed properties to the request context.

**Acceptance Criteria:**
- [ ] `defineMiddleware<TContext>()` function implemented — takes an async function, returns typed middleware
- [ ] Middleware receives `{ headers, body, query, params, ctx }` and returns additional context properties
- [ ] Middleware chain executor implemented — runs middleware in order, accumulates context types
- [ ] Middleware can short-circuit (throw errors to stop the chain)
- [ ] `ctx.fail(status, code, message, details?)` helper implemented — throws the appropriate `AppError` subclass
- [ ] `ctx.log` placeholder defined (actual implementation in Phase 7)
- [ ] Middleware priority ordering supported (numeric priority, lower runs first)
- [ ] Unit tests: middleware chain runs in order, context accumulates, short-circuit works, `ctx.fail()` throws correct error
- [ ] Typecheck passes

---

#### US-008: Create @typokit/core — Handler System
**Description:** As a framework developer, I need the `defineHandlers<TRoutes>()` function in `@typokit/core` so that route handlers receive fully typed, validated context and the type system enforces contract compliance.

**Acceptance Criteria:**
- [ ] `defineHandlers<TRoutes>()` function implemented — maps route keys (e.g., `"GET /users"`) to handler functions
- [ ] Each handler receives `{ params, query, body, ctx }` with types inferred from the `RouteContract`
- [ ] Handler return type must match the `TResponse` type from the contract
- [ ] Type errors if handler signature doesn't match contract
- [ ] Unit tests: handler definitions type-check against contracts, handler execution returns expected response shape
- [ ] Typecheck passes

---

#### US-009: Create @typokit/core — App Factory (createApp)
**Description:** As a framework developer, I need the `createApp()` factory function in `@typokit/core` so that users can compose a TypoKit application from a server adapter, middleware, routes, and plugins.

**Acceptance Criteria:**
- [ ] `createApp()` function implemented — accepts `{ server, middleware?, routes, plugins?, logging?, telemetry? }`
- [ ] Routes accept `{ prefix, handlers, middleware? }` objects
- [ ] Plugins array is iterated and lifecycle hooks are registered
- [ ] `app.listen(port)` delegates to the server adapter
- [ ] `app.getNativeServer()` delegates to the server adapter
- [ ] Plugin `onStart` hooks are called during `app.listen()`
- [ ] Plugin `onReady` hooks are called after the server is listening
- [ ] Plugin `onStop` hooks are called during `app.close()`
- [ ] Error middleware is automatically registered (catches `AppError`, serializes to `ErrorResponse`, unknown errors → 500)
- [ ] Unit tests: app creation, route registration, plugin lifecycle hooks called in correct order
- [ ] Typecheck passes

---

#### US-010: Create @typokit/core — Error Middleware
**Description:** As a framework developer, I need built-in error middleware in `@typokit/core` that catches all thrown errors and serializes them into the `ErrorResponse` schema.

**Acceptance Criteria:**
- [ ] Error middleware catches `AppError` instances and serializes to `ErrorResponse` with correct status, code, message, details, and traceId
- [ ] Unknown errors (non-`AppError`) serialize as 500 with generic message — details are never leaked to the client
- [ ] In development mode (`NODE_ENV=development`), unknown errors include stack traces and source locations
- [ ] In production mode, unknown errors are redacted — full details are logged but not returned
- [ ] Validation errors from Typia-generated validators produce 400 with field-level failure details
- [ ] Unit tests: `AppError` serialization, unknown error redaction, development vs production mode behavior
- [ ] Typecheck passes

---

### Phase 2: Build Pipeline

> **Depends on:** Phase 1 (types, errors, core interfaces)
> **Packages:** `@typokit/transform-typia`, `@typokit/transform-native`, `@typokit/cli`

---

#### US-011: Create @typokit/transform-typia — Typia Validation Bridge
**Description:** As a framework developer, I need a TypeScript wrapper around Typia's programmatic API so that the Rust transform can call into Typia for validation code generation via napi-rs.

**Acceptance Criteria:**
- [ ] Package `@typokit/transform-typia` created at `packages/transform-typia/`
- [ ] Typia installed as a dependency (pinned to a known-good version)
- [ ] `generateValidator(typeMetadata: TypeMetadata): string` function — receives extracted type metadata, calls Typia's programmatic API, returns generated validator code as a string
- [ ] `generateValidatorBatch(types: TypeMetadata[]): Map<string, string>` for batch generation
- [ ] Handles Typia edge cases: union discrimination, template literals, mapped types, conditional types, recursive types
- [ ] Error handling: if Typia fails for a type, returns a descriptive error with the type name and failure reason
- [ ] Unit tests: generate validators for simple types, union types, nested types, array types, optional fields
- [ ] Package builds successfully
- [ ] Typecheck passes

---

#### US-012: Create @typokit/transform-native — Rust AST Transform (napi-rs)
**Description:** As a framework developer, I need the Rust-native transform pipeline that parses TypeScript ASTs, extracts type metadata, and generates runtime artifacts (route tables, OpenAPI specs, test stubs, schema diffs) at native speed.

**Acceptance Criteria:**
- [ ] Package `@typokit/transform-native` created at `packages/transform-native/`
- [ ] Rust crate initialized with napi-rs for Node.js interop
- [ ] SWC's `swc_ecma_parser` used for TypeScript AST parsing
- [ ] `parser.rs` — parses TypeScript source files into ASTs
- [ ] `type_extractor.rs` — extracts type metadata from interfaces, including JSDoc tags (`@table`, `@id`, `@generated`, `@format`, `@unique`, `@minLength`, `@maxLength`, `@default`, `@onUpdate`)
- [ ] `route_compiler.rs` — builds a radix tree from route contracts, serializes as TypeScript
- [ ] `openapi_generator.rs` — generates OpenAPI 3.1 spec from route contracts and extracted types
- [ ] `schema_differ.rs` — diffs two `SchemaTypeMap` versions and produces a `MigrationDraft`
- [ ] `test_stub_generator.rs` — generates contract test scaffolding from route contracts
- [ ] `typia_bridge.rs` — calls into `@typokit/transform-typia` via napi-rs callback for validator codegen
- [ ] All outputs written to `.typokit/` directory structure (validators/, routes/, schemas/, tests/, client/)
- [ ] Content-hash based caching — only regenerate when source types change
- [ ] Prebuilt binaries for: macOS arm64, macOS x64, Linux arm64 GNU, Linux x64 GNU, Linux x64 musl (Alpine), Windows x64 MSVC
- [ ] JS entry point (`index.js`) that loads the correct platform binary
- [ ] Integration tests: parse a sample `@app/schema` with User type → verify all outputs generated correctly
- [ ] Build performance: cold build of 50 types + 20 routes completes in < 500ms
- [ ] Package builds successfully on all target platforms

---

#### US-013: Create @typokit/cli — Build Command
**Description:** As a framework developer, I need the `typokit build` CLI command so that users can run the full build pipeline (Rust transform → TS compile) with a single command.

**Acceptance Criteria:**
- [ ] Package `@typokit/cli` created at `packages/cli/`
- [ ] `typokit build` command implemented — runs the Rust transform, then invokes the user's TypeScript compiler (tsc, tsup, or SWC)
- [ ] Reads configuration from `typokit.config.ts` or `package.json` `"typokit"` field
- [ ] Transform outputs go to `.typokit/` directory
- [ ] Final compiled output goes to `dist/`
- [ ] Build errors are reported with structured context (source file, line, error type)
- [ ] Exit code 0 on success, non-zero on failure
- [ ] `--verbose` flag for detailed build step output
- [ ] Integration test: build a sample project end-to-end
- [ ] Typecheck passes

---

#### US-014: Create @typokit/cli — Dev Command
**Description:** As a framework developer, I need the `typokit dev` command so that developers get a hot-reloading development server with file watching and incremental rebuilds.

**Acceptance Criteria:**
- [ ] `typokit dev` command implemented — starts the build pipeline in watch mode + starts the server
- [ ] File watcher detects changes to `@app/schema` types and triggers incremental rebuild
- [ ] Incremental rebuild only re-parses changed files (AST cache in memory)
- [ ] Only affected validators/routes are regenerated (dependency graph tracked)
- [ ] Hot reload applies changes without full server restart
- [ ] `--debug-port <port>` flag to set the debug sidecar port (default: 9800)
- [ ] Target: < 50ms from file save to server ready with updated routes
- [ ] Console output shows rebuild status and timing
- [ ] Graceful shutdown on SIGINT/SIGTERM
- [ ] Typecheck passes

---

#### US-015: Create @typokit/cli — Inspect Commands
**Description:** As a framework developer, I need `typokit inspect` subcommands so that AI agents can query the framework's internal state as structured JSON.

**Acceptance Criteria:**
- [ ] `typokit inspect routes` — lists all registered routes with their schemas, middleware, and handler refs
- [ ] `typokit inspect route "GET /users/:id"` — detailed single route info
- [ ] `typokit inspect middleware` — full middleware chain with types
- [ ] `typokit inspect dependencies` — service dependency graph
- [ ] `typokit inspect schema <TypeName>` — type details and where it's used
- [ ] `typokit inspect errors --last <N>` — recent errors with full context
- [ ] `typokit inspect performance --route <path>` — latency percentiles (requires running server)
- [ ] `typokit inspect server` — active server adapter + platform info
- [ ] `typokit inspect build-pipeline` — registered build hooks and their order
- [ ] All commands support `--json` flag for structured JSON output (default: human-readable)
- [ ] All commands support `--format json` as an alias for `--json`
- [ ] Integration test: inspect a built sample project, verify JSON output is valid
- [ ] Typecheck passes

---

#### US-016: Create @typokit/cli — Generate Commands
**Description:** As a framework developer, I need `typokit generate:*` subcommands so that users can generate specific build artifacts on demand.

**Acceptance Criteria:**
- [ ] `typokit generate:db` — generates database schema artifacts using the configured database adapter
- [ ] `typokit generate:client` — generates the type-safe API client from route contracts
- [ ] `typokit generate:openapi` — generates the OpenAPI 3.1 spec (`--output <path>` flag)
- [ ] `typokit generate:tests` — regenerates contract tests from route schemas
- [ ] Each command reports what files were generated/updated
- [ ] Integration test: run each generate command on a sample project, verify outputs
- [ ] Typecheck passes

---

#### US-017: Create @typokit/cli — Migration Commands
**Description:** As a framework developer, I need `typokit migrate:*` subcommands so that users can generate and manage database migrations from schema type diffs.

**Acceptance Criteria:**
- [ ] `typokit migrate:generate --name <name>` — detects type changes in `@app/schema`, generates a migration draft file
- [ ] `typokit migrate:diff` — shows pending schema changes as a structured diff (human-readable by default, JSON with `--json`)
- [ ] `typokit migrate:apply` — applies pending migrations using the configured database adapter
- [ ] Destructive migrations (column drops, type changes) are flagged with `-- DESTRUCTIVE: requires review` comments
- [ ] Destructive migrations block CI until reviewed (configurable)
- [ ] Migration files are timestamped and named descriptively
- [ ] Integration test: modify a type, run generate, verify migration file produced
- [ ] Typecheck passes

---

#### US-018: Create @typokit/cli — Scaffold Commands
**Description:** As a framework developer, I need `typokit init` and `typokit add` scaffold commands so that users and AI agents can quickly create new projects, routes, and services.

**Acceptance Criteria:**
- [ ] `typokit init` — creates a new TypoKit project from a template (prompts for project name, server adapter, DB adapter)
- [ ] `typokit add route <name>` — scaffolds a new route module (`contracts.ts` + `handlers.ts` + `middleware.ts`) in the correct directory
- [ ] `typokit add service <name>` — scaffolds a new service file
- [ ] Scaffold templates are well-structured and match the conventions in the architecture doc (Section 4.4)
- [ ] Integration test: run `typokit init`, verify project structure, run `typokit build` on the generated project
- [ ] Typecheck passes

---

#### US-019: Create @typokit/cli — Test Commands
**Description:** As a framework developer, I need `typokit test` subcommands so that users can run tests with proper framework awareness.

**Acceptance Criteria:**
- [ ] `typokit test` — runs all tests (auto-detects the user's test runner: Jest, Vitest, or Rstest)
- [ ] `typokit test:contracts` — runs only auto-generated contract tests from `__generated__/`
- [ ] `typokit test:integration` — runs integration tests with in-memory database
- [ ] Test runner auto-detection: checks for `jest.config.*`, `vitest.config.*`, or `rstest.config.*` in the project root
- [ ] `--runner <jest|vitest|rstest>` flag to override auto-detection
- [ ] Test commands regenerate contract tests before running if schemas have changed
- [ ] Exit code reflects test results
- [ ] Typecheck passes

---

#### US-020: Build Pipeline — Tapable Hook System
**Description:** As a framework developer, I need the tapable hook system implemented so that plugins can hook into specific build phases.

**Acceptance Criteria:**
- [ ] `AsyncSeriesHook<T>` implementation — hooks execute in registration order, each receives the output of the previous
- [ ] `tap(name, callback)` method for registering hooks
- [ ] Hooks fire at the correct points in the Rust transform pipeline (via napi-rs callbacks)
- [ ] Build hooks: `beforeTransform`, `afterTypeParse`, `afterValidators`, `afterRouteTable`, `emit`, `done`
- [ ] Plugin-registered hooks receive correctly typed context at each phase
- [ ] `typokit inspect build-pipeline --json` shows all registered hooks and their order
- [ ] Unit tests: hooks fire in order, context passes through, multiple plugins can tap the same hook
- [ ] Typecheck passes

---

### Phase 3: Server & Routing

> **Depends on:** Phase 1 (core interfaces), Phase 2 (build pipeline generates route tables)
> **Packages:** `@typokit/server-native`, `@typokit/platform-node`

---

#### US-021: Create @typokit/platform-node — Node.js Platform Adapter
**Description:** As a framework developer, I need a Node.js platform adapter that provides platform-specific HTTP module access (`node:http`) so that server adapters can run on Node.js.

**Acceptance Criteria:**
- [ ] Package `@typokit/platform-node` created at `packages/platform-node/`
- [ ] Provides `createServer()` wrapping `node:http` (or `node:http2`)
- [ ] Handles Node.js-specific request/response stream handling
- [ ] Exports platform info (runtime name, version) for `typokit inspect server`
- [ ] Unit tests: server starts, handles a request, returns a response
- [ ] Package builds successfully
- [ ] Typecheck passes

---

#### US-022: Create @typokit/server-native — Built-In Server
**Description:** As a framework developer, I need TypoKit's native server adapter as the default zero-dependency HTTP server that consumes the compiled radix tree for O(k) route lookup.

**Acceptance Criteria:**
- [ ] Package `@typokit/server-native` created at `packages/server-native/`
- [ ] Implements the `ServerAdapter` interface from `@typokit/core`
- [ ] `nativeServer()` factory function returns a `ServerAdapter`
- [ ] `registerRoutes()` loads the compiled radix tree from `.typokit/routes/compiled-router.ts`
- [ ] Route lookup traverses the radix tree: static segments are direct child lookups, parameterized segments use `paramChild`
- [ ] `normalizeRequest()` converts `node:http.IncomingMessage` to `TypoKitRequest`
- [ ] `writeResponse()` converts `TypoKitResponse` to `node:http.ServerResponse`
- [ ] `listen(port)` starts the HTTP server on the specified port, returns a `ServerHandle`
- [ ] 404 response when no route matches
- [ ] 405 response with `Allow` header when route matches but HTTP method doesn't
- [ ] Trailing slashes normalized (both `/users/` and `/users` match)
- [ ] Integration tests: start server, send requests, verify routing, params extraction, 404/405 behavior
- [ ] Throughput target: > 90% of raw `node:http` throughput
- [ ] Cold start target: < 100ms for a 50-route app
- [ ] Package builds successfully
- [ ] Typecheck passes

---

#### US-023: Server-Native — Request Validation Pipeline
**Description:** As a framework developer, I need the native server to run compiled validators on incoming requests so that handlers receive fully validated, typed data.

**Acceptance Criteria:**
- [ ] Request body is validated against the compiled validator for the matched route's `TBody` type
- [ ] Request query parameters are parsed and validated against the `TQuery` type
- [ ] Request path parameters are extracted and validated against the `TParams` type
- [ ] Validation failures produce a 400 response with field-level error details matching `ErrorResponse` schema
- [ ] Validated data is passed to the handler as typed `{ params, query, body, ctx }`
- [ ] Integration tests: valid requests pass through, invalid requests get 400 with correct field errors
- [ ] Typecheck passes

---

#### US-024: Server-Native — Response Serialization
**Description:** As a framework developer, I need the native server to use compiled fast-json-stringify schemas for response serialization so that responses are serialized 2-5x faster than `JSON.stringify`.

**Acceptance Criteria:**
- [ ] Response bodies are serialized using `fast-json-stringify` schemas generated at build time
- [ ] Schemas are derived from route contract `TResponse` types
- [ ] Serialization handles all JSON types (strings, numbers, booleans, nulls, arrays, nested objects)
- [ ] Falls back to `JSON.stringify` if no compiled schema exists for a response type
- [ ] Content-Type header set to `application/json` automatically
- [ ] Integration tests: verify response bodies are correctly serialized
- [ ] Typecheck passes

---

### Phase 4: Database Adapters

> **Depends on:** Phase 1 (DatabaseAdapter interface), Phase 2 (type extraction from build pipeline)
> **Packages:** `@typokit/db-drizzle`, `@typokit/db-kysely`, `@typokit/db-prisma`, `@typokit/db-raw`

---

#### US-025: Create @typokit/db-drizzle — Drizzle Schema Generation
**Description:** As a framework developer, I need a Drizzle adapter that generates Drizzle table definitions from `@app/schema` types so that teams using Drizzle get auto-generated, type-safe schema files.

**Acceptance Criteria:**
- [ ] Package `@typokit/db-drizzle` created at `packages/db-drizzle/`
- [ ] Implements `DatabaseAdapter` interface
- [ ] `generate()` produces Drizzle table definitions from type metadata (JSDoc tags: `@table`, `@id`, `@generated`, `@format`, `@unique`, `@default`, etc.)
- [ ] Supports PostgreSQL column types: `uuid`, `varchar`, `text`, `integer`, `bigint`, `boolean`, `timestamp`, `jsonb`, `enum`
- [ ] Handles string union types → pgEnum generation
- [ ] Handles `@default` values, `@unique` constraints, `@generated uuid/now` auto-values
- [ ] `diff()` compares current Drizzle schema against types and produces a `MigrationDraft`
- [ ] Generated files include `// AUTO-GENERATED` header with source type reference
- [ ] Output matches the format in Section 7.4 of the architecture doc
- [ ] Unit tests: generate Drizzle schema from sample User type, verify column types, constraints, and enums
- [ ] Typecheck passes

---

#### US-026: Create @typokit/db-kysely — Kysely Type Generation
**Description:** As a framework developer, I need a Kysely adapter that generates Kysely table interface types from `@app/schema` types.

**Acceptance Criteria:**
- [ ] Package `@typokit/db-kysely` created at `packages/db-kysely/`
- [ ] Implements `DatabaseAdapter` interface
- [ ] `generate()` produces Kysely `Database` interface with table types
- [ ] Maps TypeScript types to Kysely column types correctly
- [ ] Handles all JSDoc metadata tags
- [ ] `diff()` produces migration drafts
- [ ] Unit tests: generate Kysely types from sample User type
- [ ] Typecheck passes

---

#### US-027: Create @typokit/db-prisma — Prisma Schema Generation
**Description:** As a framework developer, I need a Prisma adapter that generates a Prisma schema file from `@app/schema` types.

**Acceptance Criteria:**
- [ ] Package `@typokit/db-prisma` created at `packages/db-prisma/`
- [ ] Implements `DatabaseAdapter` interface
- [ ] `generate()` produces a `schema.prisma` file from type metadata
- [ ] Maps TypeScript types to Prisma field types correctly
- [ ] Handles all JSDoc metadata tags (`@id`, `@default`, `@unique`, `@generated`, etc.)
- [ ] `diff()` produces migration drafts
- [ ] Unit tests: generate Prisma schema from sample User type
- [ ] Typecheck passes

---

#### US-028: Create @typokit/db-raw — Raw SQL DDL Generation
**Description:** As a framework developer, I need a raw SQL adapter that generates plain SQL DDL and TypeScript interfaces from `@app/schema` types.

**Acceptance Criteria:**
- [ ] Package `@typokit/db-raw` created at `packages/db-raw/`
- [ ] Implements `DatabaseAdapter` interface
- [ ] `generate()` produces SQL `CREATE TABLE` statements and TypeScript interfaces
- [ ] Supports PostgreSQL dialect (CREATE TYPE for enums, UUID, TIMESTAMPTZ, etc.)
- [ ] Output matches the format in Section 7.5 of the architecture doc
- [ ] `diff()` produces `ALTER TABLE` migration drafts
- [ ] Destructive changes flagged with `-- DESTRUCTIVE: requires review` comment
- [ ] Unit tests: generate SQL from sample User type, verify DDL output
- [ ] Typecheck passes

---

### Phase 5: Testing Framework

> **Depends on:** Phase 1 (core interfaces), Phase 2 (test stub generation), Phase 3 (server for integration tests)
> **Packages:** `@typokit/testing`

---

#### US-029: Create @typokit/testing — Test Client
**Description:** As a framework developer, I need a test client that can send typed HTTP requests to a TypoKit app in tests, so that contract and integration tests require zero ceremony.

**Acceptance Criteria:**
- [ ] Package `@typokit/testing` created at `packages/testing/`
- [ ] `createTestClient(app)` function — starts the app on a random port and returns a typed client
- [ ] Client methods: `get(path, options?)`, `post(path, options?)`, `put(path, options?)`, `patch(path, options?)`, `delete(path, options?)`
- [ ] Options include `body`, `query`, `headers`
- [ ] Response includes `status`, `body` (parsed JSON), `headers`
- [ ] Client is type-safe when parameterized with route contracts
- [ ] Automatic server startup and shutdown per test suite
- [ ] Integration test: use test client against a sample app
- [ ] Typecheck passes

---

#### US-030: Create @typokit/testing — Integration Test Suite
**Description:** As a framework developer, I need a `createIntegrationSuite()` helper that sets up an in-memory database and provides seeded test data for fast, zero-dependency integration tests.

**Acceptance Criteria:**
- [ ] `createIntegrationSuite(app, options)` function — sets up app + in-memory database for integration testing
- [ ] Options: `database: boolean` (spin up in-memory DB), `seed: string` (seed data fixture name)
- [ ] `suite.setup()` starts the server and seeds the database
- [ ] `suite.teardown()` stops the server and cleans up
- [ ] `suite.client` returns a typed test client
- [ ] Database tests use isolated in-memory databases per test (no shared state)
- [ ] No shared mutable state between tests by default
- [ ] Integration test: create a suite, seed data, run queries, verify isolation
- [ ] Typecheck passes

---

#### US-031: Create @typokit/testing — Test Factories
**Description:** As a framework developer, I need type-safe test factories that produce valid and invalid fixture data from `@app/schema` types.

**Acceptance Criteria:**
- [ ] `createFactory<T>()` function — creates a factory for a given type
- [ ] `factory.build(overrides?)` — produces a fully valid instance with random but valid data
- [ ] `factory.buildMany(count, overrides?)` — produces multiple instances
- [ ] `factory.buildInvalid(field)` — produces an instance with a specific field invalid (for negative testing)
- [ ] Random data generation respects JSDoc constraints (`@format email` → valid email, `@minLength` → correct length, etc.)
- [ ] Deterministic when seeded (same seed → same output)
- [ ] Unit tests: build valid User, override fields, build invalid email variant
- [ ] Typecheck passes

---

#### US-032: Create @typokit/testing — Schema Matcher
**Description:** As a framework developer, I need a `toMatchSchema(schemaName)` custom matcher that works with Jest, Vitest, and Rstest so that contract tests can verify response bodies conform to their declared types.

**Acceptance Criteria:**
- [ ] Custom matcher `toMatchSchema(schemaName)` implemented with adapters for Jest, Vitest, and Rstest
- [ ] Matcher loads the compiled validator for the named schema and validates the response body
- [ ] Clear error messages on mismatch: which fields failed, expected vs received
- [ ] Integrates with each framework's `expect()` chain
- [ ] Unit tests: matching a valid `PublicUser`, failing on an invalid one (tested against all three runners)
- [ ] Typecheck passes

---

#### US-033: Create @typokit/testing — Contract Test Generation
**Description:** As a framework developer, I need the build pipeline to auto-generate baseline contract tests from route schemas so that every route has validation coverage by default.

**Acceptance Criteria:**
- [ ] Contract tests are generated into `__generated__/*.contract.test.ts` files
- [ ] Generated tests are test-runner-agnostic — compatible with Jest, Vitest, and Rstest
- [ ] `typokit generate:tests --runner <jest|vitest|rstest>` flag controls import style (default: auto-detect from project config)
- [ ] For each route, tests are generated for: valid input → expected status, missing required fields → 400, invalid field formats → 400
- [ ] Tests use `createTestClient(app)` and `toMatchSchema()`
- [ ] Generated tests are idempotent — same schema always generates same tests
- [ ] Tests are regenerated when route contracts change
- [ ] Generated test files include `// DO NOT EDIT — regenerated on schema change` header
- [ ] Output matches the format in Section 8.2 of the architecture doc
- [ ] Integration test: generate contract tests for sample routes, run them, verify they pass
- [ ] Typecheck passes

---

### Phase 6: Client Generation

> **Depends on:** Phase 2 (build pipeline generates client code)
> **Packages:** `@typokit/client`

---

#### US-034: Create @typokit/client — Type-Safe Fetch Client
**Description:** As a framework developer, I need a type-safe API client package that auto-generates from route contracts, so that frontend code gets full type safety and autocomplete for all API calls.

**Acceptance Criteria:**
- [ ] Package `@typokit/client` created at `packages/client/`
- [ ] `createClient<TRoutes>(options)` function — creates a typed client with `baseUrl` configuration
- [ ] Client methods: `get(path, options?)`, `post(path, options?)`, `put(path, options?)`, `patch(path, options?)`, `delete(path, options?)`
- [ ] Full TypeScript autocomplete on: route paths, params, query, body, and response types
- [ ] Path parameters inferred from route path (e.g., `/users/:id` → `{ id: string }`)
- [ ] Responses are typed according to the route contract's `TResponse`
- [ ] Uses `fetch` under the hood (works in Node.js, browsers, Bun, Deno)
- [ ] Error responses throw typed errors
- [ ] Configurable request interceptors (for auth headers, etc.)
- [ ] Build pipeline generates `@app/client/src/index.ts` automatically
- [ ] Unit tests: client construction, type-safe method calls
- [ ] Typecheck passes

---

### Phase 7: Observability

> **Depends on:** Phase 1 (core interfaces), Phase 3 (server for request lifecycle tracing)
> **Packages:** `@typokit/otel`

---

#### US-035: Create @typokit/otel — Structured Logger (ctx.log)
**Description:** As a framework developer, I need a structured logger available via `ctx.log` that automatically enriches log entries with request metadata and trace IDs.

**Acceptance Criteria:**
- [ ] Package `@typokit/otel` created at `packages/otel/`
- [ ] `ctx.log` API with levels: `trace`, `debug`, `info`, `warn`, `error`, `fatal`
- [ ] Log entries automatically include: `traceId`, `route`, `phase`, `requestId`, server adapter name
- [ ] Log entries are structured JSON
- [ ] Default sink: JSON to stdout (always active, zero config)
- [ ] Log level configurable via `logging.level` in `createApp()` options (default: `"info"` in production, `"debug"` in development)
- [ ] Sensitive field redaction via `logging.redact` configuration
- [ ] Unit tests: log entries include correct metadata, redaction works, level filtering works
- [ ] Typecheck passes

---

#### US-036: Create @typokit/otel — OpenTelemetry Tracing
**Description:** As a framework developer, I need automatic OpenTelemetry tracing so that every request's lifecycle is recorded as spans.

**Acceptance Criteria:**
- [ ] OTel tracing auto-instruments the request lifecycle
- [ ] Each middleware phase, validation step, and handler execution becomes a separate span
- [ ] Span hierarchy: root span (request) → child spans (middleware, validation, handler, serialization)
- [ ] Trace ID propagated through the request context and available via `ctx.traceId`
- [ ] Configurable via `telemetry.tracing` in `createApp()` options
- [ ] Exporter options: `"console"` (for dev), `"otlp"` (for collectors)
- [ ] OTel Collector endpoint configurable via `telemetry.endpoint`
- [ ] Request lifecycle trace data matches the format in Section 9.4 of the architecture doc
- [ ] Unit tests: spans created for each phase, trace ID correlates across spans
- [ ] Typecheck passes

---

#### US-037: Create @typokit/otel — Metrics
**Description:** As a framework developer, I need automatic request metrics so that standard observability dashboards work out of the box.

**Acceptance Criteria:**
- [ ] Metrics auto-instrumented: `http.server.request.duration` (histogram), `http.server.active_requests` (gauge), error rate counters
- [ ] Metrics labeled with: route, method, status code
- [ ] Configurable via `telemetry.metrics` in `createApp()` options
- [ ] Exports via OTel Collector
- [ ] `telemetry.serviceName` sets the OTel resource service name
- [ ] Unit tests: metrics recorded for requests, correct labels applied
- [ ] Typecheck passes

---

#### US-038: Create @typokit/otel — Log Bridge to OTel
**Description:** As a framework developer, I need `ctx.log` entries to optionally feed into OTel Collector as log signals, so that all three signals (traces, metrics, logs) can be correlated in observability tools.

**Acceptance Criteria:**
- [ ] OTel log sink implemented — pushes structured log entries to OTel Collector via the log bridge
- [ ] Log entries include the current trace ID and span ID for correlation
- [ ] OTel log sink is opt-in (enabled when `telemetry.tracing` is configured)
- [ ] Works alongside the default stdout sink (both active simultaneously)
- [ ] Unit tests: log entries forwarded to OTel with correct trace context
- [ ] Typecheck passes

---

### Phase 8: Plugins

> **Depends on:** Phase 1 (plugin interface), Phase 3 (server), Phase 7 (observability)
> **Packages:** `@typokit/plugin-debug`, `@typokit/plugin-ws`

---

#### US-039: Create @typokit/plugin-debug — Debug Sidecar Server
**Description:** As a framework developer, I need a debug sidecar plugin that runs on a separate port and exposes structured introspection endpoints for AI agents.

**Acceptance Criteria:**
- [ ] Package `@typokit/plugin-debug` created at `packages/plugin-debug/`
- [ ] Implements `TypoKitPlugin` interface
- [ ] `debugPlugin(options)` factory function
- [ ] Development mode: enabled by default, no auth required, runs on port 9800 by default
- [ ] Production mode: opt-in, requires `security.apiKey` (via `X-Debug-Key` header), IP/CIDR allowlist, bind to internal interface, rate limiting
- [ ] Endpoints:
  - `GET /_debug/routes` — all registered routes with schemas
  - `GET /_debug/middleware` — middleware chain
  - `GET /_debug/performance?window=<duration>` — latency percentiles (p50/p95/p99)
  - `GET /_debug/errors?since=<duration>` — recent structured errors
  - `GET /_debug/health` — connection pool saturation, memory, event loop lag
  - `GET /_debug/dependencies` — service dependency graph
  - `GET /_debug/traces` — recent request traces from OTel
  - `GET /_debug/logs?since=<duration>` — recent structured logs
- [ ] All endpoints are read-only — no mutation endpoints
- [ ] Sensitive headers/body fields redacted via `security.redact` config
- [ ] `onSchemaChange` hook refreshes cached route map on rebuild
- [ ] Integration tests: start sidecar, query each endpoint, verify structured JSON response
- [ ] Typecheck passes

---

#### US-040: Create @typokit/plugin-ws — WebSocket Support
**Description:** As a framework developer, I need a WebSocket plugin that follows the same schema-first pattern as REST routes, so that WebSocket channels have typed contracts, validated messages, and generated test stubs.

**Acceptance Criteria:**
- [ ] Package `@typokit/plugin-ws` created at `packages/plugin-ws/`
- [ ] Implements `TypoKitPlugin` interface
- [ ] `wsPlugin(options)` factory function
- [ ] `WsChannels` contract interface — maps channel names to `{ serverToClient, clientToServer }` message types
- [ ] `defineWsHandlers<TChannels>()` function — maps channels to `{ onConnect, onMessage, onDisconnect }` handlers
- [ ] Incoming messages validated against `clientToServer` type contracts
- [ ] Outgoing messages type-checked against `serverToClient` types
- [ ] Build hook (`afterTypeParse`) extracts WS channel contracts from the type map
- [ ] Build hook (`emit`) generates WS validators and route table
- [ ] Integration with auth middleware (WS connections can use `requireAuth`)
- [ ] Integration tests: connect to WS channel, send/receive typed messages, verify validation
- [ ] Typecheck passes

---

### Phase 9: Additional Server Adapters

> **Depends on:** Phase 1 (ServerAdapter interface), Phase 3 (native server as reference implementation)
> **Packages:** `@typokit/server-fastify`, `@typokit/server-hono`, `@typokit/server-express`

---

#### US-041: Create @typokit/server-fastify — Fastify Adapter
**Description:** As a framework developer, I need a Fastify server adapter so that teams with existing Fastify applications can adopt TypoKit incrementally.

**Acceptance Criteria:**
- [ ] Package `@typokit/server-fastify` created at `packages/server-fastify/`
- [ ] Implements `ServerAdapter` interface
- [ ] `fastifyServer(options?)` factory function — options passed to Fastify constructor (logger, trustProxy, etc.)
- [ ] `registerRoutes()` translates compiled route table into Fastify-native route registrations
- [ ] `normalizeRequest()` converts Fastify request to `TypoKitRequest`
- [ ] `writeResponse()` converts `TypoKitResponse` to Fastify reply
- [ ] `getNativeServer()` returns the raw Fastify instance for escape hatches (plugin registration, etc.)
- [ ] Fastify-native middleware runs before TypoKit middleware (per Section 6.3)
- [ ] Integration tests: start Fastify-adapted app, send requests, verify routing and validation
- [ ] Typecheck passes

---

#### US-042: Create @typokit/server-hono — Hono Adapter
**Description:** As a framework developer, I need a Hono server adapter so that teams can run TypoKit on any platform Hono supports.

**Acceptance Criteria:**
- [ ] Package `@typokit/server-hono` created at `packages/server-hono/`
- [ ] Implements `ServerAdapter` interface
- [ ] `honoServer(options?)` factory function
- [ ] `registerRoutes()` translates compiled route table into Hono-native route registrations
- [ ] `normalizeRequest()` converts Hono context to `TypoKitRequest`
- [ ] `writeResponse()` converts `TypoKitResponse` to Hono response
- [ ] `getNativeServer()` returns the raw Hono instance
- [ ] Integration tests: start Hono-adapted app, send requests, verify routing and validation
- [ ] Typecheck passes

---

#### US-043: Create @typokit/server-express — Express Adapter
**Description:** As a framework developer, I need an Express server adapter as a migration path for teams with existing Express applications.

**Acceptance Criteria:**
- [ ] Package `@typokit/server-express` created at `packages/server-express/`
- [ ] Implements `ServerAdapter` interface
- [ ] `expressServer(options?)` factory function
- [ ] `registerRoutes()` translates compiled route table into Express-native route registrations
- [ ] `normalizeRequest()` converts Express request to `TypoKitRequest`
- [ ] `writeResponse()` converts `TypoKitResponse` to Express response
- [ ] `getNativeServer()` returns the raw Express app instance
- [ ] Integration tests: start Express-adapted app, send requests, verify routing and validation
- [ ] Typecheck passes

---

### Phase 10: Additional Platform Adapters

> **Depends on:** Phase 3 (platform-node as reference implementation)
> **Packages:** `@typokit/platform-bun`, `@typokit/platform-deno`

---

#### US-044: Create @typokit/platform-bun — Bun Platform Adapter
**Description:** As a framework developer, I need a Bun platform adapter so that TypoKit applications can run on the Bun runtime using `Bun.serve()`.

**Acceptance Criteria:**
- [ ] Package `@typokit/platform-bun` created at `packages/platform-bun/`
- [ ] Provides `createServer()` wrapping `Bun.serve()`
- [ ] Handles Bun-specific request/response APIs
- [ ] Works with `@typokit/server-native` and `@typokit/server-hono`
- [ ] Exports platform info for `typokit inspect server`
- [ ] Integration tests: start server on Bun, handle requests
- [ ] Typecheck passes

---

#### US-045: Create @typokit/platform-deno — Deno Platform Adapter
**Description:** As a framework developer, I need a Deno platform adapter so that TypoKit applications can run on the Deno runtime using `Deno.serve()`.

**Acceptance Criteria:**
- [ ] Package `@typokit/platform-deno` created at `packages/platform-deno/`
- [ ] Provides `createServer()` wrapping `Deno.serve()`
- [ ] Handles Deno-specific request/response APIs (Web standard `Request`/`Response`)
- [ ] Works with `@typokit/server-native` and `@typokit/server-hono`
- [ ] Exports platform info for `typokit inspect server`
- [ ] Integration tests: start server on Deno, handle requests
- [ ] Typecheck passes

---

### Phase 11: Frontend Client Adapters

> **Depends on:** Phase 6 (@typokit/client)
> **Packages:** `@typokit/client-react-query`, `@typokit/client-swr`

---

#### US-046: Create @typokit/client-react-query — React Query Hooks
**Description:** As a framework developer, I need a React Query adapter that generates type-safe hooks from route contracts so that React applications get automatic caching, loading states, and type safety.

**Acceptance Criteria:**
- [ ] Package `@typokit/client-react-query` created at `packages/client-react-query/`
- [ ] Generates `useQuery` hooks for GET routes with typed query keys, options, and return types
- [ ] Generates `useMutation` hooks for POST/PUT/PATCH/DELETE routes with typed variables and return types
- [ ] Query keys are derived from route path + params for correct cache invalidation
- [ ] Hooks use `@typokit/client` under the hood
- [ ] Unit tests: hook type safety, query key generation
- [ ] Typecheck passes

---

#### US-047: Create @typokit/client-swr — SWR Hooks
**Description:** As a framework developer, I need an SWR adapter that generates type-safe hooks from route contracts for teams using SWR instead of React Query.

**Acceptance Criteria:**
- [ ] Package `@typokit/client-swr` created at `packages/client-swr/`
- [ ] Generates `useSWR` hooks for GET routes with typed keys and return types
- [ ] Generates mutation helpers for write operations
- [ ] Hooks use `@typokit/client` under the hood
- [ ] Unit tests: hook type safety
- [ ] Typecheck passes

---

### Phase 12: Monorepo Integrations

> **Depends on:** Phase 2 (@typokit/cli)
> **Packages:** `@typokit/nx`, `@typokit/turbo`

---

#### US-048: Create @typokit/nx — Nx Executor & Generator
**Description:** As a framework developer, I need an Nx plugin that provides executors and generators so that teams using Nx can integrate TypoKit into their workspace build graph.

**Acceptance Criteria:**
- [ ] Package `@typokit/nx` created at `packages/nx/`
- [ ] Nx executor `@typokit/nx:build` — calls `typokit build` with the correct working directory
- [ ] Nx executor `@typokit/nx:dev` — calls `typokit dev`
- [ ] Nx executor `@typokit/nx:test` — calls `typokit test`
- [ ] Nx generator `@typokit/nx:init` — adds TypoKit to an existing Nx workspace
- [ ] Nx generator `@typokit/nx:route` — scaffolds a route module
- [ ] Executors respect Nx's task pipeline (dependsOn, inputs/outputs caching)
- [ ] Unit tests: executor invocations, generator output
- [ ] Typecheck passes

---

#### US-049: Create @typokit/turbo — Turborepo Integration
**Description:** As a framework developer, I need Turborepo integration helpers so that teams using Turborepo can configure TypoKit in their pipeline.

**Acceptance Criteria:**
- [ ] Package `@typokit/turbo` created at `packages/turbo/`
- [ ] Provides example `turbo.json` pipeline configuration for TypoKit projects
- [ ] Helper scripts that wrap `typokit build` / `typokit dev` for Turborepo compatibility
- [ ] Documentation for setting up TypoKit in a Turborepo workspace
- [ ] Typecheck passes

---

### Phase 13: Reference Application

> **Depends on:** Phases 1–8 (all core framework packages)
> **Packages:** `packages/example-todo-schema/`, `packages/example-todo-server/`, `packages/example-todo-db/`, `packages/example-todo-client/`

---

#### US-050: Reference App — Schema Package (@typokit/example-todo-schema)
**Description:** As a framework developer, I need a reference `@typokit/example-todo-schema` package with Todo and User types to validate the schema-first workflow end-to-end.

**Acceptance Criteria:**
- [ ] `packages/example-todo-schema/` created as an Nx package with name `@typokit/example-todo-schema`
- [ ] `User` entity type with JSDoc tags (`@table`, `@id`, `@generated`, `@format email`, `@unique`, `@minLength`, `@maxLength`, `@default`)
- [ ] `Todo` entity type with: id, title, description (optional), completed (boolean), userId (foreign key), createdAt, updatedAt
- [ ] `CreateUserInput`, `UpdateUserInput`, `PublicUser` derived types
- [ ] `CreateTodoInput`, `UpdateTodoInput`, `PublicTodo` derived types
- [ ] `PaginatedResponse` and `ErrorResponse` re-exported from `@typokit/types`
- [ ] Route contracts for Users CRUD and Todos CRUD
- [ ] Typecheck passes

---

#### US-051: Reference App — Server Package (@typokit/example-todo-server)
**Description:** As a framework developer, I need a reference `@typokit/example-todo-server` package that implements handlers for the todo API, demonstrating the full TypoKit developer experience.

**Acceptance Criteria:**
- [ ] `packages/example-todo-server/` created as an Nx package with name `@typokit/example-todo-server`
- [ ] Route handlers for: `GET /users`, `POST /users`, `GET /users/:id`, `PUT /users/:id`
- [ ] Route handlers for: `GET /todos`, `POST /todos`, `GET /todos/:id`, `PUT /todos/:id`, `DELETE /todos/:id`
- [ ] `GET /todos` supports query params: `page`, `pageSize`, `userId` (filter), `completed` (filter)
- [ ] Auth middleware demonstrating context type narrowing (requireAuth on write operations)
- [ ] Error handling demonstrating `ctx.fail()` usage (not found, conflict, validation)
- [ ] Service layer for business logic (userService, todoService)
- [ ] `app.ts` with explicit route registration
- [ ] `typokit build` completes successfully
- [ ] `typokit dev` starts and serves requests
- [ ] Typecheck passes

---

#### US-052: Reference App — Database Layer (@typokit/example-todo-db)
**Description:** As a framework developer, I need a reference database layer using the Drizzle adapter to demonstrate schema-driven data access.

**Acceptance Criteria:**
- [ ] `packages/example-todo-db/` created as an Nx package with name `@typokit/example-todo-db`
- [ ] `typokit generate:db` produces Drizzle table definitions from schema types
- [ ] Migration generated for initial schema (`typokit migrate:generate --name initial`)
- [ ] Database seeding script with sample users and todos
- [ ] Repository functions for CRUD operations using Drizzle
- [ ] Works with a local PostgreSQL instance (or SQLite for simplicity)
- [ ] Typecheck passes

---

#### US-053: Reference App — Generated Tests
**Description:** As a framework developer, I need the reference app to have auto-generated contract tests and manually written integration tests to validate the testing framework.

**Acceptance Criteria:**
- [ ] `typokit generate:tests` produces contract tests for all routes
- [ ] Contract tests pass when run via `typokit test:contracts`
- [ ] Manual integration tests written for: create user → create todo → list todos by user → update todo → delete todo
- [ ] Integration tests use `createIntegrationSuite()` with in-memory database
- [ ] Test factories used for fixture data
- [ ] All tests pass via `typokit test`
- [ ] Typecheck passes

---

#### US-054: Reference App — Generated Client
**Description:** As a framework developer, I need the reference app to have a generated type-safe API client demonstrating the client generation workflow.

**Acceptance Criteria:**
- [ ] `typokit generate:client` produces `@typokit/example-todo-client` package output
- [ ] Generated client has typed methods for all routes
- [ ] TypeScript autocomplete works on route paths, params, query, body, and response
- [ ] A simple test script demonstrates using the client against the running server
- [ ] Typecheck passes

---

#### US-055: Reference App — OpenAPI Spec
**Description:** As a framework developer, I need the reference app to have a generated OpenAPI spec to validate the OpenAPI generation pipeline.

**Acceptance Criteria:**
- [ ] `typokit generate:openapi --output ./dist/openapi.json` produces a valid OpenAPI 3.1 spec
- [ ] Spec includes all routes, request/response schemas, error responses
- [ ] Spec validates against the OpenAPI 3.1 JSON Schema
- [ ] Swagger UI or similar tool can render the spec correctly

---

#### US-056: Reference App — Debug Sidecar Demo
**Description:** As a framework developer, I need the reference app to demonstrate the debug sidecar in development mode.

**Acceptance Criteria:**
- [ ] `typokit dev` starts the debug sidecar on port 9800
- [ ] `GET http://localhost:9800/_debug/routes` returns all registered routes as JSON
- [ ] `GET http://localhost:9800/_debug/health` returns server health metrics
- [ ] `GET http://localhost:9800/_debug/errors?since=1h` returns recent errors
- [ ] CLI introspection works: `typokit inspect routes --json` returns route data

---

#### US-057: Reference App — E2E Tests with Real Database
**Description:** As a framework developer, I need the reference app to include end-to-end tests that run against a real PostgreSQL database to validate the full stack beyond in-memory testing.

**Acceptance Criteria:**
- [ ] E2E test suite in `packages/example-todo-server/` that connects to a real PostgreSQL instance
- [ ] Tests cover the full lifecycle: create user → create todo → list todos by user → update todo → mark complete → delete todo
- [ ] Tests validate actual DB state (rows written, constraints enforced, enums stored correctly)
- [ ] Requires a running PostgreSQL instance (configured via `DATABASE_URL` env var)
- [ ] Separate test script: `typokit test:e2e` (not run by default `typokit test`)
- [ ] CI pipeline runs e2e tests against a PostgreSQL service container in GitHub Actions
- [ ] Typecheck passes

---

## Functional Requirements

- FR-1: A single TypeScript interface with JSDoc tags must be the sole source of truth for validation, DB schema, API docs, client types, and test factories
- FR-2: The Rust-native build pipeline must parse TypeScript ASTs, extract type metadata, and generate all artifacts into `.typokit/`
- FR-3: The build pipeline must call Typia via napi-rs callback for validation code generation
- FR-4: The `ServerAdapter` interface must normalize any server framework's request/response into `TypoKitRequest`/`TypoKitResponse`
- FR-5: The native server must consume the compiled radix tree for O(k) route lookup
- FR-6: Request validation must run compiled validators on params, query, and body before reaching handlers
- FR-7: Response serialization must use compiled fast-json-stringify schemas
- FR-8: The `DatabaseAdapter` interface must generate DB schema artifacts and migration drafts from type metadata
- FR-9: Contract tests must be auto-generated from route schemas and be idempotent
- FR-10: Test factories must produce valid and invalid fixture data respecting JSDoc constraints
- FR-11: The type-safe API client must auto-generate from route contracts with full TypeScript autocomplete
- FR-12: OpenAPI 3.1 specs must be auto-generated from route contracts
- FR-13: `ctx.log` must produce structured JSON with automatic traceId, route, and request metadata
- FR-14: OpenTelemetry tracing must auto-instrument the request lifecycle (middleware, validation, handler, serialization)
- FR-15: The debug sidecar must expose read-only introspection endpoints on a separate port
- FR-16: The plugin system must support both build-time (tapable hooks) and runtime (lifecycle events) extension points
- FR-17: WebSocket channels must follow the same schema-first pattern with typed contracts and validated messages
- FR-18: Middleware must support context type narrowing — middleware return types extend the handler's context type
- FR-19: Errors must use thrown `AppError` classes with structured context (sourceFile, schemaFile, relatedTests, traceId)
- FR-20: The `typokit` CLI must provide build, dev, inspect, generate, migrate, test, and scaffold commands
- FR-21: All packages must be publishable as open-source npm packages under the `@typokit` scope
- FR-22: The framework must target Node.js 24+ with Bun and Deno support via platform adapters
- FR-23: Dev mode must achieve < 50ms incremental rebuild from file save to server ready
- FR-24: The native transform must ship prebuilt binaries for macOS (arm64, x64), Linux (arm64 GNU, x64 GNU, x64 musl), and Windows (x64 MSVC)
- FR-25: Destructive database migrations must be flagged and blocked in CI until reviewed

---

## Non-Goals (v1)

- **No built-in frontend framework** — the client package generates typed fetch calls, not React/Vue/Svelte components
- **No GraphQL** — REST-first; GraphQL adapter could come later as a plugin
- **No built-in job queues** — provide patterns and examples, but don't bundle a queue
- **No serverless-first** — optimize for long-running processes; serverless adapters are community packages
- **No built-in ORM or query builder** — the DB adapter layer generates schemas and types; users bring their own Drizzle/Kysely/Prisma/raw SQL
- **No Rust at runtime (by default)** — runtime stays in TypeScript for AI inspectability; community adapters may use native HTTP layers
- **No built-in auth solution** — auth is handled by typed middleware (auth-agnostic)
- **No automatic priority-based notifications or scheduling**
- **No multi-tenancy support** — single-tenant by default
- **No built-in rate limiting** — use framework-native middleware (Fastify plugins, etc.) or community packages

---

## Technical Considerations

- **Monorepo tooling:** TypoKit's own repo is an Nx monorepo. End-user projects are monorepo-agnostic.
- **Rust/napi-rs dependency:** The Rust transform requires prebuilt binaries for all platforms. CI must build and publish platform-specific packages. No Rust toolchain required for end users.
- **Typia dependency risk:** Typia is isolated behind `@typokit/transform-typia`. If Typia's maintenance changes, only this package needs replacement.
- **SWC parser:** Used in the Rust transform for TypeScript AST parsing. Proven 20-70x faster than TS's own parser.
- **fast-json-stringify:** Used for response serialization. Schemas generated at build time from response types.
- **Rstest:** Rspack-based test runner used for TypoKit's own internal tests. Generated tests for end users support Jest, Vitest, and Rstest via framework-agnostic output.
- **OpenTelemetry:** Standard for tracing and metrics. TypoKit's logger bridges to OTel signals.
- **GitHub Actions CI:** Build + test on push/PR for all platforms.

---

## Success Metrics

- All 57 user stories implemented and verified
- `typokit build` completes in < 500ms for a 50-type, 20-route project (cold build)
- `typokit dev` achieves < 50ms incremental rebuild on file change
- Native server throughput > 90% of raw `node:http`
- Reference todo API passes all contract and integration tests
- OpenAPI spec generated from reference app validates against OpenAPI 3.1 JSON Schema
- Debug sidecar returns valid structured JSON for all endpoints
- AI agent can complete the "modify type → generate → test → fix" workflow loop (Section 14.2) without manual intervention

---

## Open Questions

1. **Exact Typia version to pin:** Which version of Typia should be the initial pinned version? Needs evaluation of current stability. -- 11.0.3.
2. **SQLite support in DB adapters:** Should v1 DB adapters support SQLite in addition to PostgreSQL, or is Postgres-only acceptable for the initial release? -- Both must be supported.
3. **Reference app database:** Should the reference todo API use PostgreSQL (more realistic) or SQLite (zero external dependencies for testing)? -- SQLite for simplicity.
4. **Test container strategy:** For integration tests, should we use Testcontainers (Docker-based) or in-memory alternatives? -- In-memory for integration tests (fast, zero dependencies). Real PostgreSQL via e2e tests in the reference app (US-057), run in CI with a Postgres service container.
5. **Documentation site:** Should v1 include a documentation website, or is README + JSDoc sufficient for initial launch? -- We can start with README + JSDoc and add a docs site as our next step.
6. **Package versioning strategy:** Should all packages share a single version (monorepo lockstep) or use independent versioning? -- monorepo lockstep.
7. **Browser compatibility for @typokit/client:** What minimum browser versions should the fetch client support? -- Target evergreen browsers (last 2 versions), Node.js 24+, Deno, and Bun.
8. **CI matrix:** Which Node.js versions should CI test against (24 only, or also 22 LTS for early adopters)? -- Node.js 24 only for v1, we can add 22 LTS in a later release if needed.
