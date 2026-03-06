# PRD: Rust Codegen Target — Full Axum Server from TypoKit Schemas

## Introduction

Add a **Rust codegen target** to TypoKit's build pipeline so that `typokit build --target rust` generates a complete, standalone Axum web server from the same TypeScript schemas that drive the TypeScript stack. The generated Rust project includes typed structs with serde/validator derives, an Axum router, sqlx-backed database layer (PostgreSQL), SQL migrations, and fully-wired handler stubs — all from a single `SchemaTypeMap` and `CompiledRouteTable`.

This achieves two goals simultaneously: (1) production-grade Rust server output for teams that need Rust's performance and safety, and (2) proof that TypoKit's schema-first model is truly language-agnostic — the same TypeScript types can drive a Node.js stack _or_ a standalone Rust binary with no runtime dependency on Node.js.

The Rust target follows the same adapter pattern used for TypeScript server frameworks (`server-express`, `server-fastify`, `server-hono`, `server-native`). Axum is the first Rust adapter, structured so that additional Rust frameworks (Actix, Rocket) can follow the same pattern in the future.

---

## Goals

- Generate a complete, compilable Rust Axum project from TypoKit TypeScript schemas via `typokit build --target rust`
- Map TypeScript types, JSDoc annotations, and route contracts to idiomatic Rust structs, validators, and Axum handlers
- Generate a PostgreSQL-backed database layer (sqlx) with CRUD repository functions and SQL migrations from `@table`/`@id`/`@generated` annotations
- Produce handler stubs wired to repository functions that compile and run out of the box — matching the fully-working stub pattern used in TypeScript example apps
- Follow the `.typokit/` (generated, gitignored) + `src/` (user-owned) split convention used by the TypeScript build pipeline
- Structure the Axum codegen as an adapter following the same pattern as TypeScript server adapters, so future Rust frameworks (Actix, Rocket) can be added the same way
- Ship a reference `example-todo-server-axum` package demonstrating the complete flow: TS schema → Rust codegen → `cargo run`
- Ensure the generated Rust server exposes the same API contract as the TypeScript server, so `@typokit/client` works against either without changes

---

## User Stories

### US-001: Generate Rust Structs from SchemaTypeMap

**Description:** As a developer, I want TypoKit to generate Rust struct definitions from my TypeScript schema types so that my Rust server uses the same data model as the TypeScript stack.

**Acceptance Criteria:**

- [ ] Each entity interface (e.g., `User`, `Todo`) generates a corresponding `.typokit/models/{entity}.rs` file
- [ ] TypeScript types map to Rust types: `string` → `String`, `number` → `f64`/`i64`, `boolean` → `bool`, `Date` → `chrono::DateTime<Utc>`, optional fields → `Option<T>`
- [ ] JSDoc `@table` entities get `#[derive(sqlx::FromRow)]` in addition to `Serialize`/`Deserialize`
- [ ] `Omit<T, K>`, `Partial<T>`, `Pick<T, K>` utility types generate concrete Rust structs (not generic wrappers)
- [ ] Union literal types (e.g., `"active" | "archived"`) generate Rust enums with serde rename attributes
- [ ] JSDoc validation annotations map to `validator` crate attributes: `@minLength` → `#[validate(length(min = N))]`, `@format email` → `#[validate(email)]`, `@maxLength` → `#[validate(length(max = N))]`
- [ ] A `.typokit/models/mod.rs` is generated that re-exports all entity modules
- [ ] Shared framework types (`PaginatedResponse<T>`, `ErrorResponse`) are generated in `.typokit/models/common.rs`
- [ ] All generated files use `GeneratedOutput` with `overwrite: true`
- [ ] Generated Rust code compiles with `cargo check` (no type errors)

### US-002: Generate Axum Router from CompiledRouteTable

**Description:** As a developer, I want TypoKit to generate an Axum router from my route contracts so that every API endpoint maps to a typed Axum handler function.

**Acceptance Criteria:**

