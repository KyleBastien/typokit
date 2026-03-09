# PRD: Performance Benchmark Suite

## Introduction

TypoKit claims "zero overhead opinions" — that its abstractions compile away and runtime performance matches hand-written code. This PRD defines a comprehensive benchmark suite that validates that claim by measuring TypoKit across every platform × server combination against a broad field of competitor frameworks.

The suite serves two audiences: **marketing** (publishable comparison charts on the docs site) and **engineering** (CI regression detection to ensure performance never silently degrades). Benchmarks cover HTTP throughput, validation overhead, serialization cost, middleware chains, and full-stack database round-trips.

Results are integrated into the TypoKit documentation site (Astro/Starlight) as a dedicated Benchmarks section with interactive charts and tables.

---

## Goals

- Validate TypoKit's "zero overhead" claim with reproducible, transparent benchmarks
- Benchmark the full platform × server matrix: 3 JS platforms (Node, Bun, Deno) × 4 JS servers (native, Fastify, Hono, Express) = 12 TypoKit JS combinations, plus the Rust/Axum codegen target = 13 total TypoKit combinations
- Compare against 10+ competitor frameworks/runtimes including raw baseline servers
- Measure across multiple dimensions: throughput (req/s), latency (p50/p95/p99), validation cost, serialization cost, and full-stack DB round-trips
- Provide a `pnpm bench` CLI command for local development and a CI-integrated subset for regression detection
- Publish results as a Benchmarks page on the docs site with auto-generated comparison charts
- Ensure benchmarks are reproducible and methodology is transparent

---

## User Stories

### US-001: Benchmark Application Scaffolding

**Description:** As a developer, I need a standardized benchmark application for each framework so that comparisons are fair and equivalent.

**Acceptance Criteria:**

- [ ] Create `packages/benchmarks/` package in the monorepo (private, not published)
- [ ] Each benchmark app implements four identical endpoints:
  - `GET /json` — returns a static JSON object (measures raw routing + serialization)
  - `POST /validate` — accepts a JSON body, validates it, returns validated object (measures validation overhead)
  - `GET /db/:id` — fetches a row by ID from SQLite, returns JSON (measures full-stack round-trip)
  - `GET /startup` — (used by the startup time scenario) returns uptime; the runner measures time from process spawn to first healthy response
- [ ] TypoKit benchmark apps exist for all 12 JS platform × server combinations plus the Rust/Axum codegen target (13 total), including Bun×Express and Deno×Express via compatibility layers
- [ ] The Rust/Axum benchmark app is generated via `@typokit/plugin-axum` from the same TypeScript schema used by the JS apps, then compiled from source to a release binary (not pre-compiled)
- [ ] Competitor benchmark apps exist for: tRPC, Hono (standalone), Fastify (standalone), Express (standalone), NestJS, Elysia, Nitro/H3, Koa, Adonis, raw Node.js `http`, raw `Bun.serve()`, raw `Deno.serve()`, raw Axum (hand-written Rust, no TypoKit codegen)
- [ ] All apps use the same JSON response shape, validation schema, and database table
- [ ] A shared `benchmarks/fixtures/` directory contains the common SQLite seed data and schema
- [ ] Each app is independently startable via a uniform script interface (e.g., `node dist/server.js`, platform equivalent, or compiled Rust binary)
- [ ] Typecheck passes for all TypeScript benchmark apps; `cargo build --release` succeeds for the Rust/Axum app

### US-002: Benchmark Runner CLI

**Description:** As a developer, I want a single CLI command to run benchmarks so that I don't have to manually start servers and configure load generators.

**Acceptance Criteria:**

- [ ] All benchmark commands are defined as Nx targets in `packages/benchmarks/project.json` using the `nx:run-commands` executor
- [ ] `nx run benchmarks:bench` (aliased as `pnpm bench` via root `package.json` script) runs the full benchmark suite
- [ ] `nx run benchmarks:bench --scenario json` / `--scenario validate` / `--scenario db` / `--scenario startup` runs a single scenario
- [ ] The `startup` scenario measures cold-start time (process spawn to first healthy response) for each framework — especially relevant for serverless use cases
- [ ] `nx run benchmarks:bench --filter "typokit-*"` runs only TypoKit combinations
- [ ] `nx run benchmarks:bench --filter "fastify"` runs only a specific framework
- [ ] `nx run benchmarks:bench-ci` runs a fast subset suitable for CI (fewer iterations, key combos only)
- [ ] `nx run benchmarks:bench-baseline` updates the stored baseline for regression detection
- [ ] `nx run benchmarks:bench-info` prints current system info
- [ ] `nx run benchmarks:bench-reproduce` prints step-by-step reproduction instructions
- [ ] The `bench` target declares `dependsOn: ["^build"]` so all TypoKit packages are built before benchmarking
- [ ] The runner orchestrates: start server → wait for healthy → run bombardier → collect results → stop server → next
- [ ] Each server gets a configurable warmup period before measurement begins
- [ ] Runner outputs progress to stdout with a clean summary table at the end
- [ ] Results are written to `benchmarks/results/` as timestamped JSON files
- [ ] Typecheck and lint pass

