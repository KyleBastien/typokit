# Plan: Rust Codegen Target — Full Axum Server from TypoKit Schemas

## Problem Statement

Can TypoKit generate a **full Rust Axum server** where handlers, types, and validation are all Rust — not just a JS adapter with Rust HTTP? If so, create the build pipeline codegen target and an example app demonstrating end-to-end Rust from TypoKit schemas.

## Approach Comparison

There are three ways to combine Rust + TypoKit. The user's question ("Does anything prevent us from writing the handlers in Rust?") points clearly to **Option A**.

| Approach | HTTP Layer | Handlers | Runtime | Complexity |
|----------|-----------|----------|---------|------------|
| **A: Full Rust Server (standalone binary)** | Axum (Rust) | **Rust** | No Node.js | High (new codegen target) |
| B: napi-rs Adapter (Rust HTTP + JS handlers) | Axum (napi-rs) | TypeScript | Node.js | Medium |
| C: Hybrid (Rust HTTP + some Rust handlers) | Axum (napi-rs) | Mixed TS/Rust | Node.js | Medium-High |

**We're going with Option A** — TypoKit's build pipeline generates a complete Rust project from TypeScript schemas. No Node.js at runtime. Handlers are pure Rust.

## Feasibility: What We Already Have ✅

The architecture already has most of the pieces. The build pipeline runs in Rust and has full access to the type information:

1. **Rust AST parsing** (`transform-native/src/parser.rs`) — Already parses TypeScript source via SWC. Knows every type, interface, and JSDoc annotation.

2. **Type extraction** (`transform-native/src/type_extractor.rs`) — Produces `SchemaTypeMap` with property types, optionality, validation rules (`@minLength`, `@format email`, `@unique`, etc.). This is everything needed to generate Rust structs + serde/validator attributes.

3. **Route compilation** (`transform-native/src/route_compiler.rs`) — Produces `CompiledRouteTable` with every route, method, path params, handler refs, middleware refs. This maps directly to Axum router registrations.

4. **Tapable build hooks** — The `emit` hook lets plugins generate arbitrary output files. A Rust codegen plugin hooks in at `afterTypeParse` + `afterRouteTable` + `emit` to generate Rust source files.

5. **The codegen pattern exists** — `GeneratedOutput` (`{ filePath, content, overwrite }`) is the standard way build plugins emit files. OpenAPI specs, test stubs, DB schemas, and validators are all generated this way. Rust source is just another output format.

6. **Example app pattern** — The `example-todo-*` packages show the schema → server → client pattern.

### What's Missing / Needs Building

| Gap | Solution |
|-----|----------|
| **Rust struct codegen** from `SchemaTypeMap` | New module: TS types → Rust structs with serde derives + validator attributes |
| **Axum router codegen** from `CompiledRouteTable` | New module: route table → Axum `.route()` registrations |
| **Handler trait/signature generation** | Generate handler function signatures that users implement |
| **Validation codegen in Rust** | Map JSDoc annotations to `validator` crate attributes (or custom serde validators) |
| **Database layer codegen** | Generate sqlx queries, repository functions, migrations, connection pool setup from `@table`/`@id`/`@generated` annotations |
| **Cargo.toml generation** | Generate project manifest with correct deps (axum, tokio, serde, sqlx, etc.) |

## Proposed Architecture

