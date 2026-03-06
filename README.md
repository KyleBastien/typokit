# TypoKit

**AI-native Node.js framework where TypeScript types are the single source of truth.**

Define a TypeScript interface once — get validation, routing, database schemas, API clients, OpenAPI specs, and test scaffolding generated automatically. No Zod. No decorators. No JSON Schema. Just TypeScript.

📖 [Documentation](https://kylebastien.github.io/typokit) · 🐛 [Issues](https://github.com/KyleBastien/typokit/issues)

> **⚠️ Pre-release** — TypoKit is under active development. APIs may change before v1.

## Why TypoKit?

- **Write the type once.** A single TypeScript interface drives validation, serialization, database columns, API docs, client types, and test factories.
- **One way to do everything.** Radical convention over configuration. The framework makes the decisions so AI agents (and developers) never have to guess.
- **Zero overhead opinions.** Abstractions compile away at build time via a native Rust pipeline. Runtime performance matches hand-written code.
- **AI-inspectable at every layer.** Structured introspection APIs, rich error context with trace IDs, and auto-generated test harnesses — designed for AI-assisted development from the ground up.

## Quick Start

```bash
# Prerequisites: Node.js >=20, pnpm
pnpm create typokit my-app
cd my-app
pnpm dev
```

## Schema-First Types

Define your domain as plain TypeScript with JSDoc metadata:

```typescript
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
}
```

The TypoKit build step compiles this into runtime validators, database DDL, OpenAPI specs, type-safe API clients, and contract test scaffolding — all from a single interface.

## Packages

TypoKit is a modular monorepo. Use only what you need.

| Package                       | Description                                                                            |
| ----------------------------- | -------------------------------------------------------------------------------------- |
| `@typokit/core`               | Framework core — app creation, handlers, middleware, plugin system                     |
| `@typokit/types`              | Shared type definitions for the entire framework                                       |
| `@typokit/errors`             | Structured error classes with AI-inspectable context                                   |
| `@typokit/cli`                | CLI tooling — dev server, codegen, inspect, migrate, scaffold                          |
| `@typokit/transform-native`   | Rust build pipeline (napi-rs) — type extraction, route compilation, OpenAPI generation |
| `@typokit/transform-typia`    | Typia integration for validation codegen                                               |
| **Server Adapters**           |                                                                                        |
| `@typokit/server-native`      | Default zero-dependency server with radix tree routing                                 |
| `@typokit/server-fastify`     | Fastify adapter                                                                        |
| `@typokit/server-hono`        | Hono adapter (Node, Bun, Deno)                                                         |
| `@typokit/server-express`     | Express adapter                                                                        |
| **Database Adapters**         |                                                                                        |
| `@typokit/db-drizzle`         | Drizzle ORM schema generation                                                          |
| `@typokit/db-kysely`          | Kysely query builder types                                                             |
| `@typokit/db-prisma`          | Prisma schema generation                                                               |
| `@typokit/db-raw`             | Plain SQL DDL + TypeScript interfaces                                                  |
| **Client**                    |                                                                                        |
| `@typokit/client`             | Generated type-safe API client                                                         |
| `@typokit/client-react-query` | React Query bindings                                                                   |
| `@typokit/client-swr`         | SWR bindings                                                                           |
| **Observability & Plugins**   |                                                                                        |
| `@typokit/otel`               | OpenTelemetry integration (tracing, metrics, log bridge)                               |
| `@typokit/plugin-debug`       | Debug sidecar with introspection endpoints                                             |
| `@typokit/plugin-ws`          | WebSocket support                                                                      |
| `@typokit/plugin-axum`        | Rust/Axum server code generation from TypeScript schemas                               |
| `@typokit/testing`            | Test utilities — factories, integration suites, contract generators                    |

## Bring Your Own Server

TypoKit owns the type system, validation, middleware, error handling, and observability — not the HTTP layer. Plug in any server:

```typescript
import { createApp } from "@typokit/core";
import { createFastifyAdapter } from "@typokit/server-fastify";

const app = createApp({
  adapter: createFastifyAdapter(),
  routes: [
    { prefix: "/users", handlers: usersHandlers },
    { prefix: "/posts", handlers: postsHandlers, middleware: [requireAuth] },
  ],
});

await app.listen({ port: 3000 });
```

## Development

```bash
pnpm install                  # Install dependencies
pnpm nx run-many -t build     # Build all packages
pnpm nx run-many -t test      # Run all tests
pnpm nx run-many -t lint      # Lint all packages
pnpm nx run-many -t typecheck # Typecheck all packages
```

This project uses [Conventional Commits](https://www.conventionalcommits.org/) and [Nx](https://nx.dev/) for monorepo orchestration. See [AGENTS.md](AGENTS.md) for detailed development conventions.

## Architecture

For a deep dive into TypoKit's design — the schema-first type system, Rust build pipeline, server/database adapter interfaces, plugin hooks, testing strategy, and AI introspection APIs — see the [Architecture Document](typokit-arch.md).

## License

[MIT](LICENSE)