- [ ] A `.typokit/router.rs` file is generated containing a `create_router() -> Router<AppState>` function
- [ ] Each route in the `CompiledRouteTable` maps to an `axum::routing::{get, post, put, patch, delete}` registration
- [ ] Route path parameters (`:id`) map to Axum `Path<T>` extractors
- [ ] Query types map to Axum `Query<T>` extractors (referencing generated query structs)
- [ ] Body types map to Axum `Json<T>` extractors (referencing generated input structs)
- [ ] Handler function references follow the pattern `handlers::{entity}::{action}` (e.g., `handlers::users::list`)
- [ ] Middleware references from route contracts map to Axum layer/middleware-from-fn patterns
- [ ] Generated file uses `GeneratedOutput` with `overwrite: true`
- [ ] Generated router compiles with `cargo check`

### US-003: Generate Handler Stubs with Working Repository Wiring

**Description:** As a developer, I want TypoKit to generate handler stubs that are pre-wired to repository functions so that I can `cargo run` the generated project immediately and get a working API.

**Acceptance Criteria:**

- [ ] `src/handlers/{entity}.rs` files are generated for each entity with routes, containing handler functions matching route signatures
- [ ] Handler stubs follow the same pattern as TypeScript handlers: extract params/query/body, call service or repository functions, return typed response
- [ ] List handlers include pagination via repository `find_all` functions
- [ ] Create handlers validate input (via `validator` crate), call repository `create` function, return created entity
- [ ] Get-by-ID handlers call repository `find_by_id`, return `404 AppError` if not found
- [ ] Update handlers call repository `update`, return `404 AppError` if not found
- [ ] Delete handlers call repository `delete`, return `204 No Content`
- [ ] `src/handlers/mod.rs` is generated with module declarations for all entity handler files (always overwritten to stay in sync)
- [ ] Handler stub files use `GeneratedOutput` with `overwrite: false` — never overwrite user-modified handler code
- [ ] `src/handlers/mod.rs` uses `GeneratedOutput` with `overwrite: true`

### US-004: Generate sqlx Database Layer

**Description:** As a developer, I want TypoKit to generate a PostgreSQL database layer from my `@table` annotations so that the generated Rust server has a working persistence layer on first run.

**Acceptance Criteria:**

- [ ] `.typokit/db/mod.rs` is generated with `PgPool` connection setup and a `connect(database_url)` function
- [ ] `.typokit/db/repository.rs` is generated with CRUD functions for each `@table`-annotated entity:
  - `find_all_{entity}(pool, page, page_size) -> Vec<Entity>`
  - `find_{entity}_by_id(pool, id) -> Option<Entity>`
  - `create_{entity}(pool, input) -> Entity`
  - `update_{entity}(pool, id, input) -> Option<Entity>`
  - `delete_{entity}(pool, id) -> bool`
- [ ] `@id` fields map to `WHERE id = $1` in queries
- [ ] `@generated uuid` fields get `uuid::Uuid::new_v4()` in INSERT queries (not user-supplied)
- [ ] `@generated now` fields get `chrono::Utc::now()` in INSERT queries
- [ ] `@unique` fields generate `UNIQUE` constraints in migration SQL
- [ ] SQL migration files are generated in `.typokit/migrations/` from `@table` + column annotations
- [ ] Migration SQL uses PostgreSQL dialect (column types, `RETURNING *`, etc.)
- [ ] All generated DB files use `GeneratedOutput` with `overwrite: true`
- [ ] Generated repository functions compile with `cargo check`

### US-005: Generate Rust Project Scaffold (Cargo.toml, main.rs, lib.rs)

**Description:** As a developer, I want TypoKit to generate the full Rust project scaffolding so that `cargo build` works immediately after codegen.

**Acceptance Criteria:**

- [ ] `Cargo.toml` is generated with all required dependencies: `axum`, `tokio` (full features), `serde` + `serde_json`, `validator` (derive feature), `chrono` (serde feature), `uuid`, `sqlx` (runtime-tokio, postgres features), `tower-http` (cors, trace features), `tracing`, `tracing-subscriber`, `dotenvy`
- [ ] `src/main.rs` is generated with: tokio runtime, dotenvy for `.env`, database pool initialization, router setup, server bind and listen
- [ ] `src/lib.rs` is generated with `#[path]` attributes bridging `.typokit/` modules into the Rust module system, plus `pub mod` declarations for user-owned modules (`handlers`, `services`, `middleware`)
- [ ] `.typokit/app.rs` is generated with `AppState` struct (holding `PgPool`) and `Clone` derive
- [ ] `.typokit/error.rs` is generated with `AppError` enum mapping to HTTP status codes (`NotFound` → 404, `BadRequest` → 400, `Unauthorized` → 401, `Internal` → 500), implementing `IntoResponse` for Axum
- [ ] `src/services/mod.rs` and per-entity `src/services/{entity}.rs` stubs are generated with `overwrite: false`
- [ ] `src/middleware/mod.rs` and `src/middleware/auth.rs` stub are generated with `overwrite: false`
- [ ] `src/lib.rs` and `src/main.rs` use `overwrite: true` to stay in sync with schema changes
- [ ] `Cargo.toml` uses `overwrite: true`
- [ ] `cargo build` succeeds on the generated project