```
TypeScript Schema (source of truth)
        │
        ▼
┌─────────────────────────────────┐
│  TypoKit Build Pipeline (Rust)  │
│                                 │
│  parser.rs ─► type_extractor.rs │
│       │              │          │
│       ▼              ▼          │
│  route_compiler.rs   SchemaTypeMap
│       │              │          │
│       ▼              ▼          │
│  ┌──────────────────────────┐   │     NEW
│  │  rust_codegen.rs         │   │  ◄── Module
│  │                          │   │
│  │  • Rust structs (serde)  │   │
│  │  • Validators            │   │
│  │  • Axum router           │   │
│  │  • Handler signatures    │   │
│  │  • sqlx repository       │   │
│  │  • SQL migrations        │   │
│  │  • Cargo.toml            │   │
│  │  • main.rs scaffold      │   │
│  └──────────────────────────┘   │
│       │                         │
└───────│─────────────────────────┘
        ▼
┌──────────────────────────────────────────────────────┐
│  Generated Rust Project                              │
│                                                      │
│  Cargo.toml                              (generated) │
│                                                      │
│  .typokit/                  ◄── gitignored, always   │
│    models/                      regenerated on build  │
│      mod.rs                          (generated)     │
│      user.rs                         (generated)     │
│      todo.rs                         (generated)     │
│    router.rs                         (generated)     │
│    db/                                               │
│      mod.rs                          (generated)     │
│      repository.rs                   (generated)     │
│    migrations/                                       │
│      001_initial.sql                 (generated)     │
│    error.rs                          (generated)     │
│    app.rs                            (generated)     │
│                                                      │
│  src/                       ◄── user-owned, committed│
│    main.rs                           (generated)     │
│    lib.rs                  (generated — #[path]      │
│                             includes from .typokit/) │
│    handlers/                                         │
│      mod.rs                          (generated)     │
│      users.rs             (stub → user-written)      │ ◄── User code
│      todos.rs             (stub → user-written)      │
│    services/                                         │
│      mod.rs                          (generated)     │
│      users.rs             (stub → user-written)      │
│      todos.rs             (stub → user-written)      │
│    middleware/                                        │
│      mod.rs                          (generated)     │
│      auth.rs              (stub → user-written)      │
└──────────────────────────────────────────────────────┘
        │
        ▼  cargo build
┌─────────────────────────────────┐
│  Standalone Axum Binary         │
│  (no Node.js required)          │
└─────────────────────────────────┘
```

### Structure Alignment: TypeScript ↔ Rust

The Rust output follows the same `.typokit/` convention as TypeScript projects — generated code lives in `.typokit/` (gitignored, always regenerated), user code lives in `src/`. The `src/lib.rs` bridges the two via `#[path]` attributes, just as TypeScript imports from `.typokit/validators/` and `.typokit/routes/`.

| TypeScript (example-todo) | Rust (generated) | Location |
|---------------------------|------------------|----------|
| `@app/schema` entity types | `.typokit/models/user.rs` | `.typokit/` (regen) |
| `.typokit/validators/*.ts` | validator derives on model structs | `.typokit/` (regen) |
| `.typokit/routes/compiled-router.ts` | `.typokit/router.rs` | `.typokit/` (regen) |
| `example-todo-db/src/schema.ts` | `.typokit/db/mod.rs` | `.typokit/` (regen) |
| `example-todo-db/src/repository.ts` | `.typokit/db/repository.rs` | `.typokit/` (regen) |
| `example-todo-db/src/migrations/` | `.typokit/migrations/` | `.typokit/` (regen) |
| `@typokit/errors` | `.typokit/error.rs` | `.typokit/` (regen) |
| `example-todo-server/src/app.ts` | `.typokit/app.rs` | `.typokit/` (regen) |
| `example-todo-server/src/dev-server.ts` | `src/main.rs` | `src/` (generated) |
| `example-todo-server/src/handlers/users.ts` | `src/handlers/users.rs` | `src/` (stub once) |
| `example-todo-server/src/services/user-service.ts` | `src/services/users.rs` | `src/` (stub once) |
| `example-todo-server/src/middleware/require-auth.ts` | `src/middleware/auth.rs` | `src/` (stub once) |
| `package.json` | `Cargo.toml` | root (regen) |

**Key pattern:** `.typokit/` is the generated, gitignored cache (identical convention to TypeScript). `src/` holds user-written handler/service/middleware code (stubs on first run, never overwritten). `src/lib.rs` imports `.typokit/` modules via `#[path]` attributes:

```rust
// src/lib.rs — generated, bridges .typokit/ → Rust module system
#[path = "../.typokit/models/mod.rs"]
pub mod models;
#[path = "../.typokit/router.rs"]
pub mod router;
#[path = "../.typokit/db/mod.rs"]
pub mod db;
#[path = "../.typokit/error.rs"]
pub mod error;
#[path = "../.typokit/app.rs"]
pub mod app;

// User-written modules
pub mod handlers;
pub mod services;
pub mod middleware;
```

