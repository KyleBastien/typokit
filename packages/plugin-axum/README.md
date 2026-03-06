# @typokit/plugin-axum

A TypoKit plugin that generates a complete, production-ready **Axum** web server from TypeScript schema types and route contracts. Powered by a native Rust code generator via napi-rs.

## Installation

```bash
pnpm add @typokit/plugin-axum
```

## Usage

Add the plugin to your `typokit.config.ts`:

```typescript
import { axumPlugin } from "@typokit/plugin-axum";

export default {
  plugins: [axumPlugin({ db: "sqlx" })],
};
```

Then run the build:

```bash
typokit build
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `db` | `string` | `"sqlx"` | Database adapter. Currently only `"sqlx"` is supported. |
| `outDir` | `string` | Project root | Output directory for the generated Rust project. |
| `cacheFile` | `string` | `.typokit/.cache-hash` | Path to the content-hash cache file for incremental builds. |

## How It Works

The plugin hooks into two phases of the TypoKit build pipeline:

1. **`emit`** — Reads parsed type metadata and route contracts, then generates Rust source files via the native addon.
2. **`compile`** — Runs `cargo build` instead of the default TypeScript compiler, setting `compileCtx.handled = true` to skip `tsc`.

## Generated Output

```
.typokit/              ← Auto-generated (always overwritten)
  models/              ← Rust structs with serde + validator + sqlx derives
  db/                  ← PgPool connection & CRUD repository functions
  router.rs            ← Axum Router with typed route registrations
  app.rs               ← AppState (shared PgPool)
  error.rs             ← AppError enum → HTTP status codes
  migrations/          ← SQL CREATE TABLE migration files

src/                   ← User code (never overwritten after initial generation)
  handlers/            ← Per-entity Axum handler functions
  services/            ← Business logic layer
  middleware/          ← Auth/logging middleware stubs
  main.rs              ← Tokio async entrypoint
  lib.rs               ← Module bridge (#[path] to .typokit/)

Cargo.toml             ← Project manifest with all dependencies
```

Files in `.typokit/` and project scaffolding (`main.rs`, `lib.rs`, `Cargo.toml`) are regenerated on every build. Handler, service, and middleware files under `src/` are generated once and **never overwritten** — this is where your application logic lives.

## Prerequisites

- [Rust](https://rustup.rs/) 1.85+ (edition 2024)
- [PostgreSQL](https://www.postgresql.org/) 16+
- Optional: [sqlx-cli](https://crates.io/crates/sqlx-cli) for running migrations

## Documentation

- [Plugins — @typokit/plugin-axum](https://kylebastien.github.io/typokit/core-concepts/plugins/) — Official plugin documentation
- [Building a Rust/Axum Server](https://kylebastien.github.io/typokit/guides/rust-axum-server/) — Step-by-step guide
- [Example: Todo Server (Axum)](../example-todo-server-axum/) — Complete reference application

## License

[MIT](../../LICENSE)