### US-006: Add `--target rust` CLI Flag

**Description:** As a developer, I want to run `typokit build --target rust` to invoke the Rust codegen pipeline instead of (or in addition to) the TypeScript codegen.

**Acceptance Criteria:**

- [ ] `typokit build --target rust` invokes the Rust codegen modules in the build pipeline
- [ ] `--db sqlx` flag is accepted (default when `--target rust`), selecting sqlx as the database layer
- [ ] `--out <path>` flag allows specifying the output directory (defaults to `./` or project root)
- [ ] The Rust codegen hooks into the existing tapable `emit` phase, running after `afterTypeParse` and `afterRouteTable` hooks
- [ ] Existing TypeScript codegen continues to work for `typokit build` (no flag or `--target typescript`)
- [ ] CLI `--help` output documents the new `--target` flag and its options
- [ ] Error message is shown if `--target rust` is used with an incompatible `--db` value
- [ ] Typecheck passes on the CLI package

### US-007: Create `example-todo-server-axum` Reference App

**Description:** As a developer evaluating TypoKit, I want a reference application demonstrating the Rust codegen target end-to-end so that I can see the complete flow from TypeScript schema to running Axum server.

**Acceptance Criteria:**

- [ ] New package `packages/example-todo-server-axum/` exists in the monorepo
- [ ] Package reuses `@typokit/example-todo-schema` as the TypeScript type source
- [ ] `.typokit/` directory contains the generated Rust files (checked in for demonstration, gitignored in real projects)
- [ ] `src/handlers/` contains user-written Rust handlers implementing the full todo API (list, get, create, update, delete)
- [ ] `src/services/` contains service-layer logic following the same functional pattern as the TypeScript example
- [ ] `README.md` documents: prerequisites (Rust toolchain, PostgreSQL), how to run `typokit build --target rust`, how to `cargo run`, and how to test the API
- [ ] The example app compiles with `cargo build` and runs with `cargo run`
- [ ] API endpoints match the TypeScript example-todo-server: same paths, same request/response shapes
- [ ] `@typokit/client` (generated from the shared schema) can call the Rust Axum server identically to the TypeScript server
- [ ] Package is marked `private: true` in `Cargo.toml` metadata (not published to crates.io)

### US-008: Update Documentation

**Description:** As a developer or contributor, I want the documentation to reflect the new Rust codegen target so that I can understand the full scope of TypoKit's capabilities.

**Acceptance Criteria:**

- [ ] `typokit-arch.md` has a new "Rust Codegen Target" section explaining the architecture, adapter pattern, and generated file structure
- [ ] Architecture doc includes a compatibility matrix row for Axum (standalone Rust binary)
- [ ] `--target rust` CLI flag is documented with usage examples
- [ ] `AGENTS.md` scope list is updated to include Rust codegen modules
- [ ] Generated file structure (`.typokit/` vs `src/`) is documented for the Rust target
- [ ] Type mapping table (TypeScript → Rust) is documented
- [ ] JSDoc annotation → Rust validator mapping table is documented

---

## Functional Requirements