### Generated Code Example

**From this TypeScript schema:**
```typescript
/** @table users */
export interface User {
  /** @id @generated uuid */
  id: string;
  /** @format email @unique */
  email: string;
  /** @minLength 2 @maxLength 100 */
  displayName: string;
}

export type CreateUserInput = Omit<User, "id">;

export interface UsersRoutes {
  "GET /users": RouteContract<void, { page?: number }, void, PaginatedResponse<User>>;
  "POST /users": RouteContract<void, void, CreateUserInput, User>;
  "GET /users/:id": RouteContract<{ id: string }, void, void, User>;
}
```

**TypoKit generates these Rust files:**

`.typokit/models/user.rs` (generated, do not edit):
```rust
use serde::{Deserialize, Serialize};
use validator::Validate;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct User {
    pub id: String,
    pub email: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Deserialize, Validate)]
pub struct CreateUserInput {
    #[validate(email)]
    pub email: String,
    #[validate(length(min = 2, max = 100))]
    pub display_name: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UsersQuery {
    pub page: Option<u32>,
}
```

`.typokit/router.rs` (generated, do not edit):
```rust
use axum::{Router, routing::{get, post}};
use crate::handlers;

pub fn create_router() -> Router<AppState> {
    Router::new()
        .route("/users", get(handlers::users::list))
        .route("/users", post(handlers::users::create))
        .route("/users/:id", get(handlers::users::get_by_id))
}
```

`.typokit/db/repository.rs` (generated, do not edit):
```rust
use sqlx::PgPool;
use crate::models::user::{User, CreateUserInput};

pub async fn find_all_users(pool: &PgPool, page: u32, page_size: u32) -> sqlx::Result<Vec<User>> {
    sqlx::query_as::<_, User>("SELECT * FROM users LIMIT $1 OFFSET $2")
        .bind(page_size as i64)
        .bind(((page - 1) * page_size) as i64)
        .fetch_all(pool)
        .await
}

pub async fn find_user_by_id(pool: &PgPool, id: &str) -> sqlx::Result<Option<User>> {
    sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn create_user(pool: &PgPool, input: &CreateUserInput) -> sqlx::Result<User> {
    sqlx::query_as::<_, User>(
        "INSERT INTO users (id, email, display_name) VALUES ($1, $2, $3) RETURNING *"
    )
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(&input.email)
        .bind(&input.display_name)
        .fetch_one(pool)
        .await
}
```

`src/handlers/users.rs` (stub — generated once, then user-written):
```rust
use axum::{extract::{Path, Query, State}, Json};
use crate::app::AppState;
use crate::error::AppError;
use crate::models::user::*;
use crate::db::repository;

pub async fn list(
    State(state): State<AppState>,
    Query(query): Query<UsersQuery>,
) -> Result<Json<Vec<User>>, AppError> {
    let users = repository::find_all_users(
        &state.pool,
        query.page.unwrap_or(1),
        20,
    ).await?;
    Ok(Json(users))
}

pub async fn create(
    State(state): State<AppState>,
    Json(input): Json<CreateUserInput>,
) -> Result<Json<User>, AppError> {
    let user = repository::create_user(&state.pool, &input).await?;
    Ok(Json(user))
}

pub async fn get_by_id(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<User>, AppError> {
    let user = repository::find_user_by_id(&state.pool, &id)
        .await?
        .ok_or(AppError::not_found("User", &id))?;
    Ok(Json(user))
}
```

### Regeneration Safety

`.typokit/` files (`models/`, `router.rs`, `db/`, `error.rs`, `app.rs`, `migrations/`) are **always regenerated** on build — same as the TypeScript `.typokit/` directory. `src/` stub files (`handlers/*.rs`, `services/*.rs`, `middleware/*.rs`) are generated once on first run and **never overwritten** (same `overwrite: false` pattern used by existing codegen for test stubs). `src/lib.rs`, `src/main.rs`, and `mod.rs` files are always regenerated to keep module declarations in sync with the schema.

## Implementation Todos

### Phase 1: Rust Codegen Module in `transform-native`

#### 1. `rust-struct-codegen` — Generate Rust Structs from SchemaTypeMap