### US-003: bombardier Integration

**Description:** As a developer, I need the benchmark suite to use bombardier for HTTP load generation so that results are consistent across Node, Bun, and Deno runtimes.

**Acceptance Criteria:**

- [ ] bombardier binary is downloaded/cached automatically on first run (support macOS, Linux, Windows)
- [ ] Default benchmark parameters: 100 concurrent connections, 30-second duration, 10-second warmup
- [ ] CI mode parameters: 50 concurrent connections, 10-second duration, 5-second warmup
- [ ] Raw bombardier JSON output is captured and parsed for each run
- [ ] Extracted metrics: requests/sec (avg), latency p50, p95, p99, p99.9, transfer/sec, total requests, errors
- [ ] If bombardier is not available and cannot be downloaded, the runner exits with a clear error message and installation instructions

### US-004: Results Aggregation & Comparison

**Description:** As a developer, I want benchmark results aggregated into a structured comparison format so that I can easily see how TypoKit stacks up.

**Acceptance Criteria:**

- [ ] Results JSON includes: framework name, platform, server adapter, scenario, all latency percentiles, req/s, errors, timestamp, system info (OS, CPU, RAM, runtime versions)
- [ ] A summary markdown table is auto-generated after each run, grouped by scenario
- [ ] Table columns: Rank, Framework, Platform, Server, Req/s, Latency p50, p95, p99, vs. Fastest (%)
- [ ] Results from multiple runs can be averaged to reduce noise (configurable `--runs N`)
- [ ] A `benchmarks/results/latest.json` symlink/copy always points to the most recent full run
- [ ] Typecheck passes

### US-005: Regression Detection in CI

**Description:** As a maintainer, I want CI to detect performance regressions automatically so that slow changes don't merge unnoticed.

**Acceptance Criteria:**

- [ ] A GitHub Actions workflow (`benchmark.yml`) runs in two modes: PR (fast subset) and main branch push (full suite). Both modes use `nx affected` to only run benchmarks whose upstream dependencies have changed.
- [ ] **PR mode**: runs the `bench-ci` fast subset, scoped by `nx affected`, for regression detection only. If no benchmark-relevant packages are affected, the workflow skips benchmarking entirely.
- [ ] **Main branch mode**: on push to `main`, runs the full `bench` suite scoped by `nx affected`. Only re-benchmarks combinations whose upstream packages changed; merges fresh results into the existing `latest.json` (unchanged combinations retain their previous data). Commits the updated `latest.json` and triggers a docs site redeploy. If nothing is affected, the workflow skips and the docs site continues serving the existing results.
- [ ] CI installs a Rust toolchain (via `actions-rust-lang/setup-rust-toolchain`) in both PR and main branch modes so Rust/Axum benchmarks are always included
- [ ] Results are compared against a stored baseline (`benchmarks/baseline.json`)
- [ ] If any TypoKit combination degrades by more than 10% in req/s vs. baseline, the check fails with a clear diff
- [ ] Baseline can be updated manually via `nx run benchmarks:bench-baseline` (aliased as `pnpm bench:baseline`, commits new baseline.json)
- [ ] CI benchmark runs on a consistent GitHub Actions runner size (e.g., `ubuntu-latest` with pinned specs)
- [ ] PR mode posts a comment on the PR with a summary table of results vs. baseline
- [ ] Main branch mode merges new results into the existing `latest.json` and commits via a bot commit (e.g., `chore(benchmarks): update benchmark results [skip ci]`); triggers docs deploy only if results actually changed

### US-006: Docs Site Integration — Benchmarks Page

**Description:** As a user visiting the TypoKit docs, I want to see benchmark results with interactive charts so that I can evaluate TypoKit's performance claims.

**Acceptance Criteria:**

