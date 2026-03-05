# Agent Instructions

## Build, Test, and Lint

This is a **pnpm monorepo** managed by **Nx**. Node ≥24, pnpm 10.30.3.

```bash
pnpm install                          # Install dependencies
pnpm nx run-many -t build             # Build all packages
pnpm nx run-many -t test              # Test all packages
pnpm nx run-many -t lint              # Lint all packages
pnpm nx run-many -t typecheck         # Typecheck all packages
```

Run a single package's tasks:

```bash
pnpm nx build core                    # Build @typokit/core
pnpm nx test core                     # Test @typokit/core
pnpm nx lint core                     # Lint @typokit/core
pnpm nx typecheck core                # Typecheck @typokit/core
```

Run only affected packages (based on git diff):

```bash
pnpm nx affected -t build
pnpm nx affected -t test
```

Run a single test file via Nx (rstest is the test framework):

```bash
pnpm nx test core -- src/hooks.test.ts
```

Always run tests through Nx, never by calling rstest directly. Each package uses identical scripts: `build` → `tsc -p tsconfig.json`, `test` → `rstest run --passWithNoTests`, `lint` → `eslint --max-warnings 0 src/`, `typecheck` → `tsc --noEmit`. Lint fails on any warnings.

Nx build ordering: `build` depends on upstream `^build`. `test` depends on local `build`. `lint` and `typecheck` depend on upstream `^build`.

## Architecture

TypoKit is an **AI-native Node.js framework** where plain TypeScript types are the single source of truth for the entire stack — validation, routing, database schemas, frontend contracts, and test generation. For detailed design decisions, API contracts, and worked examples, see [`typokit-arch.md`](typokit-arch.md).

### Package Layers

**Foundation** (no internal deps):

- `types` — Shared type definitions (`TypoKitRequest`, `RouteContract`, `RequestContext`, `ValidatorFn`, `CompiledRouteTable`, build types)

**Core** (depends on types + errors):

- `errors` — Structured error classes (`AppError`, `NotFoundError`, `ValidationError`, etc.) with AI-inspectable context
- `core` — Framework core: `createApp`, `defineHandlers`, `defineMiddleware`, plugin system, `BuildPipeline` with tapable hooks

**Transform** (Rust build pipeline):

- `transform-native` — Rust via napi-rs: parses TS ASTs, generates validators/routes/OpenAPI/migrations/tests into `.typokit/` and `__generated__/` dirs
- `transform-typia` — JS wrapper for Typia validation codegen, called by transform-native via napi-rs callback

**Server Adapters** (pluggable HTTP layer — TypoKit owns validation, middleware, error handling; adapter owns HTTP parsing):

- `server-native` — Default zero-dependency server with radix tree routing
- `server-fastify`, `server-hono`, `server-express`

**Database Adapters** (generate type-compatible schemas/migrations, never manage queries):

- `db-drizzle`, `db-kysely`, `db-prisma`, `db-raw`

**Platform** (runtime-specific bindings):

- `platform-node`, `platform-bun`, `platform-deno`

**Plugins**:

- `plugin-debug` — Debug sidecar (introspection endpoints on separate port)
- `plugin-ws` — WebSocket support

**Client**:

- `client` — Generated type-safe API client
- `client-react-query`, `client-swr` — Framework-specific bindings

**Tooling**:

- `cli` — `typokit` CLI (dev, generate, inspect, migrate, scaffold, test)
- `testing` — Test utilities (`createTestClient`, `createIntegrationSuite`, `createFactory<T>`)
- `otel` — OpenTelemetry integration (tracing, metrics, log bridge)
- `nx`, `turbo` — Build tool plugins

### Key Patterns

**Schema-first types**: Entities are plain TypeScript interfaces with JSDoc metadata tags (`@table`, `@id`, `@format email`, `@unique`, `@minLength`, etc.). No Zod/Joi/decorators. The Rust build step compiles away validation at build time.

**Route contracts before handlers**: Routes are defined as typed `RouteContract<TParams, TQuery, TBody, TResponse>` interfaces. Handlers receive fully validated, typed context — if it compiles, the request was validated.

**Middleware as type narrowing**: Each middleware step transforms the `RequestContext` type. E.g., `requireAuth` adds `ctx.user` to the downstream type.

**Explicit route registration**: No file-based/magic routing. All routes registered explicitly in `app.ts` for AI traceability.

**Thrown errors, not Result types**: Handlers throw structured `AppError` subclasses. The framework catches and enriches errors with `traceId`, `sourceFile`, `schemaFile`, `relatedTests`, and field-level details.

**Pluggable adapters**: Both `ServerAdapter` and `DatabaseAdapter` are interfaces. TypoKit owns validation/middleware/errors/observability; adapters own HTTP parsing and query execution respectively.

**Tapable build pipeline**: Plugins hook into precise build phases via `onBuild(pipeline)` with hooks like `beforeTransform`, `afterTypeParse`, `afterValidators`, `afterRouteTable`, `emit`, `done`.

## Conventions

### Commits and PRs

This project uses [Conventional Commits](https://www.conventionalcommits.org/). PR titles are validated in CI.

```
type(scope): description
```

Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `perf`, `ci`, `build`, `style`, `revert`. Append `!` for breaking changes.

Scopes use the package name without the `@typokit/` prefix: `core`, `types`, `errors`, `cli`, `client`, `server-express`, `db-drizzle`, etc.

### Versioning

All publishable packages share **lock-step versioning** — same version number across all packages. Versions are determined automatically from conventional commits via Nx Release. `packages/docs` and `packages/example-*` are excluded from releases.

### Code Style

- TypeScript strict mode, ES2022 target, Node16 module resolution
- ESLint with `@typescript-eslint/consistent-type-imports` (enforced — use `import type` for type-only imports)
- Unused vars must be prefixed with `_` (e.g., `_unused`)
- `@typescript-eslint/no-explicit-any` is an error
- Generated code goes in `.typokit/` and `__generated__/` (both gitignored)
- Tests live alongside source as `*.test.ts` files (e.g., `src/hooks.test.ts`)
- All packages are ESM (`"type": "module"`) with composite TypeScript project references
- Packages export via `dist/` with both `import` and `types` conditions

### E2E Tests

E2E tests (`test:e2e` target) require a PostgreSQL 16 database:

```
DATABASE_URL=postgresql://typokit:typokit@localhost:5432/typokit_e2e
```