Add `rust_codegen/mod.rs` to `transform-native/src/`:
- Generate per-entity model files: `.typokit/models/user.rs`, `.typokit/models/todo.rs`, `.typokit/models/mod.rs`
- Map TypeScript types → Rust types: `string` → `String`, `number` → `f64`/`i64`, `boolean` → `bool`, `Date` → `chrono::DateTime<Utc>`, union literals → Rust enum
- Map JSDoc annotations → serde attributes + validator derives + `sqlx::FromRow`
- Handle `Omit<T, K>`, `Partial<T>`, `Pick<T, K>` → generate concrete Rust structs
- Generate shared types: `PaginatedResponse<T>`, `ErrorResponse` (from `@typokit/types` equivalents)
- Output: per-entity `.rs` files into `.typokit/models/` as `GeneratedOutput`

#### 2. `rust-router-codegen` — Generate Axum Router from CompiledRouteTable

Add `rust_codegen/router.rs`:
- Walk the compiled radix tree and emit `Router::new().route(...)` chains
- Reference handlers as `handlers::users::list`, `handlers::todos::create` (per-entity modules)
- Map path params (`:id`) to Axum extractors (`Path<String>`)
- Map query types to Axum `Query<T>` extractors
- Map body types to Axum `Json<T>` extractors
- Output: `.typokit/router.rs` as `GeneratedOutput`

#### 3. `rust-handler-stubs` — Generate Per-Entity Handler Modules

Add `rust_codegen/handlers.rs`:
- Generate `src/handlers/mod.rs` (always overwritten — includes module declarations)
- Generate `src/handlers/{entity}.rs` per entity with handler functions matching routes
- Handler stubs wire up to repository functions and return proper types
- Output: per-entity handler files with `overwrite: false`, `mod.rs` with `overwrite: true`

#### 4. `rust-db-codegen` — Generate sqlx Database Layer

Add `rust_codegen/database.rs`:
- Generate `.typokit/db/mod.rs` with sqlx connection pool setup (`PgPool` or `SqlitePool`)
- Generate `.typokit/db/repository.rs` with CRUD functions for each `@table` entity:
  - `find_all(pool, pagination)` → `SELECT` with pagination
  - `find_by_id(pool, id)` → `SELECT WHERE id = $1`
  - `create(pool, input)` → `INSERT ... RETURNING *`
  - `update(pool, id, input)` → `UPDATE ... RETURNING *`
  - `delete(pool, id)` → `DELETE WHERE id = $1`
- Map `@id`, `@generated uuid`, `@generated now` to appropriate SQL/sqlx patterns
- Generate SQL migration files from `@table` + column annotations
- Output: `.typokit/db/mod.rs`, `.typokit/db/repository.rs`, `.typokit/migrations/` as `GeneratedOutput`

#### 5. `rust-project-scaffold` — Generate Cargo.toml + main.rs

Add `rust_codegen/project.rs`:
- Generate `Cargo.toml` with: `axum`, `tokio`, `serde`, `serde_json`, `validator`, `chrono`, `uuid`, `sqlx` (with runtime-tokio + postgres/sqlite features)
- Generate `src/main.rs` with tokio runtime, DB pool initialization, router setup, server listen
- Generate `src/lib.rs` with `#[path]` attributes bridging `.typokit/` modules into Rust module system
- Generate `.typokit/app.rs` with `AppState` struct (holds DB pool) and app configuration
- Generate `.typokit/error.rs` with `AppError` enum mapping to HTTP status codes (mirrors `@typokit/errors`)
- Generate `src/services/mod.rs` and per-entity `src/services/{entity}.rs` stubs (`overwrite: false`)
- Generate `src/middleware/mod.rs` and `src/middleware/auth.rs` stub (`overwrite: false`)
- Output: `Cargo.toml`, `src/main.rs` as `GeneratedOutput`

### Phase 2: CLI Integration

#### 6. `cli-rust-target` — Add `--target rust` to `typokit build`

Extend the CLI to support:
```bash
typokit build --target rust           # Generate Rust project (sqlx default)
typokit build --target rust --db sqlx --out ./my-rust-server
```