- [ ] A new "Performance" section is added to the Starlight sidebar in `astro.config.mjs`
- [ ] The section contains at least two pages: "Benchmarks" (overview + charts) and "Methodology" (how benchmarks are run)
- [ ] The Benchmarks page displays:
  - Bar chart comparing req/s across all frameworks for the JSON scenario (logarithmic scale to accommodate wide variance)
  - Bar chart comparing req/s for the validation scenario (logarithmic scale)
  - Bar chart comparing req/s for the full-stack DB scenario (logarithmic scale)
  - Bar chart comparing cold-start time for the startup scenario
  - Latency percentile comparison table
  - TypoKit platform × server heatmap showing all 13 combinations (12 JS + Rust/Axum)
- [ ] Charts use logarithmic scale for req/s to handle wide performance variance (e.g., NestJS vs. raw Axum); chart captions note the scale
- [ ] Charts are rendered using Chart.js in a custom Astro component for simplicity and Starlight compatibility
- [ ] Charts are generated from `benchmarks/results/latest.json` at docs build time (static generation, not client-side fetching); `latest.json` is kept current automatically by the main branch CI workflow
- [ ] The Methodology page explains: hardware specs, bombardier settings, warmup duration, what each scenario measures, how to reproduce locally
- [ ] Charts use a consistent color scheme aligned with TypoKit docs branding
- [ ] Pages are responsive and readable on mobile
- [ ] Verify in browser if browser testing tools are available

### US-007: Validation Overhead Isolation

**Description:** As an engineer, I want to measure the exact overhead that TypoKit's type-driven validation adds compared to no-validation and hand-written validation baselines.

**Acceptance Criteria:**

- [ ] The `/validate` scenario uses a moderately complex schema: nested object with 8+ fields, mixed types (string, number, enum, array, optional)
- [ ] Benchmark includes three TypoKit variants per platform×server combo: (a) validation enabled, (b) validation disabled/passthrough, (c) hand-written `if/typeof` validation
- [ ] Results clearly show the delta: "TypoKit validation adds X% overhead vs. passthrough" and "TypoKit validation is X% faster/slower than hand-written"
- [ ] These comparisons appear on the docs Benchmarks page

### US-008: Middleware & Serialization Overhead Isolation

**Description:** As an engineer, I want to measure how TypoKit middleware chains and response serialization perform compared to bare framework equivalents.

**Acceptance Criteria:**

- [ ] A `/middleware` scenario is added: request passes through 5 no-op middleware layers before returning JSON
- [ ] Benchmark compares: TypoKit with 5 middleware vs. bare framework with 5 equivalent middleware
- [ ] A serialization microbenchmark measures JSON serialization of a complex nested object (not HTTP — pure serialization) using TypoKit's compiled serializer vs. `JSON.stringify`
- [ ] Results are included in the comparison tables and docs charts
- [ ] Typecheck passes

### US-009: Database Round-Trip Benchmarking

**Description:** As an engineer, I want to benchmark TypoKit's full-stack performance including database queries so that users see realistic numbers, not just "hello world" throughput.

**Acceptance Criteria:**

- [ ] All `/db/:id` benchmark apps use SQLite with the same schema and seed data (1,000 rows)
- [ ] The endpoint performs: parse route param → query DB → serialize response
- [ ] TypoKit apps use the appropriate DB adapter (e.g., `@typokit/db-raw` for fairness, since competitors use raw SQL)
- [ ] Competitor apps use their native/recommended DB approach (e.g., Prisma for NestJS, Drizzle for Hono examples)
- [ ] A "raw SQL" baseline exists for each platform to isolate framework overhead from DB overhead
- [ ] Results clearly separate "framework overhead" from "total request time"

### US-010: System Info & Reproducibility

**Description:** As a user viewing benchmarks, I want full transparency about how results were generated so that I can reproduce them or account for hardware differences.

**Acceptance Criteria:**

- [ ] Every results JSON file includes: OS name + version, CPU model + cores, total RAM, runtime versions (Node/Bun/Deno with exact pinned versions), bombardier version, timestamp
- [ ] Deno benchmarks pin to the latest stable Deno version at suite creation time; the version is documented in results metadata and updated periodically
- [ ] A `nx run benchmarks:bench-info` command prints the current system info in the same format
- [ ] The docs Methodology page includes the exact hardware specs used for the published results
- [ ] A `nx run benchmarks:bench-reproduce` command prints step-by-step instructions to reproduce the published results
- [ ] All benchmark source code is in the public repo (no private dependencies)