- FR-1: The build pipeline must accept a `--target rust` flag that activates the Rust codegen modules instead of (or alongside) TypeScript codegen
- FR-2: The Rust codegen module (`rust_codegen/mod.rs`) must live in `transform-native/src/` alongside existing generators (`openapi_generator.rs`, `test_stub_generator.rs`)
- FR-3: Rust struct generation must map all TypeScript primitive types (`string`, `number`, `boolean`, `Date`) to idiomatic Rust equivalents (`String`, `f64`/`i64`, `bool`, `chrono::DateTime<Utc>`)
- FR-4: TypeScript utility types (`Omit<T, K>`, `Partial<T>`, `Pick<T, K>`) must resolve to concrete Rust structs at codegen time (no generics needed)
- FR-5: JSDoc validation annotations (`@minLength`, `@maxLength`, `@format email`, `@pattern`, `@minimum`, `@maximum`) must map to `validator` crate derive attributes
- FR-6: JSDoc database annotations (`@table`, `@id`, `@generated uuid`, `@generated now`, `@unique`) must map to sqlx query patterns and SQL migration DDL
- FR-7: The generated Axum router must register routes using the same path patterns, HTTP methods, and parameter shapes defined in the TypeScript route contracts
- FR-8: Generated files in `.typokit/` must always use `overwrite: true` (regenerated on every build)
- FR-9: Generated stub files in `src/` (handlers, services, middleware) must use `overwrite: false` (generated once, never overwritten)
- FR-10: `src/lib.rs` and `src/main.rs` must use `overwrite: true` to stay in sync with schema changes, since they bridge generated and user-owned modules
- FR-11: The generated project must compile and run with only `rustup` + `cargo` installed (no Node.js runtime dependency)
- FR-12: The generated `AppError` enum must map TypoKit error categories (`NotFound`, `BadRequest`, `Unauthorized`, `Forbidden`, `Conflict`, `Internal`) to corresponding HTTP status codes via Axum's `IntoResponse`
- FR-13: Handler stubs must be fully wired to repository functions, following the same working-stub pattern as TypeScript handlers (extract → validate → call service/repo → respond)
- FR-14: The Rust codegen must follow the same adapter pattern as TypeScript server frameworks, so that future Rust framework targets can be added without restructuring
- FR-15: The content-hash caching mechanism (`.typokit/.cache-hash`) must apply to Rust codegen, skipping regeneration when inputs haven't changed
- FR-16: `src/handlers/mod.rs`, `src/services/mod.rs`, and `src/middleware/mod.rs` must use `overwrite: true` to keep module declarations in sync with the schema

---

## Non-Goals (Out of Scope)

- **No Actix/Rocket support** — Axum is the only Rust framework target in this release. Others follow as future adapters using the same pattern.
- **No Diesel or SeaORM support** — sqlx with PostgreSQL is the only database adapter. `--db diesel` and `--db sea-orm` are future work.
- **No exotic TypeScript type mapping** — Conditional types, template literal types, mapped types beyond `Omit`/`Partial`/`Pick`, and complex union/intersection types are not supported in v1. Document what's supported.
- **No runtime TypeScript dependency** — The generated Rust binary must not require Node.js. The build step uses TypoKit (Node.js), but the output is standalone Rust.
- **No Rust client generation** — `@typokit/client` is already TypeScript and works against any server (TS or Rust) that implements the same API contract. A Rust HTTP client is not in scope.
- **No automatic migration runner** — SQL migration files are generated, but running them is the user's responsibility (via `sqlx migrate run` or similar).
- **No hot-reload / watch mode for Rust** — Users use `cargo watch` independently. The TypoKit build regenerates Rust files; `cargo` handles recompilation.
- **No SQLite support in initial release** — PostgreSQL only. SQLite can be added as a future `--db` option.
- **No WebSocket route support in Rust target** — REST routes only. WebSocket upgrade handlers in Axum require different patterns and are future work.
- **No generated Rust tests** — Contract test generation targets TypeScript. Rust test generation is future work.

---

## Design Considerations

- **Follow the TypeScript adapter pattern:** Just as `server-express`, `server-fastify`, `server-hono`, and `server-native` all implement the `ServerAdapter` interface, the Rust codegen should be structured as a "Rust Axum" adapter. The codegen module should separate framework-agnostic Rust generation (structs, validators, DB layer) from Axum-specific generation (router, extractors, middleware). This enables future Rust framework adapters (Actix, Rocket) to reuse the struct/DB codegen.

- **`.typokit/` convention:** The generated Rust project uses the same `.typokit/` directory convention as TypeScript projects. Generated code lives in `.typokit/` (gitignored, always regenerated). User code lives in `src/`. The `src/lib.rs` bridges the two via `#[path]` attributes.

