# PRD: TypoKit JS/TS Runtime Performance Optimization

## Introduction

TypoKit's JavaScript/TypeScript runtime performance has significant gaps versus both raw HTTP baselines and competitor frameworks. On Node.js, TypoKit's best configuration (Fastify adapter) achieves 17,084 req/s on the JSON benchmark—25% slower than raw `node:http` (18,115 req/s) and 19.5% behind H3 (21,220 req/s). On Bun, the gap widens dramatically: the best TypoKit configuration (Bun+Fastify, 22,114 req/s) is 57% behind Elysia (51,424 req/s) and 48.5% behind raw `Bun.serve()` (42,949 req/s).

TypoKit's design promise is that "plain TypeScript types are the single source of truth"—compile-time magic with zero runtime cost. The current framework overhead of 15-58% contradicts this promise. This PRD identifies 17 concrete performance issues discovered through deep analysis of the latest CI benchmark run (2026-03-11) and the framework's hot-path source code, and defines user stories to address each one.

### Benchmark Environment (Reference)

- **Hardware:** AMD EPYC 7763, 4 cores, 16 GB RAM (GitHub Actions)
- **Config:** 100 connections, 30s duration, 5s warmup, 3 runs averaged
- **Tool:** Bombardier v2.0.2
- **Runtimes:** Node v24.14.0, Bun 1.3.10

### Current Performance Summary

| Scenario | TypoKit Best (Node) | Raw Node | Gap | TypoKit Best (Bun) | Raw Bun | Gap |
|----------|-------------------|----------|-----|-------------------|---------|-----|
| JSON | 17,084 (fastify) | 18,115 | -5.7% | 22,114 (fastify) | 42,949 | -48.5% |
| Validate | 11,391 (native) | 13,744 | -17.1% | 14,747 (native) | 31,049 | -52.5% |
| DB | 10,150 (fastify) | 10,909 | -7.0% | 12,098 (fastify) | 21,378 | -43.4% |
| Middleware | 14,436 (fastify) | 18,069 | -20.1% | 18,758 (fastify) | 43,131 | -56.5% |
| Startup | 17,475 (fastify) | 17,894 | -2.3% | 22,469 (fastify) | 44,392 | -49.4% |

### Competitor Comparison (Node.js, JSON scenario)

| Framework | Req/s | vs TypoKit Best |
|-----------|-------|-----------------|
| H3 | 21,220 | +24.2% faster |
| Raw Node | 18,115 | +6.0% faster |
| **TypoKit (fastify)** | **17,084** | **baseline** |
| Fastify (standalone) | 16,029 | -6.2% slower |
| Adonis | 14,478 | -15.3% slower |

### Competitor Comparison (Bun, JSON scenario)

| Framework | Req/s | vs TypoKit Best |
|-----------|-------|-----------------|
| Elysia | 51,424 | +132.6% faster |
| Raw Bun | 42,949 | +94.2% faster |
| **TypoKit (bun-fastify)** | **22,114** | **baseline** |
| TypoKit (bun-native) | 20,351 | -8.0% slower |

## Goals

- Reduce TypoKit framework overhead to **<5% vs raw HTTP baseline** on both Node.js and Bun across all benchmark scenarios (JSON, validate, db, middleware, startup)
- **Match or beat H3** (21,220 req/s) on Node.js JSON benchmark
- **Match or beat raw Bun.serve()** (42,949 req/s) on Bun JSON benchmark, closing the 48.5% gap
- Reduce middleware execution overhead from **9-15% to <2%** (matching competitor frameworks at 0.3-4%)
- Reduce p99 latency spikes on Fastify adapter validation scenario from **21.7ms to <12ms**
- Maintain TypoKit's existing validation overhead advantage (<3.5% vs passthrough/handwritten)
- All improvements measurable via existing CI benchmark pipeline with >10% regression detection

## User Stories

### US-001: Pre-sort Middleware Chain at Registration Time

**Description:** As a framework user, I want middleware execution to add near-zero overhead so that my app performs as close to raw HTTP as possible.