---

## Functional Requirements

- FR-1: The benchmark suite lives in `packages/benchmarks/` as a private monorepo package
- FR-2: Each benchmark app implements exactly the same API surface: `GET /json`, `POST /validate`, `GET /db/:id`, `GET /middleware`, `GET /startup`
- FR-3: All benchmark apps use the same JSON response shape, validation schema, middleware count, DB schema, and seed data
- FR-4: The benchmark runner is a Node.js script invoked via Nx targets defined in `packages/benchmarks/project.json` using the `nx:run-commands` executor. Root `package.json` scripts (`pnpm bench`, `pnpm bench:ci`, `pnpm bench:baseline`, `pnpm bench:info`, `pnpm bench:reproduce`) are thin aliases to the corresponding `nx run benchmarks:*` targets.
- FR-4a: The `bench` target declares `dependsOn: ["^build"]` to ensure all upstream TypoKit packages are compiled before benchmarking. The `bench-ci` target uses the same dependency chain.
- FR-5: bombardier is the sole HTTP load generator; it is auto-downloaded and cached in `node_modules/.cache/benchmarks/`
- FR-6: Default benchmark: 100 connections, 30s duration, 10s warmup, 3 runs averaged
- FR-7: CI benchmark: 50 connections, 10s duration, 5s warmup, 1 run
- FR-8: Results are persisted as JSON in `packages/benchmarks/results/` with ISO 8601 timestamps in filenames
- FR-9: `latest.json` is a cumulative file — new benchmark runs merge fresh results into the existing data; combinations not re-run retain their previous results
- FR-10: Regression detection compares against `baseline.json` with a configurable threshold (default 10% degradation); only affected combinations are checked
- FR-11: CI workflow runs on `ubuntu-latest` in two modes: PR (fast subset) and main branch push (full suite). Both modes use `nx affected` to scope benchmarks to only those whose upstream dependencies changed. If nothing is affected, the workflow skips benchmarking and the docs site continues serving existing results.
- FR-11a: The main branch run merges fresh results into the existing `latest.json` (unchanged combinations keep their previous data), commits only if results changed, and triggers a docs redeploy
- FR-12: Docs site reads `latest.json` at build time and renders static charts (no client-side data fetching); the docs deploy is triggered after the main branch benchmark run commits fresh results
- FR-13: Charts are rendered using Chart.js in a custom Astro component, with logarithmic scale for req/s charts to accommodate wide performance variance across frameworks
- FR-14: All TypoKit combinations are tested: Node×native, Node×Fastify, Node×Hono, Node×Express, Bun×native, Bun×Fastify, Bun×Hono, Bun×Express, Deno×native, Deno×Fastify, Deno×Hono, Deno×Express, and Rust×Axum (codegen target)
- FR-15: Competitor frameworks benchmarked: tRPC, Hono standalone, Fastify standalone, Express standalone, NestJS, Elysia, Nitro/H3, Koa, Adonis, raw Node.js http, raw Bun.serve(), raw Deno.serve(), raw Axum (hand-written Rust)
- FR-16: The Rust/Axum benchmark app is code-generated via `@typokit/plugin-axum` from the shared TypeScript schema, compiled from source as a `--release` binary, and started as a subprocess by the benchmark runner
- FR-17: Bun×Express and Deno×Express combinations are included via compatibility layers, with a note in results metadata indicating the compatibility approach used
- FR-18: Deno benchmarks pin to the latest stable Deno version at suite creation time; the pinned version is documented in results metadata and updated periodically
- FR-19: Both PR and main branch CI modes use `nx affected` to only run benchmarks whose upstream packages changed; unaffected combinations are skipped entirely. A Rust toolchain is installed in both modes via `actions-rust-lang/setup-rust-toolchain`.

---

## Non-Goals (Out of Scope)

- **Not a load testing tool** — the suite measures relative framework performance, not production capacity planning
- **No WebSocket benchmarks** — HTTP only for v1; WebSocket perf can be added later
- **No cluster/multi-process benchmarks** — single-process only to isolate framework overhead
- **No memory profiling** — focus is on throughput and latency; memory benchmarks may be a future addition
- **No TechEmpower submission** — while methodology is inspired by TechEmpower, the suite is not formatted for TechEmpower submission
- **No Docker-based isolation** — benchmarks run directly on the host for simplicity; containerized benchmarks can be added later
- **No client-side rendering benchmarks** — this covers server-side only; `@typokit/client-*` package perf is out of scope
- **No Windows benchmarks in CI** — CI runs on Linux; Windows/macOS can be run manually