- **Handler stub quality:** Generated stubs should be production-quality starting points (matching the TypeScript example-todo-server pattern) — not empty `todo!()` macros. A developer should be able to `cargo run` immediately and have a working API. They customize from there.

- **Error type parity:** The generated `AppError` enum should mirror the error categories in `@typokit/errors` so that error responses from the Rust server match those from TypeScript servers.

---

## Technical Considerations

- **New Rust module in transform-native:** The codegen lives at `transform-native/src/rust_codegen/` with sub-modules for structs, router, handlers, database, and project scaffold. It consumes the same `SchemaTypeMap` and `CompiledRouteTable` that feed the TypeScript codegen.

- **String-based code generation:** Rust code is generated as strings (not via a Rust AST library). This matches how the existing TypeScript codegen works (OpenAPI, test stubs, etc. are all string-templated). The generated output is valid Rust source that `cargo fmt` can format.

- **Build pipeline hooks:** The Rust codegen plugs into the tapable build hooks: `afterTypeParse` (access to `SchemaTypeMap`), `afterRouteTable` (access to `CompiledRouteTable`), and `emit` (write `GeneratedOutput` files). This is the same hook chain used by all existing generators.

- **Compilation as the migration guide:** When the TypeScript schema changes, `.typokit/` Rust files regenerate with new types. If user-written handlers reference fields or types that changed, `cargo build` fails with type errors — guiding the developer (or AI agent) to update their handler code. This is the same DX as changing a TypeScript type and getting `tsc` errors.

- **Dependency versions:** `Cargo.toml` should pin major versions of dependencies to avoid breakage: `axum = "0.8"`, `tokio = "1"`, `serde = "1"`, `sqlx = "0.8"`, `validator = "0.19"`, `chrono = "0.4"`, `uuid = "1"`.

- **Users must have Rust toolchain installed:** Unlike `transform-native` (which ships prebuilt binaries via napi-rs), the Rust target requires `rustup` + `cargo` on the developer's machine. This is documented as a prerequisite.

---

## Success Metrics

- A developer can go from a TypeScript schema to a running Rust Axum server with `typokit build --target rust && cargo run` — no manual Rust code required for the initial working state
- Generated Rust project compiles without errors on `cargo build` with stable Rust
- `@typokit/client` (TypeScript) can call the Rust Axum server and receive identical responses to the TypeScript server for the same API contract
- Handler stubs are useful starting points — developers customize them rather than rewriting from scratch
- Schema changes regenerate `.typokit/` files and `cargo build` errors point directly to what handler code needs updating
- The example-todo-server-axum package demonstrates the full flow and serves as a template for new Rust TypoKit projects

---

## Open Questions

1. **Type mapping for `number`:** TypeScript `number` is always a float. Should the codegen infer `i32`/`i64` vs `f64` from context (e.g., `@id` fields use `i64`, pagination uses `u32`), or always use `f64` with explicit JSDoc annotations to override (e.g., `@integer`)? -- Infer from context with sensible defaults, but allow JSDoc overrides for edge cases (e.g., `@integer`, `@unsigned`, `@float`).

2. **Multi-entity route groups:** If a route contract references types from multiple entities (e.g., a join query), how should the handler stub be organized — in the primary entity's module or in a shared module? -- organize stubs in the primary entity's module — same as TypeScript. The Rust handler imports the other entity's service/repository when it needs cross-entity logic. No shared module needed.

3. **sqlx compile-time checking:** sqlx supports compile-time query checking via `sqlx::query!` macros (requires a live database connection at build time). Should the generated code use `sqlx::query_as::<_, T>()` (runtime-checked, simpler) or `sqlx::query_as!` (compile-time-checked, requires DB connection during `cargo build`)? -- We should support both, defaulting to compile-time-checked with clear documentation on the requirement. Users can switch to runtime-checked if they don't want the DB dependency at build time.

4. **Rust edition:** Should the generated `Cargo.toml` target Rust edition 2021 or 2024? -- 2024.

5. **Nested/related entity fetching:** The TypeScript example uses flat CRUD. Should the Rust DB codegen generate any relation-aware queries (e.g., user with their todos), or leave that entirely to user implementation? -- leave it entirely to user implementation — same as TypeScript. The Rust codegen generates flat CRUD
   repository functions only; developers write any join/relation logic themselves in their handler or service code