**Acceptance Criteria:**
- [ ] `executeMiddlewareChain()` in `packages/core/src/middleware.ts` no longer calls `Array.sort()` on every request
- [ ] Middleware entries are sorted once at registration/startup time (in `registerRoutes` or `defineMiddleware`)
- [ ] Sorted order is stored as a pre-computed array on the route or adapter
- [ ] Middleware benchmark scenario overhead drops from 9-15% to <3% vs JSON baseline
- [ ] Existing middleware priority ordering behavior is preserved (same sort semantics)
- [ ] All existing tests pass: `pnpm nx test core && pnpm nx test server-native`
- [ ] Typecheck passes: `pnpm nx typecheck core`
- [ ] Run benchmarks locally (`pnpm nx run benchmarks:bench`) before and after changes to validate measurable improvement and no regressions

### US-002:Eliminate Per-Request Context Object Allocation

**Description:** As a framework developer, I want request context to be created without N object spread allocations so that GC pressure is minimized under high concurrency.

**Acceptance Criteria:**
- [ ] `executeMiddlewareChain()` no longer creates a new object via `{ ...currentCtx, ...added }` per middleware layer
- [ ] Context is mutated in-place using `Object.assign()` or direct property assignment on a single pre-allocated object
- [ ] RequestContext type contract is preserved (downstream handlers see the same shape)
- [ ] p99 latency on Fastify validation scenario drops below 15ms (currently 21.7ms)
- [ ] All existing tests pass: `pnpm nx test core`
- [ ] Typecheck passes: `pnpm nx typecheck core`
- [ ] Run benchmarks locally (`pnpm nx run benchmarks:bench`) before and after changes to validate measurable improvement and no regressions

### US-003:Replace Random Request ID with Fast Counter

**Description:** As a framework developer, I want request ID generation to be allocation-free so that it doesn't contribute to per-request overhead.

**Acceptance Criteria:**
- [ ] `createRequestContext()` in `packages/core/src/middleware.ts` no longer calls `Math.random().toString(36)` twice per request
- [ ] Request IDs use a monotonically incrementing counter (e.g., `BigInt` or pre-formatted numeric string)
- [ ] IDs remain unique within a process lifetime (no collisions)
- [ ] Request ID format change is documented as a breaking change
- [ ] All existing tests pass: `pnpm nx test core`
- [ ] Typecheck passes: `pnpm nx typecheck core`
- [ ] Run benchmarks locally (`pnpm nx run benchmarks:bench`) before and after changes to validate measurable improvement and no regressions

### US-004:Optimize Request Normalization — Avoid URL Constructor

**Description:** As a framework developer, I want request normalization to avoid expensive `new URL()` construction so that the Node.js native server closes the gap with raw `node:http`.

**Acceptance Criteria:**
- [ ] `normalizeRequest()` in `packages/platform-node/src/index.ts` no longer constructs a `URL` object
- [ ] Path extraction uses `req.url.indexOf('?')` with `substring()` instead
- [ ] Query string parsing uses a lightweight custom parser or `URLSearchParams` only on the query portion
- [ ] Header normalization avoids creating intermediate objects where possible
- [ ] Node.js native JSON benchmark improves by at least 10% (from 13,585 to >14,900 req/s)
- [ ] All existing tests pass: `pnpm nx test platform-node && pnpm nx test server-native`
- [ ] Typecheck passes: `pnpm nx typecheck platform-node`
- [ ] Run benchmarks locally (`pnpm nx run benchmarks:bench`) before and after changes to validate measurable improvement and no regressions

### US-005:Optimize Body Collection — Single Buffer.concat

**Description:** As a framework developer, I want body collection to minimize allocations so that POST/PUT request handling is faster.

**Acceptance Criteria:**
- [ ] `collectBody()` in `packages/platform-node/src/index.ts` uses `Buffer.concat()` with a pre-allocated size hint when `content-length` header is available
- [ ] For small bodies (<16KB), use a single pre-allocated buffer instead of collecting chunks into an array
- [ ] JSON parsing is deferred until the handler or validator actually needs the parsed body (lazy parsing)
- [ ] Validation benchmark scenario on Node native improves by at least 5%
- [ ] All existing tests pass: `pnpm nx test platform-node`
- [ ] Run benchmarks locally (`pnpm nx run benchmarks:bench`) before and after changes to validate measurable improvement and no regressions

### US-006:Implement Bun-Native Server Path

**Description:** As a Bun user, I want TypoKit to use `Bun.serve()` directly so that I get near-native Bun performance instead of being routed through Node.js compatibility layers.