---

## Technical Considerations

- **bombardier installation**: Auto-download from GitHub releases; cache in `node_modules/.cache/benchmarks/bombardier`. Detect platform (linux/darwin/windows) and arch (amd64/arm64) automatically.
- **Server startup**: Each benchmark app must export a `start()` function that returns a `{ port, close() }` handle. The runner starts the server, polls `/json` until healthy, then begins the benchmark.
- **Port management**: Use dynamic port allocation (port 0) to avoid conflicts. Pass the assigned port to bombardier.
- **Bun/Deno apps**: These need to be started via `bun run` / `deno run` subprocesses from the Node.js runner. The runner must handle cross-runtime process management.
- **Rust/Axum app**: The codegen output from `@typokit/plugin-axum` is compiled with `cargo build --release` during `pnpm bench:build`. The runner starts the resulting binary as a subprocess. The Rust app uses `rusqlite` for SQLite access in the DB scenario. A Rust toolchain (rustc/cargo) must be available on the machine; the runner should check for this and provide a clear error if missing.
- **Rust/Axum as a ceiling**: The Rust/Axum combination represents TypoKit's "maximum performance" codegen target. Charts should visually distinguish it from JS combinations (e.g., separate color/group) since it's a compiled native binary rather than a JS runtime.
- **SQLite for DB benchmarks**: Use `better-sqlite3` for Node, Bun's built-in `bun:sqlite`, and Deno's `@db/sqlite`. Pre-seed a shared `.sqlite` file copied per-run to avoid write contention.
- **Astro integration**: Charts can be implemented as an Astro component that imports `latest.json` and renders via Chart.js or similar. Since Starlight supports custom components, this fits naturally.
- **CI variance**: GitHub Actions runners have variable performance. Mitigate by: (a) comparing relative performance (TypoKit vs. baseline), not absolute numbers; (b) running baseline and TypoKit in the same CI job; (c) using percentage-based regression thresholds.
- **Monorepo build order**: `packages/benchmarks` should depend on all TypoKit server/platform packages. The `bench` Nx target uses `dependsOn: ["^build"]` so Nx's task graph automatically builds all upstream dependencies before running benchmarks. This follows the same pattern used by docs, test, and lint targets in the repo.
- **Nx project.json structure**: All benchmark targets are defined in `packages/benchmarks/project.json` using `nx:run-commands` executor with `cwd: "{projectRoot}"`, consistent with the existing `docs` package pattern. Root `package.json` scripts are thin `nx run benchmarks:*` aliases for developer convenience.

---

## Success Metrics

- All 13 TypoKit combinations (12 JS + Rust/Axum) complete benchmarks without errors
- TypoKit Rust/Axum codegen achieves within 10% of raw hand-written Axum throughput on the JSON scenario
- TypoKit native server on Node achieves within 15% of raw `http.createServer` throughput on the JSON scenario
- TypoKit validation overhead is less than 20% vs. passthrough on the validation scenario
- CI regression detection catches a simulated 15% slowdown and fails the check
- Benchmark results page is live on the docs site with charts and methodology
- A developer can run `pnpm bench` and get a full comparison table in under 30 minutes
- CI fast subset completes in under 10 minutes

---

## Resolved Decisions

| Decision | Resolution |
|----------|-----------|
| Bun×Express / Deno×Express inclusion | **Include** via compatibility layers; note the approach in results metadata |
| Charting library | **Chart.js** in a custom Astro component — simple, well-supported, Starlight-compatible |
| Auto-publish to docs | **Yes** — main branch CI commits `latest.json` and triggers docs redeploy automatically |
| Slow framework chart scaling | **Logarithmic scale** for req/s charts with caption noting the scale |
| Startup time benchmark | **Yes** — added as a `--scenario startup` measuring process spawn to first healthy response |
| Deno version pinning | **Pin to latest stable** at suite creation; document in results metadata, update periodically |
| Rust toolchain in CI | **Install in both PR and main modes** via `actions-rust-lang/setup-rust-toolchain` |
| Nx affected scoping | **All benchmarks** use `nx affected` in both PR and main branch CI — only re-run combinations whose upstream packages changed; unaffected combinations retain existing `latest.json` data |
| Rust/Axum binary strategy | **Always build from source** during benchmark runs (not pre-compiled) |
