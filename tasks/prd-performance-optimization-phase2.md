# PRD: TypoKit Performance Optimization — Phase 2

## Introduction

Phase 1 of the performance optimization effort (US-001 through US-019) delivered a massive win on the Node.js native server JSON path — **+120.7% improvement** (26,060 → 57,506 req/s), beating H3 by 18.8% and achieving 141% faster throughput than raw `node:http`. However, that improvement is isolated to a single scenario. The remaining gaps are significant:

- **Bun**: All 5 scenarios remain **48-57% behind** raw `Bun.serve()` — completely untouched by Phase 1
- **Middleware**: Overhead ranges from **6.4% (Fastify) to 55.6% (native)** vs the <2% target
- **Node DB**: Still **7% behind** raw `node:http`, exceeding the <5% target
- **Node Middleware**: **40.6% behind** raw `node:http` even with cluster mode

This PRD targets the remaining gaps through deep analysis of per-request allocations, the Bun platform adapter's request/response conversion overhead, and the middleware execution wrapper in `server-native`.

### Benchmark Environment (This Run)

- **Hardware:** AMD Ryzen AI 9 HX 370, 24 cores, 31 GB RAM (local)
- **Config:** 100 connections, 5s duration, 2s warmup, 1 run
- **Tool:** Bombardier
- **Runtimes:** Node v24.13.1, Bun (subprocess)

### Current Performance Summary (Post-Phase 1)

| Scenario | TypoKit Best (Node) | Raw Node | Gap | TypoKit Best (Bun) | Raw Bun | Gap |
|----------|-------------------|----------|-----|-------------------|---------|-----|
| JSON | 57,506 (native) | 23,814 | **+141.5%** ✅ | 22,114 (fastify) | 42,949 | -48.5% |
| Validate | 22,020 (cluster) | 22,627 | **-2.7%** ✅ | 14,747 (native) | 31,049 | -52.5% |
| DB | 10,150 (fastify) | 10,909 | -7.0% | 12,098 (fastify) | 21,378 | -43.4% |
| Middleware | 27,207 (cluster) | 45,840 | -40.6% | 18,758 (fastify) | 43,131 | -56.5% |
| Startup | 17,475 (fastify) | 17,894 | **-2.3%** ✅ | 22,469 (fastify) | 44,392 | -49.4% |

## Goals

- Close **Bun gap to <5%** vs raw `Bun.serve()` across all benchmark scenarios (JSON, validate, db, middleware, startup)
- Reduce **Node middleware overhead** from 40.6% to <5% vs raw `node:http`
- Reduce **Node DB overhead** from 7.0% to <5% vs raw `node:http`
- Reduce **middleware execution overhead** to <2% vs JSON baseline within the same adapter
- Maintain all Phase 1 wins (no regressions on node-native JSON, validate, startup)
- All improvements measurable via existing CI benchmark pipeline

## User Stories

### US-020: Bun Fast-Path — Bypass normalizeRequest/buildResponse for GET JSON

**Description:** As a framework developer, I want the Bun server path to skip the normalize→handle→buildResponse round-trip for simple GET endpoints so that Bun throughput approaches raw `Bun.serve()`.

**Background:** Currently every Bun request goes through `normalizeRequest()` (async, allocates TypoKitRequest object + Proxy headers + query parsing) then back through `buildResponse()` (allocates `new Response()` with header iteration). Raw `Bun.serve()` handles the `Request` directly and returns a `Response` inline. This two-way conversion is the primary source of the 48.5% gap.

**Acceptance Criteria:**
- [ ] `createBunServer()` in `packages/platform-bun/src/index.ts` accepts an optional "fast handler" that receives the raw `Request` and returns a `Response` directly
- [ ] `server-native` detects Bun runtime and provides a fast-path `fetch` handler that performs route lookup + handler dispatch without constructing a full TypoKitRequest for routes that have no middleware, no validators, and no body
- [ ] Fast-path handler extracts method and path from `req.url` using `indexOf()`/`substring()` (no `new URL()`)
- [ ] Fast-path handler calls the registered handler directly with a minimal request shape (method, path, params, headers reference)
- [ ] Fast-path handler returns `new Response(JSON.stringify(body), { status, headers: staticHeaders })` directly
- [ ] Falls back to the full normalizeRequest path for routes with middleware, validators, or POST/PUT/PATCH bodies
- [ ] Bun JSON benchmark scenario reaches **at least 38,000 req/s** (from 22,114)
- [ ] All existing tests pass: `pnpm nx test server-native && pnpm nx test platform-bun`
- [ ] Typecheck passes: `pnpm nx typecheck platform-bun && pnpm nx typecheck server-native`

