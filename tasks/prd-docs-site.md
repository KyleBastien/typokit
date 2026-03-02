# PRD: TypoKit Documentation Site

## Introduction

TypoKit needs a comprehensive documentation website to serve as the primary resource for developers building applications with the framework, contributors working on TypoKit internals, and AI agents consuming machine-readable documentation. The v1 PRD explicitly deferred the docs site (Open Question #5), noting "We can start with README + JSDoc and add a docs site as our next step."

The site will be built with [Starlight](https://starlight.astro.build/) (Astro-based), live inside the monorepo, auto-generate API reference from TypeScript source via TypeDoc, and deploy to GitHub Pages via GitHub Actions.

---

## Goals

- Provide a single, authoritative source of documentation for all `@typokit/*` packages
- Auto-generate API reference from TSDoc/JSDoc comments in source code so docs stay in sync with code
- Serve three audiences: framework users (building apps), contributors (working on TypoKit internals), and AI agents (machine-readable structured docs)
- Ship comprehensive content: getting started guide, core concepts, per-package API reference, tutorials, architecture overview, and a blog for release announcements
- Deploy automatically to GitHub Pages on every push to `main`
- Integrate into the existing Nx monorepo build pipeline so `nx build docs` works
- Support full-text search, dark mode, versioning, and mobile-responsive layout out of the box (Starlight defaults)

---

## User Stories

### Phase 1: Site Foundation

> **Depends on:** Nothing (can begin immediately)

---

#### US-001: Initialize Starlight Docs Package
**Description:** As a framework developer, I need a Starlight (Astro) documentation site initialized inside the monorepo so that docs live alongside code and can reference source files directly.

**Acceptance Criteria:**
- [ ] New directory created at `packages/docs/` (or top-level `docs/` — see Technical Considerations)
- [ ] Starlight initialized with Astro (`@astrojs/starlight`)
- [ ] `package.json` with `name: "@typokit/docs"` and scripts: `dev`, `build`, `preview`
- [ ] Starlight config (`astro.config.mjs`) with: site title "TypoKit", logo, sidebar structure, social links (GitHub repo)
- [ ] Default landing page (`src/content/docs/index.mdx`) with hero section: tagline, description, "Get Started" and "API Reference" CTAs
- [ ] Dark mode enabled (Starlight default)
- [ ] Full-text search enabled (Starlight's built-in Pagefind)
- [ ] `nx build docs` target configured in `project.json` (or `package.json` Nx config)
- [ ] `nx serve docs` starts the dev server on `localhost:4321`
- [ ] Site builds successfully with `npm run build` inside `packages/docs/`
- [ ] Typecheck passes

---

#### US-002: Configure GitHub Pages Deployment
**Description:** As a framework developer, I need the docs site to auto-deploy to GitHub Pages on pushes to `main` so that documentation is always up to date.

**Acceptance Criteria:**
- [ ] GitHub Actions workflow at `.github/workflows/docs.yml`
- [ ] Workflow triggers on push to `main` (paths filter: `packages/docs/**`, `packages/*/src/**`, `typokit-arch.md`)
- [ ] Workflow also supports manual trigger (`workflow_dispatch`)
- [ ] Builds the Starlight site using `nx build docs`
- [ ] Deploys output (`packages/docs/dist/`) to GitHub Pages using `actions/deploy-pages`
- [ ] Base URL configured correctly for GitHub Pages (`https://<org>.github.io/typokit/` or custom domain)
- [ ] Deployment succeeds and site is accessible at the configured URL
- [ ] Build step includes API reference generation (US-003) before Starlight build

---

#### US-003: Auto-Generate API Reference from TypeScript Source
**Description:** As a framework developer, I need API reference documentation auto-generated from TSDoc/JSDoc comments in the source code so that API docs are always in sync with the codebase.

**Acceptance Criteria:**
- [ ] TypeDoc (or `starlight-typedoc` plugin) installed and configured
- [ ] TypeDoc reads from all publishable `@typokit/*` packages: `types`, `errors`, `core`, `cli`, `testing`, `client`, `server-native`, `server-fastify`, `server-hono`, `server-express`, `platform-node`, `platform-bun`, `platform-deno`, `db-drizzle`, `db-kysely`, `db-prisma`, `db-raw`, `plugin-debug`, `plugin-ws`, `otel`, `nx`, `turbo`, `client-react-query`, `client-swr`, `transform-typia`
- [ ] Generated API reference pages include: exported interfaces, types, classes, functions, enums with their JSDoc descriptions
- [ ] Each package gets its own section in the API reference sidebar (e.g., "API Reference > @typokit/core")
- [ ] Generated pages are output as `.mdx` files consumable by Starlight (or rendered via plugin integration)
- [ ] API reference regenerates on every build (no stale docs)
- [ ] Links between types work correctly (e.g., `ServerAdapter` links to its full definition)
- [ ] Typecheck passes

---

#### US-004: Configure Sidebar Navigation Structure
**Description:** As a documentation reader, I need a well-organized sidebar so I can quickly find what I'm looking for whether I'm a new user, experienced developer, contributor, or AI agent.

**Acceptance Criteria:**
- [ ] Sidebar configured in `astro.config.mjs` with the following top-level sections:
  - **Getting Started** — quickstart, installation, project structure
  - **Core Concepts** — schema-first types, routing, middleware, error handling, server adapters, database adapters, plugins
  - **Guides** — step-by-step walkthroughs for common tasks
  - **CLI Reference** — all `typokit` commands documented
  - **API Reference** — auto-generated per-package reference (US-003)
  - **Architecture** — high-level architecture overview, design decisions
  - **Contributing** — contributor guide, development setup, Rust transform
  - **AI Agents** — machine-readable docs, introspection API, agent workflow patterns
  - **Blog** — release notes, announcements
- [ ] Sidebar sections are collapsible
- [ ] Active page is highlighted in sidebar
- [ ] Sidebar renders correctly on mobile (hamburger menu)

---

### Phase 2: Core Content — Getting Started & Concepts

> **Depends on:** Phase 1 (site foundation, sidebar structure)

---

#### US-005: Write Getting Started — Installation & Quickstart
**Description:** As a new TypoKit user, I need a quickstart guide that takes me from zero to a running TypoKit app in under 5 minutes so I can evaluate the framework quickly.

**Acceptance Criteria:**
- [ ] Page at `docs/getting-started/quickstart.mdx`
- [ ] Prerequisites listed: Node.js 24+, pnpm (recommended), npm/yarn supported
- [ ] Step-by-step: `typokit init` → project structure explained → define a type → create a route → run `typokit dev` → see it work
- [ ] Includes terminal command blocks with copy buttons (Starlight default)
- [ ] Includes the expected output at each step
- [ ] Links to deeper "Core Concepts" pages for further reading
- [ ] Page renders correctly in Starlight

---

#### US-006: Write Getting Started — Project Structure
**Description:** As a new TypoKit user, I need a guide explaining the project structure generated by `typokit init` so I understand where to put my code.

**Acceptance Criteria:**
- [ ] Page at `docs/getting-started/project-structure.mdx`
- [ ] Explains the `@app/schema`, `@app/server`, `@app/db`, `@app/client` package structure (Section 2 of arch doc)
- [ ] Explains the `.typokit/` generated directory and what each subdirectory contains (validators, routes, schemas, tests, client)
- [ ] Explains `typokit.config.ts` configuration options
- [ ] File tree diagram showing a typical project layout
- [ ] Notes which files are auto-generated (never edit) vs user-maintained
- [ ] Page renders correctly in Starlight

---

#### US-007: Write Core Concept — Schema-First Types
**Description:** As a TypoKit user, I need documentation explaining the schema-first type system so I understand how to define types that drive the entire stack.

**Acceptance Criteria:**
- [ ] Page at `docs/core-concepts/schema-first-types.mdx`
- [ ] Explains the philosophy: "Write the type once" — single TypeScript interface drives validation, DB schema, API docs, client types, test factories
- [ ] Shows a complete entity type example with all supported JSDoc tags (`@table`, `@id`, `@generated`, `@format`, `@unique`, `@minLength`, `@maxLength`, `@default`, `@onUpdate`)
- [ ] Explains derived types (`Omit`, `Partial`, `Pick`) for input/output contracts
- [ ] Explains what the build step produces from a type (table from Section 3.2 of arch doc)
- [ ] Includes a "What NOT to do" section (don't use Zod, decorators, or runtime schema libraries)
- [ ] Page renders correctly in Starlight

---

#### US-008: Write Core Concept — Routing & Handlers
**Description:** As a TypoKit user, I need documentation explaining how to define route contracts and implement handlers so I can build API endpoints.

**Acceptance Criteria:**
- [ ] Page at `docs/core-concepts/routing.mdx`
- [ ] Explains `RouteContract<TParams, TQuery, TBody, TResponse>` with a full example
- [ ] Explains `defineHandlers<TRoutes>()` with typed handler implementation
- [ ] Explains the file convention: `contracts.ts`, `handlers.ts`, `middleware.ts` per route module
- [ ] Explains explicit route registration in `app.ts` (no magic file-based routing — Section 4.4)
- [ ] Shows how route params, query, and body are automatically typed and validated
- [ ] Page renders correctly in Starlight

---

#### US-009: Write Core Concept — Middleware & Context
**Description:** As a TypoKit user, I need documentation explaining middleware and context type narrowing so I can add authentication, logging, and other cross-cutting concerns.

**Acceptance Criteria:**
- [ ] Page at `docs/core-concepts/middleware.mdx`
- [ ] Explains `defineMiddleware<TContext>()` and how middleware transforms the context type
- [ ] Shows the authentication middleware example (Section 4.3 of arch doc)
- [ ] Explains middleware priority ordering
- [ ] Explains middleware short-circuiting (throwing errors to stop the chain)
- [ ] Explains `ctx.fail()`, `ctx.log`, and `ctx.services`
- [ ] Distinguishes TypoKit typed middleware from framework-native middleware (CORS, compression)
- [ ] Page renders correctly in Starlight

---

#### US-010: Write Core Concept — Error Handling
**Description:** As a TypoKit user, I need documentation explaining the error handling system so I know how to throw and handle errors correctly.

**Acceptance Criteria:**
- [ ] Page at `docs/core-concepts/error-handling.mdx`
- [ ] Explains the philosophy: thrown errors over Result types (Section 5.1 rationale)
- [ ] Documents the `AppError` class hierarchy (`NotFoundError`, `ValidationError`, `UnauthorizedError`, `ForbiddenError`, `ConflictError`)
- [ ] Shows `ctx.fail()` usage as syntactic sugar
- [ ] Explains the built-in error middleware (auto-serialization to `ErrorResponse`)
- [ ] Explains dev mode vs production mode error detail behavior
- [ ] Shows the structured error JSON format (Section 9.2)
- [ ] Page renders correctly in Starlight

---

#### US-011: Write Core Concept — Server Adapters
**Description:** As a TypoKit user, I need documentation explaining the server adapter system so I can choose and configure the right HTTP layer for my project.

**Acceptance Criteria:**
- [ ] Page at `docs/core-concepts/server-adapters.mdx`
- [ ] Explains the philosophy: "TypoKit is not an HTTP server" (Section 6.1)
- [ ] Documents the ownership boundary table (what TypoKit owns vs what the adapter owns — Section 6.2)
- [ ] Explains request processing order diagram (Section 6.3)
- [ ] Shows usage examples for: native server, Fastify, Hono, Express (Section 6.6)
- [ ] Explains when to use native vs bring-your-own
- [ ] Explains platform adapters (Node.js, Bun, Deno) as orthogonal to server adapters
- [ ] Links to the "Building a Custom Server Adapter" guide
- [ ] Page renders correctly in Starlight

---

#### US-012: Write Core Concept — Database Adapters
**Description:** As a TypoKit user, I need documentation explaining the database adapter system so I can connect my TypoKit types to my preferred database tool.

**Acceptance Criteria:**
- [ ] Page at `docs/core-concepts/database-adapters.mdx`
- [ ] Explains the philosophy: "Generate types, not queries" — TypoKit is not an ORM (Section 7.1)
- [ ] Documents all four adapters: Drizzle, Kysely, Prisma, raw SQL — with a comparison table (Section 7.2)
- [ ] Shows the `DatabaseAdapter` interface
- [ ] Shows example output for each adapter (Drizzle table definition, Kysely types, Prisma schema, raw SQL DDL)
- [ ] Explains migration philosophy: generated as drafts, never auto-applied (Section 7.6)
- [ ] Page renders correctly in Starlight

---

#### US-013: Write Core Concept — Plugins
**Description:** As a TypoKit user, I need documentation explaining the plugin system so I can extend TypoKit with WebSocket support, debug tooling, or custom extensions.

**Acceptance Criteria:**
- [ ] Page at `docs/core-concepts/plugins.mdx`
- [ ] Explains the `TypoKitPlugin` interface and all lifecycle hooks (`onBuild`, `onStart`, `onReady`, `onError`, `onStop`, `onSchemaChange`)
- [ ] Explains build-time hooks (tapable pipeline) vs runtime hooks
- [ ] Shows plugin registration in `createApp()`
- [ ] Documents the official plugins: `@typokit/plugin-debug` and `@typokit/plugin-ws`
- [ ] Explains why there are no `onRequest`/`onResponse` hooks (Section 12.12 rationale)
- [ ] Page renders correctly in Starlight

---

#### US-014: Write Core Concept — Testing
**Description:** As a TypoKit user, I need documentation explaining the testing architecture so I understand contract tests, integration tests, test factories, and how to run them.

**Acceptance Criteria:**
- [ ] Page at `docs/core-concepts/testing.mdx`
- [ ] Explains the philosophy: "If the schema defines the contract, TypoKit can test the contract" (Section 8.1)
- [ ] Documents auto-generated contract tests with an example (Section 8.2)
- [ ] Documents the test client (`createTestClient`, `createIntegrationSuite`) with examples (Section 8.3)
- [ ] Documents test factories (`createFactory`) with valid and invalid variant generation (Section 8.4)
- [ ] Explains CI consistency guarantees (Section 8.5)
- [ ] Shows the `typokit test`, `typokit test:contracts`, `typokit test:integration` commands
- [ ] Page renders correctly in Starlight

---

#### US-015: Write Core Concept — Observability & Debugging
**Description:** As a TypoKit user, I need documentation explaining the observability and AI debugging systems so I can trace requests, inspect framework state, and debug issues.

**Acceptance Criteria:**
- [ ] Page at `docs/core-concepts/observability.mdx`
- [ ] Documents structured logging via `ctx.log` with automatic traceId correlation
- [ ] Documents OpenTelemetry integration (`@typokit/otel`) — auto-instrumented spans, log-to-span bridging
- [ ] Documents the request lifecycle trace format (Section 9.4)
- [ ] Documents the debug sidecar (`@typokit/plugin-debug`) — endpoints, dev mode vs secured production mode
- [ ] Documents `typokit inspect` commands for AI introspection (Section 9.1)
- [ ] Shows the structured error context format (Section 9.2) and how AI agents use it
- [ ] Page renders correctly in Starlight

---

### Phase 3: Guides & Tutorials

> **Depends on:** Phase 2 (core concepts documented)

---

#### US-016: Write Guide — Building Your First API
**Description:** As a new TypoKit user, I need a step-by-step tutorial building a complete CRUD API so I can learn the framework by doing.

**Acceptance Criteria:**
- [ ] Page at `docs/guides/first-api.mdx`
- [ ] Tutorial builds a simple "tasks" or "notes" API (not the todo reference app — that's for architecture docs)
- [ ] Steps: define entity type → define route contracts → implement handlers → add validation → add middleware (auth) → test with contract tests → run the API
- [ ] Each step shows the file to create/modify, the code to write, and the expected result
- [ ] Uses the native server and Drizzle adapter (most common path)
- [ ] Includes curl/httpie commands to test each endpoint
- [ ] Page renders correctly in Starlight

---

#### US-017: Write Guide — Custom Server Adapter
**Description:** As an advanced TypoKit user, I need a guide showing how to build a custom server adapter so I can integrate TypoKit with any HTTP framework.

**Acceptance Criteria:**
- [ ] Page at `docs/guides/custom-server-adapter.mdx`
- [ ] Documents the `ServerAdapter` interface methods with explanations
- [ ] Walks through building a minimal custom adapter (Section 6.8 skeleton)
- [ ] Explains `registerRoutes()`, `normalizeRequest()`, `writeResponse()`, `listen()`, `getNativeServer()`
- [ ] Shows how to consume the compiled route table
- [ ] Includes testing guidance for custom adapters
- [ ] Page renders correctly in Starlight

---

#### US-018: Write Guide — Custom Plugin Development
**Description:** As an advanced TypoKit user, I need a guide showing how to build a custom plugin so I can extend TypoKit with new capabilities.

**Acceptance Criteria:**
- [ ] Page at `docs/guides/custom-plugin.mdx`
- [ ] Walks through building a simple plugin (e.g., request timing, custom header injection)
- [ ] Shows build-time hooks (tapping into the build pipeline)
- [ ] Shows runtime hooks (registering middleware during `onStart`)
- [ ] Shows exposing CLI commands and introspection endpoints
- [ ] Shows registering framework-native middleware via `getNativeServer()`
- [ ] Page renders correctly in Starlight

---

#### US-019: Write Guide — Migration from Express/Fastify
**Description:** As a developer with an existing Express or Fastify project, I need a migration guide so I can adopt TypoKit incrementally without rewriting my app.

**Acceptance Criteria:**
- [ ] Page at `docs/guides/migration.mdx`
- [ ] Explains the incremental adoption path: add TypoKit on top of your existing server
- [ ] Shows migrating from Express: install `@typokit/server-express`, wrap existing app
- [ ] Shows migrating from Fastify: install `@typokit/server-fastify`, use alongside existing routes
- [ ] Explains how existing middleware (CORS, helmet, compression) coexists with TypoKit middleware
- [ ] Notes what changes (validation, error handling, type safety) and what stays the same (existing routes, middleware)
- [ ] Page renders correctly in Starlight

---

### Phase 4: CLI Reference & Architecture

> **Depends on:** Phase 1 (site foundation)

---

#### US-020: Write CLI Reference
**Description:** As a TypoKit user, I need comprehensive CLI reference documentation so I can look up any command, its flags, and expected behavior.

**Acceptance Criteria:**
- [ ] Page at `docs/cli/index.mdx` (overview) plus sub-pages per command group
- [ ] All commands documented: `init`, `build`, `dev`, `add route`, `add service`, `generate:db`, `generate:client`, `generate:openapi`, `generate:tests`, `migrate:generate`, `migrate:diff`, `migrate:apply`, `test`, `test:contracts`, `test:integration`, `inspect routes`, `inspect route`, `inspect middleware`, `inspect dependencies`, `inspect schema`, `inspect errors`, `inspect performance`, `inspect server`, `inspect build-pipeline`
- [ ] Each command shows: syntax, description, flags/options, example usage, expected output
- [ ] Commands organized by category: Scaffolding, Code Generation, Database, Testing, Inspection, Development
- [ ] `--json` and `--verbose` flags documented where applicable
- [ ] Page renders correctly in Starlight

---

#### US-021: Write Architecture Overview
**Description:** As a contributor or advanced user, I need a documentation-site version of the architecture overview so I can understand TypoKit's design without reading the full arch doc.

**Acceptance Criteria:**
- [ ] Page at `docs/architecture/overview.mdx`
- [ ] High-level architecture diagram (Section 2 of arch doc) — can use Mermaid or an embedded image
- [ ] Package responsibilities table (Section 2)
- [ ] Build pipeline flow diagram (Section 12.3)
- [ ] Request processing order diagram (Section 6.3)
- [ ] Links to deep-dive pages for each subsystem
- [ ] Explicitly notes that the full architectural document is at `typokit-arch.md` in the repo root
- [ ] Page renders correctly in Starlight

---

#### US-022: Write Architecture — Build Pipeline Deep Dive
**Description:** As a contributor, I need documentation explaining the Rust build pipeline architecture so I can understand how types are transformed into runtime artifacts.

**Acceptance Criteria:**
- [ ] Page at `docs/architecture/build-pipeline.mdx`
- [ ] Explains the Rust transform pipeline stages (Section 12.5): parse → extract → route table → OpenAPI → test stubs → schema diff → Typia callback → write
- [ ] Explains the napi-rs boundary and Typia integration (Section 12.5)
- [ ] Documents the `.typokit/` output directory structure (Section 12.6)
- [ ] Explains the tapable hook system (Section 12.7)
- [ ] Documents build performance targets (Section 12.10)
- [ ] Explains content-hash caching for incremental rebuilds
- [ ] Page renders correctly in Starlight

---

#### US-023: Write Architecture — Compiled Router Deep Dive
**Description:** As a contributor, I need documentation explaining the compiled radix tree router so I can understand how routing works at build time and runtime.

**Acceptance Criteria:**
- [ ] Page at `docs/architecture/router.mdx`
- [ ] Explains radix tree construction at build time (Rust) and runtime consumption (TypeScript)
- [ ] Shows the compiled router output format (Section 13.2)
- [ ] Explains static vs parameterized route lookup
- [ ] Documents edge cases: param vs static priority, wildcard/catch-all, trailing slashes, 405 handling
- [ ] Includes performance targets table (Section 13.2)
- [ ] Page renders correctly in Starlight

---

### Phase 5: AI Agent Documentation

> **Depends on:** Phase 2 (core concepts)

---

#### US-024: Write AI Agent Integration Guide
**Description:** As an AI agent developer, I need documentation explaining how to integrate AI agents with TypoKit's introspection and debugging APIs so agents can build, test, and self-correct autonomously.

**Acceptance Criteria:**
- [ ] Page at `docs/ai-agents/integration.mdx`
- [ ] Documents the AI agent workflow pattern (Section 14.2): modify types → generate → test → inspect errors → self-correct
- [ ] Documents all `typokit inspect` commands with example JSON output
- [ ] Documents the debug sidecar HTTP endpoints (Section 9.3) with request/response examples
- [ ] Explains structured error context (Section 9.2) and how agents parse it to self-correct
- [ ] Explains diff minimization strategy (Section 14.3): file-per-concern, atomic changes
- [ ] Page renders correctly in Starlight

---

#### US-025: Write AI Agent — Machine-Readable Docs
**Description:** As an AI agent, I need machine-readable documentation endpoints or formats so I can programmatically discover TypoKit's API surface without parsing HTML.

**Acceptance Criteria:**
- [ ] Page at `docs/ai-agents/machine-readable.mdx`
- [ ] Documents the `--json` flag available on all `typokit inspect` commands
- [ ] Documents how to access the generated OpenAPI spec (`typokit generate:openapi`) as a machine-readable API description
- [ ] Provides a `llms.txt` file at the site root with a structured summary of TypoKit's capabilities, package list, and links to key docs pages (following the [llms.txt convention](https://llmstxt.org/))
- [ ] Provides a `llms-full.txt` file at the site root with expanded content suitable for LLM context windows
- [ ] Documents which introspection endpoints return structured JSON
- [ ] Page renders correctly in Starlight

---

### Phase 6: Contributing & Blog

> **Depends on:** Phase 1 (site foundation)

---

#### US-026: Write Contributing Guide
**Description:** As a potential TypoKit contributor, I need a guide explaining how to set up the development environment, run tests, and submit changes.

**Acceptance Criteria:**
- [ ] Page at `docs/contributing/index.mdx`
- [ ] Prerequisites: Node.js 24+, pnpm, Rust toolchain (for transform-native development only)
- [ ] Steps: clone repo → `pnpm install` → `nx build` → `nx test`
- [ ] Explains the monorepo structure and package map (Section 12.11)
- [ ] Explains the Nx workspace targets: `build`, `test`, `lint`
- [ ] Explains how to work on the Rust transform (`packages/transform-native/`)
- [ ] Links to the architecture docs for deeper understanding
- [ ] Explains the PR process and CI checks
- [ ] Page renders correctly in Starlight

---

#### US-027: Configure Starlight Blog
**Description:** As a framework maintainer, I need a blog section in the docs site so I can publish release notes, announcements, and technical deep dives.

**Acceptance Criteria:**
- [ ] Starlight blog plugin (`starlight-blog`) installed and configured
- [ ] Blog accessible at `/blog` in the docs site
- [ ] Blog appears in the top navigation bar
- [ ] Seed the blog with one initial post: "Introducing TypoKit" (placeholder content referencing the vision from Section 1 of the arch doc)
- [ ] Blog posts support MDX, code blocks, and images
- [ ] Blog has an RSS feed
- [ ] Page renders correctly in Starlight

---

### Phase 7: Polish & Launch Readiness

> **Depends on:** All previous phases

---

#### US-028: Landing Page Design
**Description:** As a potential TypoKit adopter, I need an attractive landing page that clearly communicates what TypoKit is, why it exists, and how to get started.

**Acceptance Criteria:**
- [ ] Landing page at `docs/index.mdx` (Starlight hero component)
- [ ] Hero section: tagline ("Write the type once"), one-paragraph description, "Get Started" and "GitHub" CTA buttons
- [ ] Feature highlights section: 4-6 cards for key features (schema-first types, Rust build pipeline, pluggable server, auto-generated tests, AI debugging, type-safe client)
- [ ] Code example showcase: side-by-side showing a type definition and all the outputs it generates
- [ ] "Who is this for?" section: framework users, AI agent developers
- [ ] Links to quickstart, core concepts, and API reference
- [ ] Responsive design (mobile, tablet, desktop)
- [ ] Page renders correctly in Starlight
- [ ] Verify in browser if browser testing tools are available

---

#### US-029: Add OpenGraph & SEO Metadata
**Description:** As a framework maintainer, I need proper SEO and social sharing metadata so the docs site is discoverable and looks good when shared.

**Acceptance Criteria:**
- [ ] `<title>` tags set correctly for each page (e.g., "Routing — TypoKit Docs")
- [ ] OpenGraph meta tags: `og:title`, `og:description`, `og:image`, `og:url` configured in Starlight config
- [ ] Social card image (1200x630) created for link previews
- [ ] `robots.txt` and `sitemap.xml` generated by Astro
- [ ] Canonical URLs set correctly
- [ ] Page renders correctly in Starlight

---

#### US-030: Cross-Link Validation & Final QA
**Description:** As a documentation reader, I need all internal links to work and all code examples to be accurate so I don't hit dead ends.

**Acceptance Criteria:**
- [ ] All internal links between docs pages are valid (no 404s) — validated with a link checker (e.g., `astro check` or a CI link-checker step)
- [ ] All code examples use correct TypoKit API signatures (cross-referenced with source)
- [ ] Sidebar navigation matches the actual page structure
- [ ] Full-text search returns relevant results for key terms ("RouteContract", "defineHandlers", "ctx.fail", "ServerAdapter")
- [ ] Site builds with zero warnings
- [ ] CI workflow includes a build-and-link-check step that fails on broken links

---

## Functional Requirements

- FR-1: The docs site must be built with Starlight (Astro) and live inside the monorepo at `packages/docs/`
- FR-2: API reference must be auto-generated from TSDoc/JSDoc comments in all `@typokit/*` package source code using TypeDoc
- FR-3: The docs site must deploy to GitHub Pages via GitHub Actions on every push to `main`
- FR-4: The site must include full-text search via Starlight's built-in Pagefind integration
- FR-5: The site must support dark mode (Starlight default)
- FR-6: The site must be mobile-responsive
- FR-7: All `typokit` CLI commands must be documented with syntax, flags, descriptions, and examples
- FR-8: The site must serve three audiences: framework users, contributors, and AI agents
- FR-9: The site must provide `llms.txt` and `llms-full.txt` files for machine-readable LLM consumption
- FR-10: The site must include a blog section for release notes and announcements
- FR-11: The CI pipeline must validate that all internal links are valid (no broken links)
- FR-12: API reference generation must be part of the build pipeline (not a manual step)
- FR-13: The `nx build docs` command must produce the complete site including auto-generated API reference
- FR-14: Code examples in documentation must accurately reflect the TypoKit API as defined in the architecture document and source code

---

## Non-Goals (Out of Scope)

- **No versioned docs for now** — v1 is the only version; versioning can be added when v2 ships
- **No i18n / translations** — English only for initial launch
- **No interactive playground / REPL** — code examples are static; a live playground is a future enhancement
- **No custom theme** — use Starlight's default theme with minor config (colors, logo); a custom design is a future enhancement
- **No API reference for `@typokit/transform-native` Rust internals** — only the TypeScript public API surface is documented
- **No video tutorials** — written guides only for initial launch
- **No comments or discussion system** — feedback via GitHub Issues
- **No analytics** — can be added later if needed (privacy-respecting options like Plausible)

---

## Design Considerations

- **Starlight theming:** Use Starlight's built-in customization for brand colors. TypoKit's primary color scheme should be consistent with any existing branding (README badges, social cards).
- **Code block language:** All code examples should use syntax-highlighted TypeScript blocks. Terminal commands should use `bash` or `sh` code blocks.
- **Diagrams:** Architecture diagrams can use Mermaid (Starlight supports it via remark plugin) or embedded SVG/PNG images. ASCII art from the arch doc should be converted to proper diagrams.
- **Navigation:** Starlight's sidebar + top nav. "Getting Started" should be the first sidebar section. "API Reference" should be easily discoverable.
- **Starlight components:** Use Starlight's built-in components: `<Tabs>`, `<Card>`, `<LinkCard>`, `<Aside>`, `<Steps>` for rich content.

---

## Technical Considerations

- **Package location:** `packages/docs/` inside the Nx monorepo. This allows the docs build to reference source files from sibling packages for API reference generation.
- **TypeDoc integration:** Use `starlight-typedoc` (Starlight plugin) for seamless integration, or run TypeDoc as a prebuild step that outputs `.mdx` files into the Starlight content directory. The `starlight-typedoc` plugin is preferred as it handles sidebar integration automatically.
- **Build order:** The Nx dependency graph should ensure all `@typokit/*` packages are built before the docs package, so TypeDoc can read compiled type information.
- **GitHub Pages config:** Requires the repository's Settings > Pages to be configured for GitHub Actions deployment. The workflow uses `actions/upload-pages-artifact` and `actions/deploy-pages`.
- **Path filter in CI:** The docs workflow should trigger on changes to `packages/docs/**` (content changes) and `packages/*/src/**` (source changes that affect API reference). This avoids unnecessary rebuilds.
- **Monorepo-aware TypeDoc:** TypeDoc must be configured with `entryPoints` pointing to each package's entry file (e.g., `packages/core/src/index.ts`) and `entryPointStrategy: "packages"` for proper multi-package docs.
- **`llms.txt` generation:** Can be a static file in `packages/docs/public/` or generated as part of the build step. Should follow the [llms.txt specification](https://llmstxt.org/).

---

## Success Metrics

- Docs site builds and deploys successfully to GitHub Pages with zero broken links
- All 28 `@typokit/*` packages have auto-generated API reference pages
- A new user can go from zero to a running TypoKit app by following only the quickstart guide (no external resources needed)
- Full-text search returns relevant results for all core framework concepts
- `llms.txt` is accessible at the site root and contains structured framework information
- The docs CI workflow completes in under 5 minutes
- All code examples in the docs compile against the current TypoKit API (validated manually or via a test step)

---

## Open Questions

1. **Custom domain:** Should the docs site use a custom domain (e.g., `typokit.dev`) or the default GitHub Pages URL (`<org>.github.io/typokit/`)?
2. **Starlight vs docs directory:** Should the docs package live at `packages/docs/` (consistent with all other packages) or top-level `docs/` (common convention for docs)? This PRD assumes `packages/docs/` for monorepo consistency.
3. **TypeDoc vs hand-written API docs:** For packages with complex APIs (e.g., `@typokit/core`), should auto-generated TypeDoc pages be supplemented with hand-written "cookbook" pages, or is TypeDoc sufficient for the API reference section?
4. **Blog frequency:** How often should blog posts be published? Should release notes be auto-generated from changelogs, or hand-written?
5. **Starlight plugins:** Should we use additional Starlight plugins beyond `starlight-typedoc` and `starlight-blog`? Candidates: `starlight-links-validator` (broken link checking), `starlight-image-zoom` (image lightbox).