**Acceptance Criteria:**
- [ ] `packages/platform-bun/src/index.ts` provides a `createBunServer()` function that uses `Bun.serve({ fetch })` directly
- [ ] The Bun native path avoids `node:http` entirely—uses the Web Fetch API (`Request`/`Response`) natively
- [ ] Body is accessed via `request.json()` / `request.text()` (Bun's native zero-copy methods)
- [ ] Headers are accessed via the native `Headers` API without conversion to plain objects
- [ ] `packages/server-native/src/index.ts` detects Bun runtime and delegates to the Bun-native path
- [ ] New benchmark app `typokit-bun-native-direct` (or update existing) uses this path
- [ ] Bun JSON benchmark reaches at least 35,000 req/s (from 20,351), closing >50% of the gap to raw Bun (42,949)
- [ ] All existing Bun benchmark scenarios continue to work
- [ ] Typecheck passes: `pnpm nx typecheck platform-bun && pnpm nx typecheck server-native`
- [ ] Run benchmarks locally (`pnpm nx run benchmarks:bench`) before and after changes to validate measurable improvement and no regressions

### US-007:Avoid Path Segment Array Allocation in Route Lookup

**Description:** As a framework developer, I want route lookup to avoid creating a string array per request so that routing overhead is minimized.

**Acceptance Criteria:**
- [ ] `lookupRoute()` in `packages/server-native/src/index.ts` no longer calls `path.split('/')` to create a segments array
- [ ] Route lookup uses index-based traversal: scan the path string character-by-character, matching segments against the radix tree without allocating an array
- [ ] `decodeURIComponent()` is only called on parameter captures, not on static segments
- [ ] All existing routing tests pass including parameterized and wildcard routes
- [ ] Typecheck passes: `pnpm nx typecheck server-native`
- [ ] Run benchmarks locally (`pnpm nx run benchmarks:bench`) before and after changes to validate measurable improvement and no regressions

### US-008:Skip Validation Pipeline for Routes Without Validators

**Description:** As a framework developer, I want the validation pipeline to be completely bypassed for routes that have no validators so that GET endpoints with no params/query validation pay zero cost.

**Acceptance Criteria:**
- [ ] `handleRequest()` in server adapters checks `handler.validators` existence before calling `runValidators()`
- [ ] If `handler.validators` is `undefined` or all three fields (params, query, body) are `undefined`, validation is skipped entirely
- [ ] The JSON and startup benchmark scenarios (which have no validators) see a measurable improvement
- [ ] Routes with validators continue to work identically
- [ ] All existing tests pass across all server adapter packages
- [ ] Run benchmarks locally (`pnpm nx run benchmarks:bench`) before and after changes to validate measurable improvement and no regressions

### US-009:Compile Middleware Chain into Single Function at Registration

**Description:** As a framework developer, I want middleware chains to be compiled into a single callable function at route registration time so that per-request middleware dispatch has zero loop overhead.

**Acceptance Criteria:**
- [ ] A new `compileMiddlewareChain(entries: MiddlewareEntry[])` function produces a single `(req, ctx) => Promise<ctx>` function
- [ ] The compiled function has the middleware calls inlined or chained without array iteration at runtime
- [ ] For routes with 0 middleware, the compiled function is a no-op pass-through (identity function)
- [ ] For routes with 1 middleware, the compiled function is just that middleware's handler directly
- [ ] Middleware benchmark overhead drops to <2% vs JSON baseline
- [ ] All existing middleware tests pass
- [ ] Typecheck passes: `pnpm nx typecheck core`
- [ ] Run benchmarks locally (`pnpm nx run benchmarks:bench`) before and after changes to validate measurable improvement and no regressions

### US-010:Optimize Hono Adapter — Eliminate URL Object Construction

**Description:** As a Hono adapter user, I want request handling to avoid constructing `new URL()` per request so that Hono performance matches the standalone Hono framework.

**Acceptance Criteria:**
- [ ] `packages/server-hono/src/index.ts` no longer constructs `new URL(req.url)` in the request handler
- [ ] Path and query extraction uses Hono's native `c.req.path` and `c.req.query()` APIs instead
- [ ] Response handling eliminates the type-cast anti-pattern (`(c as unknown as Record<string, unknown>)._typoResponse`)
- [ ] TypoKit Hono on Node.js JSON benchmark improves from 12,385 to at least 13,500 req/s (matching standalone Hono at 12,801+)
- [ ] All existing Hono adapter tests pass
- [ ] Typecheck passes: `pnpm nx typecheck server-hono`
- [ ] Run benchmarks locally (`pnpm nx run benchmarks:bench`) before and after changes to validate measurable improvement and no regressions

### US-011:Pre-compute and Cache Serialized Response Headers

**Description:** As a framework developer, I want common response headers to be pre-computed so that response writing is faster.

**Acceptance Criteria:**
- [ ] Common header combinations (e.g., `content-type: application/json`) are created once as reusable constants
- [ ] `writeResponse()` in platform adapters reuses pre-computed header objects instead of creating new ones per response
- [ ] `serializeResponse()` returns a pre-computed content-type alongside the serialized body
- [ ] Node native JSON benchmark shows measurable improvement in p50 latency
- [ ] All existing tests pass across platform and server packages
- [ ] Run benchmarks locally (`pnpm nx run benchmarks:bench`) before and after changes to validate measurable improvement and no regressions

### US-012:Optimize Fastify Adapter — Use Native Request Properties

**Description:** As a Fastify adapter user, I want request normalization to use Fastify's pre-parsed request properties so that double-parsing is eliminated.

**Acceptance Criteria:**
- [ ] `normalizeRequest()` in `packages/server-fastify/src/index.ts` no longer calls `req.url.split('?')[0]` for path extraction
- [ ] Uses `req.routeOptions.url` or Fastify's parsed route path directly
- [ ] Query parameters use `req.query` directly without re-parsing
- [ ] Header access uses `req.headers` object directly without enumeration into a new object
- [ ] p99 latency on Fastify validation scenario drops from 21.7ms to <12ms
- [ ] TypoKit Fastify on Node.js JSON benchmark reaches at least 18,000 req/s
- [ ] All existing Fastify adapter tests pass
- [ ] Typecheck passes: `pnpm nx typecheck server-fastify`
- [ ] Run benchmarks locally (`pnpm nx run benchmarks:bench`) before and after changes to validate measurable improvement and no regressions

### US-013:Implement Connection Keep-Alive Tuning for Native Server

**Description:** As a framework user running the native server, I want HTTP keep-alive to be properly configured so that connection reuse reduces per-request overhead.

**Acceptance Criteria:**
- [ ] `packages/platform-node/src/index.ts` sets `server.keepAliveTimeout` to an appropriate value (e.g., 5000ms)
- [ ] `server.maxHeadersCount` is tuned for the common case
- [ ] `server.headersTimeout` is set to prevent slowloris-style stalls
- [ ] Node native startup benchmark shows measurable improvement
- [ ] All existing tests pass: `pnpm nx test platform-node`
- [ ] Run benchmarks locally (`pnpm nx run benchmarks:bench`) before and after changes to validate measurable improvement and no regressions

### US-014:Consolidate Validator Map Lookup into Single Route-Keyed Access

**Description:** As a framework developer, I want validator lookups to be a single hash map access per route instead of three separate lookups so that validation dispatch is faster.

**Acceptance Criteria:**
- [ ] `ValidatorMap` structure is changed from `Record<string, ValidatorFn>` (keyed by validator name) to a route-keyed structure: `Record<routeRef, { params?: ValidatorFn, query?: ValidatorFn, body?: ValidatorFn }>`
- [ ] `runValidators()` performs a single hash lookup to get all three validators for a route
- [ ] The `registerRoutes()` call pre-resolves validator references into the consolidated map at startup
- [ ] Validation benchmark scenario on all adapters shows improvement
- [ ] This is documented as a breaking change to the `ValidatorMap` type in `@typokit/types`
- [ ] All existing tests pass across all server adapters
- [ ] Typecheck passes: `pnpm nx typecheck types`
- [ ] Run benchmarks locally (`pnpm nx run benchmarks:bench`) before and after changes to validate measurable improvement and no regressions

### US-015:Lazy Error Object Construction

**Description:** As a framework developer, I want error objects to be lazily constructed so that the happy path pays no cost for error handling infrastructure.

**Acceptance Criteria:**
- [ ] `createRequestContext()` provides `fail()` as a lightweight function that doesn't pre-allocate error metadata
- [ ] AppError construction (stack trace capture, source file resolution, related test lookup) is deferred until the error is actually serialized for the response
- [ ] Error middleware in `packages/core/src/` avoids `instanceof` checks on the hot path when no error occurred
- [ ] The `process.env.NODE_ENV` check for development mode is cached once at startup, not evaluated per-error
- [ ] All existing error handling tests pass: `pnpm nx test errors && pnpm nx test core`
- [ ] Run benchmarks locally (`pnpm nx run benchmarks:bench`) before and after changes to validate measurable improvement and no regressions

### US-016:Eliminate Redundant Path Parsing Between Normalization and Routing

**Description:** As a framework developer, I want the URL path to be parsed exactly once and shared between request normalization and route lookup.

**Acceptance Criteria:**
- [ ] In the native server adapter's `handleRequest()`, the path string is extracted once during normalization
- [ ] The same path string (or pre-split segments) is passed directly to `lookupRoute()` without re-parsing
- [ ] Query string separation happens once, not in both normalization and routing
- [ ] All existing routing and normalization tests pass
- [ ] Typecheck passes: `pnpm nx typecheck server-native && pnpm nx typecheck platform-node`
- [ ] Run benchmarks locally (`pnpm nx run benchmarks:bench`) before and after changes to validate measurable improvement and no regressions

### US-017:Add Node.js Cluster Mode Support

**Description:** As a production user, I want TypoKit to optionally utilize all available CPU cores so that throughput scales linearly with core count on multi-core machines.

**Acceptance Criteria:**
- [ ] `@typokit/platform-node` exports a `createClusterServer()` function that uses `node:cluster` to fork workers
- [ ] Worker count defaults to `os.availableParallelism()` (or `os.cpus().length` as fallback)
- [ ] Workers share the same port via the cluster module's built-in load balancing
- [ ] Graceful shutdown sends `SIGTERM` to all workers and waits for in-flight requests
- [ ] A new benchmark scenario `startup-cluster` demonstrates multi-core throughput
- [ ] On 4-core CI machines, cluster mode achieves at least 3x single-core throughput
- [ ] `createApp()` accepts an optional `cluster: true | { workers: number }` configuration
- [ ] Single-core (non-cluster) mode remains the default with no behavior change
- [ ] All existing tests pass: `pnpm nx test platform-node && pnpm nx test core`
- [ ] Run benchmarks locally (`pnpm nx run benchmarks:bench`) before and after changes to validate measurable improvement and no regressions

## Functional Requirements

- FR-1: Middleware chain MUST be sorted at registration time, not per-request. The sorted array MUST be stored on the compiled route table or adapter state.
- FR-2: Middleware context accumulation MUST NOT allocate new objects per middleware layer. Use in-place mutation (`Object.assign` or property writes) on a single context object.
- FR-3: Request ID generation MUST NOT call `Math.random()`. Use a monotonic counter or other O(1) non-allocating approach.
- FR-4: Request normalization on Node.js MUST NOT construct a `URL` object. Use string index operations for path/query separation.
- FR-5: Body collection MUST use `content-length` hints for pre-allocation when available. JSON parsing MUST be deferred until actually needed.
- FR-6: On Bun runtime, the native server adapter MUST use `Bun.serve({ fetch })` directly, bypassing `node:http` compatibility.
- FR-7: Route lookup MUST NOT allocate an array of path segments. Use index-based string traversal.
- FR-8: Validation pipeline MUST be completely skipped for routes with no validators configured.
- FR-9: Middleware chains MUST be compiled into a single function at registration time. Zero-middleware routes MUST use an identity pass-through.
- FR-10: Hono adapter MUST use `c.req.path` and `c.req.query()` instead of constructing `new URL()`.
- FR-11: Common response headers (`content-type: application/json`, etc.) MUST be pre-computed constants, not allocated per response.
- FR-12: Fastify adapter MUST use Fastify's pre-parsed request properties instead of re-parsing URL/headers.
- FR-13: Native server MUST configure `keepAliveTimeout`, `headersTimeout`, and `maxHeadersCount` for optimal connection reuse.
- FR-14: Validator lookups MUST be consolidated into a single route-keyed hash map access instead of three separate lookups per request.
- FR-15: Error objects MUST be lazily constructed. `NODE_ENV` checks MUST be cached at startup.
- FR-16: URL path MUST be parsed exactly once and shared between normalization and route lookup.
- FR-17: Node.js cluster mode MUST be available as an opt-in feature via `createClusterServer()` or `cluster: true` app config.

## Non-Goals

- **Rust/Axum optimizations:** The Rust Axum target already matches or exceeds raw baselines. No changes needed.
- **Deno optimizations:** Deno benchmarks are not in the latest results and are lower priority than Node.js and Bun.
- **HTTP/2 or HTTP/3 support:** Protocol-level changes are a separate initiative.
- **Response caching layer:** Application-level caching is out of scope; this focuses on framework overhead.
- **Changing the benchmark methodology:** The existing Bombardier-based benchmark pipeline is well-calibrated and should not change.
- **Worker threads / `SharedArrayBuffer`:** Cluster mode via `node:cluster` is simpler and sufficient; worker thread concurrency is out of scope.
- **Changing Typia validation codegen:** Validation overhead is already <3.5% vs handwritten code. The codegen is not the bottleneck.

## Technical Considerations

### Dependencies & Breaking Changes
- **US-003 (Request ID format):** Changes from random alphanumeric to numeric counter. Any code parsing request IDs will need updates. Gate behind major version.
- **US-014 (ValidatorMap restructure):** Changes the `ValidatorMap` type in `@typokit/types`. All server adapters must be updated simultaneously. Gate behind major version.
- **US-006 (Bun-native path):** New runtime detection logic. Must gracefully fall back to `node:http` if Bun APIs are unavailable.

### Package Impact Map
| Package | Stories Affected |
|---------|-----------------|
| `@typokit/core` | US-001, US-002, US-003, US-009, US-015 |
| `@typokit/platform-node` | US-004, US-005, US-011, US-013, US-016, US-017 |
| `@typokit/platform-bun` | US-006 |
| `@typokit/server-native` | US-007, US-008, US-016 |
| `@typokit/server-fastify` | US-012 |
| `@typokit/server-hono` | US-010 |
| `@typokit/types` | US-014 |
| `@typokit/benchmarks` | US-006, US-017 (new benchmark scenarios) |

### Suggested Implementation Order
**Phase 1 — Low-hanging fruit (biggest impact, smallest risk):**
US-001 (pre-sort middleware), US-003 (fast request ID), US-008 (skip empty validators), US-011 (cached headers), US-015 (lazy errors)

**Phase 2 — Core hot path (high impact, moderate complexity):**
US-002 (context mutation), US-004 (URL avoidance), US-005 (body optimization), US-007 (route lookup), US-009 (compiled middleware), US-016 (single path parse)

**Phase 3 — Adapter-specific (targeted improvements):**
US-010 (Hono), US-012 (Fastify), US-014 (validator consolidation)

**Phase 4 — Platform-level (largest impact, highest complexity):**
US-006 (Bun-native server), US-013 (keep-alive tuning), US-017 (cluster mode)

### Performance Measurement
- All improvements MUST be validated against the existing CI benchmark pipeline (`pnpm nx run benchmarks:bench`)
- PR-level regression detection (>10% threshold) protects against regressions
- Each story should include before/after benchmark numbers in its PR description

## Success Metrics

- **Node.js JSON scenario:** Reach ≥21,000 req/s (from 17,084), matching H3 and achieving <5% overhead vs raw Node (18,115)
- **Bun JSON scenario:** Reach ≥40,000 req/s (from 22,114), achieving <10% overhead vs raw Bun (42,949)
- **Middleware overhead:** Reduce from 9-15% to <2% vs JSON baseline across all adapters
- **p99 latency (Fastify validate):** Reduce from 21.7ms to <12ms
- **Framework overhead budget:** <5% vs raw HTTP baseline on all scenarios and platforms
- **Zero increase in validation overhead:** Maintain the existing <3.5% validation cost advantage

## Open Questions

1. **Should the Bun-native server path (US-006) be a separate package (`@typokit/platform-bun-native`) or integrated into the existing `@typokit/platform-bun`?** A separate package avoids conditional imports but adds maintenance burden.
2. **For cluster mode (US-017), should sticky sessions be supported for WebSocket-heavy apps?** The `plugin-ws` package may need coordination.
3. **Should the compiled middleware chain (US-009) support dynamic middleware addition after server startup?** Current architecture allows it; compiled chains would prevent it.
4. **How should the monotonic request ID counter (US-003) handle multi-worker scenarios (cluster mode)?** Options: worker-ID prefix, shared atomic counter, or accept potential duplicates across workers.
5. **Is the <5% overhead target achievable on Bun without US-006 (Bun-native server path)?** The 48.5% gap suggests the `node:http` compatibility layer is the dominant bottleneck on Bun, making US-006 likely mandatory.