### US-021: Bun — Replace Proxy-Based Headers with Direct Access

**Description:** As a framework developer, I want Bun request headers accessed without a `Proxy` wrapper so that header reads don't incur trap overhead on every access.

**Background:** `normalizeRequest()` in `platform-bun` wraps the native `Headers` object in a `new Proxy()` (lines 76-141). Every `headers[key]` access triggers the Proxy `get` trap → `native.has()` → `native.get()`. The `ownKeys()` trap iterates all headers to build a Set — O(N) per introspection. This adds measurable overhead per-request, especially in the middleware path where headers are accessed multiple times.

**Acceptance Criteria:**
- [ ] Replace the `Proxy`-based `normalizeHeaders()` in `packages/platform-bun/src/index.ts` with a plain object that copies headers eagerly on construction
- [ ] Use `headers.forEach((value, key) => obj[key] = value)` which is the fastest iteration method for Web API `Headers`
- [ ] For the fast-path (US-020), skip header normalization entirely and pass the native `Headers` object reference
- [ ] The `ownKeys()` behavior is preserved — `Object.keys(normalizedHeaders)` returns all header names
- [ ] Bun validate benchmark improves by at least 10% (validation accesses `content-type` header)
- [ ] All existing tests pass: `pnpm nx test platform-bun`

### US-022: Bun — Sync normalizeRequest for GET Requests

**Description:** As a framework developer, I want `normalizeRequest()` to be synchronous for GET/HEAD/DELETE requests so that the Bun hot path avoids async overhead.

**Background:** `normalizeRequest()` is currently `async` because it `await`s `req.json()` or `req.text()` for POST/PUT/PATCH bodies. However, GET/HEAD/DELETE requests have no body, so the `await` is unnecessary — it forces the JS engine to create a microtask and suspend/resume the function even when no I/O occurs.

**Acceptance Criteria:**
- [ ] Split `normalizeRequest()` in `packages/platform-bun/src/index.ts` into two paths:
  - `normalizeRequestSync(req: Request): TypoKitRequest` for methods without bodies (GET, HEAD, DELETE, OPTIONS)
  - `normalizeRequestAsync(req: Request): Promise<TypoKitRequest>` for methods with bodies (POST, PUT, PATCH)
- [ ] `createBunServer()` calls the sync variant when `req.method` is GET/HEAD/DELETE/OPTIONS
- [ ] The sync path avoids all `await` / `Promise` creation
- [ ] Bun startup and middleware benchmarks improve by at least 5%
- [ ] All existing tests pass: `pnpm nx test platform-bun`
- [ ] Typecheck passes: `pnpm nx typecheck platform-bun`

### US-023: Bun — Pre-Allocate Static Response Objects

**Description:** As a framework developer, I want common response patterns (200 JSON, 404 JSON, 500 JSON) to use pre-allocated header objects so that `buildResponse()` avoids per-request `new Headers()` construction.

**Background:** `buildResponse()` in `platform-bun` iterates `response.headers` with a `for...in` loop and calls `respHeaders.set()` per header (lines 219-226), then constructs `new Response(body, { status, headers: respHeaders })`. For JSON responses, the headers are always `{ "content-type": "application/json" }` — creating a new `Headers` object each time is wasteful.

**Acceptance Criteria:**
- [ ] Create a module-level `const JSON_RESPONSE_INIT_200 = { status: 200, headers: new Headers({ "content-type": "application/json" }) }` (and 400, 404, 500 variants) in `packages/platform-bun/src/index.ts`
- [ ] `buildResponse()` detects when response headers exactly match `JSON_HEADERS` (from `@typokit/core`) and uses the pre-allocated init object
- [ ] For non-matching headers, fall back to current per-request construction
- [ ] Bun JSON and DB benchmarks each improve by at least 3%
- [ ] All existing tests pass: `pnpm nx test platform-bun`