This invokes the Rust codegen module in the build pipeline instead of (or in addition to) the TypeScript codegen. Hook into `emit` phase to produce Rust files.

### Phase 3: Example App

#### 7. `create-example-app` — `example-todo-server-axum`

New package `packages/example-todo-server-axum/`:
- Reuses `@typokit/example-todo-schema` as the type source
- Contains the **generated** `.typokit/` Rust files checked in to show the output
- Contains **user-written** Rust handlers in `src/` implementing the todo API
- `README.md` explaining how to `typokit build --target rust` and then `cargo run`
- Shows the complete flow: TS schema → Rust codegen → Axum binary

#### 8. `update-docs` — Documentation

- Update `typokit-arch.md` with new "Rust Codegen Target" section
- Add a new row in the compatibility matrix: Axum (standalone Rust binary)
- Document the `--target rust` CLI flag
- Update `AGENTS.md` scope list

## Key Design Decisions

### 1. Build plugin vs. core feature?

**Core feature** — This is a new output target for `transform-native`, not a plugin. The Rust codegen module lives alongside `openapi_generator.rs`, `test_stub_generator.rs`, and `schema_differ.rs`. It has the same access to `SchemaTypeMap` and `CompiledRouteTable`.

### 2. What about middleware?

TypoKit middleware is TypeScript. For the Rust target, we generate Axum middleware equivalents:
- Auth middleware → Axum `middleware::from_fn` with extractors
- Logging → `tower_http::trace::TraceLayer`
- CORS → `tower_http::cors::CorsLayer`

Custom middleware needs to be written in Rust. The generated stubs include common patterns.

### 3. What about the database layer?

Database codegen is a **day-1 requirement** — handler stubs without a data layer aren't a useful example. The Rust target ships with sqlx support out of the box:
- `--db sqlx` (default) generates sqlx queries, connection pool setup, and repository functions from the schema
- Maps `@table`, `@id`, `@generated`, `@unique`, `@format` annotations to sqlx operations
- Generates a `repository.rs` with CRUD functions matching the existing TS pattern (`find_all`, `find_by_id`, `create`, `update`, `delete`)
- Generates SQL migration files from schema annotations
- Future: `--db diesel` and `--db sea-orm` options mirror TypoKit's TS-side pluggable DB adapters (`db-drizzle`, `db-kysely`, etc.)

### 4. What about the client?

`@typokit/client` already works — it's generated from the TypeScript schema, not from the server implementation. A Rust Axum server and a TypeScript server expose the same API contract because they're generated from the same schema. The client is server-agnostic.

## Risks & Considerations

1. **Type mapping completeness** — TypeScript's type system is richer than Rust's in some areas (union types, conditional types, template literals). Initial implementation covers the common cases (interfaces, string/number/boolean, Omit/Partial/Pick, union literals as enums). Exotic TS types may not map cleanly.

2. **Validation parity** — Typia-generated TS validators are comprehensive. Rust validators via the `validator` crate cover common cases but may not have 1:1 parity for every JSDoc annotation. Document what's supported.

3. **Handler regeneration safety** — Must never overwrite user-written handler code. The `overwrite: false` pattern is proven in the existing codegen pipeline.

4. **Schema evolution** — When the TS schema changes, regenerated Rust files update but handler files don't. Compilation errors in Rust (type mismatch) serve as the migration guide — same DX as changing a TypeScript type and getting compiler errors.

5. **Build toolchain requirement** — Users need `rustup` + `cargo` installed. This is expected for a Rust target — different from the prebuilt-binary approach used for `transform-native`.

## Dependencies

- `rust-struct-codegen` has no deps (first step)
- `rust-router-codegen` depends on `rust-struct-codegen` (needs to reference generated types)
- `rust-handler-stubs` depends on `rust-struct-codegen` + `rust-router-codegen`
- `rust-db-codegen` depends on `rust-struct-codegen` (needs model types for queries)
- `rust-project-scaffold` depends on `rust-struct-codegen` + `rust-db-codegen` (Cargo.toml needs all deps)
- `cli-rust-target` depends on all codegen modules
- `create-example-app` depends on `cli-rust-target`
- `update-docs` depends on `create-example-app`