### US-024: Eliminate Per-Request mwReq Reconstruction in Middleware Wrapper

**Description:** As a framework developer, I want the server-native middleware wrapper to stop creating a new `TypoKitRequest` object per middleware invocation so that middleware overhead drops to near-zero.

**Background:** In `packages/server-native/src/index.ts` (lines 444-461), the middleware wrapper closure creates a fresh `mwReq: TypoKitRequest` object for every middleware call by copying properties from `currentReq` and `input`. With 5 middleware layers, this means 5 object allocations per request — purely to reshape data that already exists in the right format.

**Acceptance Criteria:**
- [ ] The middleware wrapper in `registerRoutes()` reuses the `enrichedReq` object directly instead of constructing a new `mwReq` per invocation
- [ ] Pass `enrichedReq` as a closure variable to the compiled middleware chain instead of reconstructing from `currentReq` + `input` fields
- [ ] Remove the `currentReq` module-level variable (it's a code smell — stores mutable state across requests)
- [ ] The compiled middleware chain receives the request object reference, not a copy
- [ ] Node middleware benchmark (native) overhead vs JSON drops from 55.6% to <15%
- [ ] All existing middleware tests pass: `pnpm nx test core && pnpm nx test server-native`
- [ ] Typecheck passes: `pnpm nx typecheck core && pnpm nx typecheck server-native`

### US-025: Skip Object.assign for Empty Middleware Returns

**Description:** As a framework developer, I want `compileMiddlewareChain()` to skip the `Object.assign(ctx, added)` call when middleware returns `undefined`, `null`, or `{}` so that no-op middleware has zero cost.

**Background:** In `packages/core/src/middleware.ts` (lines 179-188), the compiled N-middleware loop calls `Object.assign(ctx, added)` after every middleware — even when `added` is an empty object `{}`. The benchmark's 5 no-op middleware layers each return `{}`, causing 5 unnecessary `Object.assign` calls per request. While each call is cheap individually, under 100 concurrent connections this adds up.

**Acceptance Criteria:**
- [ ] In `compileMiddlewareChain()` (packages/core/src/middleware.ts), add a guard before `Object.assign`: skip if `added` is `undefined`, `null`, or an empty object (check via `Object.keys(added).length === 0` or a faster heuristic)
- [ ] For the single-middleware case (line 124), apply the same guard
- [ ] Middleware benchmark overhead (native) drops by at least 5% absolute
- [ ] Middleware that returns actual context values (e.g., `{ user: ... }`) continues to work correctly
- [ ] All existing tests pass: `pnpm nx test core`
- [ ] Typecheck passes: `pnpm nx typecheck core`

### US-026: Replace enrichedReq Spread with Params Mutation

**Description:** As a framework developer, I want the request params to be set via direct property assignment instead of object spread so that the handler hot path avoids creating a new object per request.

**Background:** In `packages/server-native/src/index.ts` (line 402), every request creates a new object via `const enrichedReq: TypoKitRequest = { ...req, params }`. This copies all request properties just to add/overwrite the `params` field. Since `req` is already a mutable object created by `normalizeRequest()`, we can mutate it directly.

**Acceptance Criteria:**
- [ ] Replace `const enrichedReq: TypoKitRequest = { ...req, params }` with `req.params = params` (direct mutation)
- [ ] Remove the `enrichedReq` variable — use `req` directly downstream
- [ ] Verify that `normalizeRequest()` in both `platform-node` and `platform-bun` create fresh objects per request (safe to mutate)
- [ ] Node DB benchmark (native) improves to within 5% of raw-node
- [ ] All existing tests pass: `pnpm nx test server-native`
- [ ] Typecheck passes: `pnpm nx typecheck server-native`

### US-027: Eliminate Per-Request MiddlewareInput Allocation

**Description:** As a framework developer, I want the middleware compiled chain to receive request fields as direct arguments instead of allocating a `MiddlewareInput` wrapper object per request.

**Background:** In `packages/core/src/middleware.ts` (lines 179-185), the N-middleware compiled function creates a `MiddlewareInput` object per request: `{ headers, body, query, params, ctx }`. This object is only used to pass fields to middleware handlers. By changing the compiled chain's internal signature to accept fields directly (or reusing a pooled object), we eliminate one allocation per request.

**Acceptance Criteria:**
- [ ] The compiled middleware function signature changes internally to accept `(req: TypoKitRequest, ctx: RequestContext)` directly, extracting `headers`, `body`, `query`, `params` from `req` inline
- [ ] No `MiddlewareInput` object is allocated in the hot path
- [ ] The public `MiddlewareInput` type remains exported for user-facing middleware definitions
- [ ] The middleware handler wrapper in `server-native` (lines 444-461) passes `req` directly instead of constructing `input` fields
- [ ] Node middleware benchmark overhead drops to <10% vs JSON baseline
- [ ] All existing tests pass: `pnpm nx test core && pnpm nx test server-native`

### US-028: Bun — Inline Response Construction

**Description:** As a framework developer, I want the Bun response path to construct `Response` objects with minimal allocations so that the Bun gap closes for all scenarios.

**Background:** `buildResponse()` in `platform-bun` (lines 206-237) creates a new `Headers` object, iterates response headers with `for...in`, calls `respHeaders.set()` per header, `JSON.stringify`s the body, then constructs `new Response(body, init)`. Raw `Bun.serve()` benchmarks show that `new Response(jsonString, { status: 200, headers: staticHeaders })` with a pre-allocated headers object is significantly faster.

**Acceptance Criteria:**
- [ ] `buildResponse()` detects JSON object bodies and calls `JSON.stringify()` + `new Response()` in a single expression (no intermediate variables)
- [ ] For JSON responses, use a pre-allocated `{ "content-type": "application/json" }` headers constant (avoid `new Headers()`)
- [ ] Bun uses Bun-native `Response` constructor which accepts plain objects for headers — leverage this instead of `new Headers()`
- [ ] Bun JSON benchmark reaches **at least 35,000 req/s** (from 22,114)
- [ ] All existing tests pass: `pnpm nx test platform-bun`

### US-029: Bun — Direct Bun.serve() Handler Without createBunServer Wrapper

**Description:** As a framework developer, I want `server-native` on Bun to call `Bun.serve()` directly with an inline `fetch` handler instead of going through the `createBunServer()` abstraction so that the Bun path has minimal call-stack depth.

**Background:** The current Bun path is: `server-native.listen()` → `import("@typokit/platform-bun")` → `createBunServer(handleRequest)` → `Bun.serve({ fetch(req) { normalizeRequest(req) → handleRequest(normalized) → buildResponse(response) } })`. Each layer adds function call overhead and async boundaries. Raw `Bun.serve()` just does `fetch(req) { return new Response(...) }`. The `createBunServer` wrapper exists for API symmetry with Node but isn't needed for performance.

**Acceptance Criteria:**
- [ ] `server-native` on Bun calls `Bun.serve()` directly inside its `listen()` method, constructing the `fetch` handler inline
- [ ] The inline `fetch` handler implements the fast-path from US-020 (direct route lookup → handler → Response) for simple routes
- [ ] Falls back to the full normalize→handle→buildResponse path for complex routes (middleware, validation, body parsing)
- [ ] `createBunServer()` remains exported from `platform-bun` for standalone use but is no longer used by `server-native`
- [ ] Bun startup benchmark reaches **at least 35,000 req/s** (from 22,469)
- [ ] All existing tests pass: `pnpm nx test server-native && pnpm nx test platform-bun`
- [ ] Typecheck passes: `pnpm nx typecheck server-native`

### US-030: Node — Reduce Middleware Overhead via Synchronous No-Op Detection

**Description:** As a framework developer, I want the compiled middleware chain to detect when all middleware are synchronous no-ops at registration time and replace the chain with a synchronous identity function so that the middleware benchmark on Node matches JSON throughput.

**Background:** The middleware benchmark uses 5 no-op middleware layers that each return `{}`. The compiled chain still `await`s each one sequentially, creating 5 microtask suspensions per request. If middleware are detected as no-ops (return empty objects) or are synchronous (don't use `await` internally), the entire chain can be replaced with a synchronous pass-through.

**Acceptance Criteria:**
- [ ] `compileMiddlewareChain()` in `packages/core/src/middleware.ts` accepts a hint or detects middleware that return empty objects
- [ ] When all middleware return empty objects (or are marked as no-op), the compiled chain returns `(req, ctx) => ctx` synchronously (no `Promise`, no `async`)
- [ ] When a mix of no-op and real middleware exist, only the real middleware are included in the compiled chain
- [ ] Node middleware benchmark (native) overhead vs JSON drops from 55.6% to <5%
- [ ] Middleware with actual side effects (logging, auth) continues to work correctly
- [ ] All existing tests pass: `pnpm nx test core && pnpm nx test server-native`

### US-031: Node — Optimize createRequestContext Allocation

**Description:** As a framework developer, I want `createRequestContext()` to return a reusable object or use a prototype-based approach so that the context allocation cost is minimized per request.

**Background:** Every request in `server-native` calls `createRequestContext()` (line 405) which allocates a fresh context object with `requestId`, `startTime`, and `metadata`. The `requestId` uses a counter (already optimized in Phase 1), but the object itself is still allocated fresh. For routes with no middleware that never read context, this allocation is wasted.

**Acceptance Criteria:**
- [ ] `createRequestContext()` is only called when the handler or middleware actually needs context (lazy creation)
- [ ] For routes with no middleware, context is created only if the handler signature requires it (detected at registration time)
- [ ] Context object uses `Object.create(baseContext)` with a shared prototype for common fields, only overriding per-request fields (`requestId`, `startTime`)
- [ ] Node JSON and DB benchmark scenarios show measurable improvement (at least 2%)
- [ ] All existing tests pass: `pnpm nx test server-native`

### US-032: Benchmark App — Use JSON_HEADERS Constant in All Handlers

**Description:** As a benchmark developer, I want all benchmark handler functions to use the shared `JSON_HEADERS` constant from `@typokit/core` so that benchmark results reflect real-world best practices and don't penalize TypoKit with avoidable allocations.

**Background:** The benchmark handlers in `shared-routes.ts`, `shared-routes-bun.ts`, and `shared-routes-common.ts` create inline `{ "content-type": "application/json" }` objects in every response. This allocates a new object per request. The framework provides `JSON_HEADERS` (a frozen constant) for exactly this purpose. Using it both eliminates the allocation and makes benchmarks reflect how real apps should be written.

**Acceptance Criteria:**
- [ ] All handler return values in `packages/benchmarks/src/apps/shared-routes.ts` use `JSON_HEADERS` from `@typokit/core` instead of inline `{ "content-type": "application/json" }`
- [ ] Same for `shared-routes-bun.ts` and `shared-routes-common.ts`
- [ ] Import `JSON_HEADERS` from `@typokit/core` at the top of each file
- [ ] Node DB benchmark improves to within 5% of raw-node
- [ ] All benchmark scenarios continue to pass health checks and return correct responses

## Functional Requirements

- FR-1: The Bun server path in `server-native` must implement a zero-allocation fast path for GET routes without middleware or validation
- FR-2: The Bun platform adapter must eliminate the `Proxy`-based headers wrapper in favor of eager plain-object copy
- FR-3: `normalizeRequest()` must have a synchronous code path for bodyless HTTP methods
- FR-4: `buildResponse()` must use pre-allocated headers for JSON responses
- FR-5: The middleware wrapper in `server-native` must not allocate new `TypoKitRequest` objects per middleware invocation
- FR-6: `compileMiddlewareChain()` must skip `Object.assign` for empty/undefined middleware returns
- FR-7: The request params must be set via mutation instead of object spread
- FR-8: The compiled middleware chain must pass request fields directly instead of allocating a `MiddlewareInput` wrapper
- FR-9: `server-native` on Bun must call `Bun.serve()` directly without the `createBunServer()` indirection
- FR-10: All benchmark handlers must use `JSON_HEADERS` constant instead of inline header objects
- FR-11: `createRequestContext()` must be lazily invoked only when context is needed
- FR-12: No-op middleware chains must compile to synchronous identity functions

## Non-Goals (Out of Scope)

- **HTTP/2 or HTTP/3 support**: Protocol-level changes are a separate effort
- **Response streaming**: Streaming responses are not part of the benchmark scenarios
- **Worker thread pooling**: Cluster mode (US-018/019) already covers multi-core; worker threads are a different approach
- **Deno optimization**: Deno benchmarks exist but are not targeted in this phase
- **Rewriting handlers in Rust/WASM**: The goal is JS/TS-level performance parity
- **Changing the benchmark methodology**: We optimize the framework, not the benchmarks (except US-032 which fixes a benchmark anti-pattern)
- **Database query optimization**: The DB scenario bottleneck is framework overhead, not SQLite performance
- **Express adapter optimization**: Express is inherently limited; focus is on native + Fastify + Bun

## Technical Considerations

### Implementation Order

The stories have dependencies that suggest this implementation order:

1. **Foundation** (no deps): US-025 (skip empty Object.assign), US-026 (params mutation), US-032 (benchmark headers)
2. **Middleware core** (depends on foundation): US-024 (eliminate mwReq), US-027 (eliminate MiddlewareInput), US-030 (no-op detection), US-031 (lazy context)
3. **Bun platform** (independent): US-021 (remove Proxy headers), US-022 (sync normalize), US-023 (static Response), US-028 (inline Response)
4. **Bun integration** (depends on Bun platform): US-020 (Bun fast-path), US-029 (direct Bun.serve)

### Breaking Changes

- **US-027** changes the internal signature of compiled middleware chains. This is internal to `@typokit/core` and `server-native` — not a public API break.
- **US-029** changes how `server-native` uses `platform-bun` — `createBunServer` is no longer called internally but remains exported.
- No public API changes are expected.

### Risk Areas

- **US-024/US-026 (mutation):** Mutating the request object assumes `normalizeRequest()` creates a fresh object per request. Verify this invariant in both platform adapters.
- **US-030 (no-op detection):** Must not interfere with middleware that has side effects (e.g., logging, timing) but returns empty objects. Consider using an explicit `noOp` marker rather than return-value detection.
- **US-020/US-029 (Bun fast-path):** The fast path must correctly handle all edge cases — routes with path params, query strings, routes registered after listen, etc.

### Package Impact Map

- `@typokit/core`: US-025, US-027, US-030, US-031
- `@typokit/platform-bun`: US-020, US-021, US-022, US-023, US-028
- `@typokit/server-native`: US-020, US-024, US-026, US-027, US-029, US-031
- `@typokit/benchmarks`: US-032

## Success Metrics

| Metric | Current | Target | Measurement |
|--------|---------|--------|-------------|
| Bun JSON req/s | 22,114 | ≥40,800 (within 5% of raw Bun 42,949) | CI benchmark |
| Bun Validate req/s | 14,747 | ≥29,500 (within 5% of raw Bun 31,049) | CI benchmark |
| Bun DB req/s | 12,098 | ≥20,300 (within 5% of raw Bun 21,378) | CI benchmark |
| Bun Middleware req/s | 18,758 | ≥40,970 (within 5% of raw Bun 43,131) | CI benchmark |
| Bun Startup req/s | 22,469 | ≥42,170 (within 5% of raw Bun 44,392) | CI benchmark |
| Node Middleware overhead | 55.6% (native) | <5% vs JSON baseline | CI benchmark |
| Node DB overhead | 7.0% vs raw | <5% vs raw-node | CI benchmark |
| Node JSON (no regression) | 57,506 | ≥57,000 | CI benchmark |
| Middleware overhead (Fastify) | 6.4% vs JSON | <2% vs JSON baseline | CI benchmark |
| p99 latency — Bun JSON | 7.05ms | <4ms | CI benchmark |

## Open Questions

1. **Bun.serve() headers format:** Does Bun's `Response` constructor accept a plain object `{ "content-type": "..." }` for headers, or does it require a `Headers` instance? If plain objects work, US-023 and US-028 become simpler.
2. **Middleware no-op detection (US-030):** Should we detect no-ops by return value (risky — middleware with side effects might return `{}`) or by an explicit `noOp: true` marker on the middleware definition? The marker approach is safer but requires API addition.
3. **Bun fast-path scope (US-020):** Should the fast path apply to all methods (including POST with validators) or only bodyless methods? Extending to POST would require synchronous body reading which Bun may not support.
4. **Object.assign guard overhead (US-025):** Is `Object.keys(added).length === 0` cheaper than `Object.assign(ctx, {})`? Need to microbenchmark. Alternative: check `added === undefined || added === null` first (fastest), then fall back to `Object.assign`.
