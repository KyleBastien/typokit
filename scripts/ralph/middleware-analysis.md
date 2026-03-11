# TypoKit Middleware System - Performance Analysis Report

## 1. CORE MIDDLEWARE ARCHITECTURE

### 1.1 Middleware Entry Type
Location: packages/core/src/middleware.ts (lines 23-27)

\\\	ypescript
export interface MiddlewareEntry {
  name: string;
  middleware: Middleware;
  priority?: number;
}
\\\

**Key Fields:**
- **name**: String identifier for the middleware (e.g., "auth", "logging")
- **middleware**: Middleware instance (contains a handler function)
- **priority**: Optional number for execution ordering (lower values execute first, defaults to 0)

### 1.2 Middleware Type Definition
Location: packages/core/src/middleware.ts (lines 16-20)

\\\	ypescript
export interface Middleware<
  TAdded extends Record<string, unknown> = Record<string, unknown>,
> {
  handler: (input: MiddlewareInput) => Promise<TAdded>;
}
\\\

**Key Points:**
- Generic typing: TAdded is the type of properties added to the context
- Handler is an async function that receives MiddlewareInput

### 1.3 MiddlewareInput Type
Location: packages/core/src/middleware.ts (lines 7-13)

\\\	ypescript
export interface MiddlewareInput {
  headers: TypoKitRequest["headers"];
  body: TypoKitRequest["body"];
  query: TypoKitRequest["query"];
  params: TypoKitRequest["params"];
  ctx: RequestContext;
}
\\\

---

## 2. MIDDLEWARE EXECUTION CHAIN

### 2.1 executeMiddlewareChain() Function - FULL IMPLEMENTATION
Location: packages/core/src/middleware.ts (lines 78-100)

\\\	ypescript
export async function executeMiddlewareChain(
  req: TypoKitRequest,
  ctx: RequestContext,
  entries: MiddlewareEntry[],
): Promise<RequestContext> {
  // LINE 83-85: SORT BY PRIORITY - THIS IS THE CRITICAL PERFORMANCE POINT
  const sorted = [...entries].sort(
    (a, b) => (a.priority ?? 0) - (b.priority ?? 0),
  );

  let currentCtx = ctx;
  for (const entry of sorted) {
    const added = await entry.middleware.handler({
      headers: req.headers,
      body: req.body,
      query: req.query,
      params: req.params,
      ctx: currentCtx,
    });
    currentCtx = { ...currentCtx, ...added } as RequestContext;
  }

  return currentCtx;
}
\\\

### 2.2 Key Implementation Details

**Array.sort() Call (Line 83-85):**
\\\	ypescript
const sorted = [...entries].sort(
  (a, b) => (a.priority ?? 0) - (b.priority ?? 0),
);
\\\

**Performance Notes:**
- Creates a shallow copy of entries array with spread operator \[...entries]\
- Uses numeric comparison: \(a.priority ?? 0) - (b.priority ?? 0)\
- Nullish coalescing (??): treats undefined priority as 0
- **IMPORTANT**: JavaScript's sort() is NOT stable in older implementations, but modern engines (V8, SpiderMonkey) guarantee stability
- **Complexity**: O(n log n) where n = number of middleware entries
- **Per-Request Cost**: Sort happens on EVERY request

**Middleware Execution Flow:**
1. Entries are sorted by priority (lowest first)
2. Executed sequentially (awaited one-by-one)
3. Each middleware adds properties to context via spread operator: \{ ...currentCtx, ...added }\
4. Later middleware can access properties added by earlier middleware
5. If any middleware throws, the chain short-circuits (no further middleware runs)

### 2.3 Execution Order Example (From Tests)
Test case: middleware.test.ts (lines 89-115)

`
Given priorities: A=30, B=10, C=20
Execution order: B (10) → C (20) → A (30)
`

---

## 3. MIDDLEWARE DEFINITION

### 3.1 defineMiddleware() Function
Location: packages/core/src/middleware.ts (lines 33-37)

\\\	ypescript
export function defineMiddleware<TAdded extends Record<string, unknown>>(
  handler: (input: MiddlewareInput) => Promise<TAdded>,
): Middleware<TAdded> {
  return { handler };
}
\\\

**Usage Pattern:**
\\\	ypescript
const authMiddleware = defineMiddleware(async ({ headers, ctx }) => {
  const token = headers["authorization"];
  const user = await validateToken(token);
  return { user }; // Added to context
});
\\\

**Data Structure Produced:**
A simple object with a single handler property that wraps the user function.

---

## 4. REQUEST CONTEXT CREATION

### 4.1 createRequestContext() Function
Location: packages/core/src/middleware.ts (lines 53-71)

\\\	ypescript
export function createRequestContext(
  overrides?: Partial<RequestContext>,
): RequestContext {
  return {
    log: createPlaceholderLogger(),
    fail(
      status: number,
      code: string,
      message: string,
      details?: Record<string, unknown>,
    ): never {
      throw createAppError(status, code, message, details);
    },
    services: {},
    requestId:
      Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2),
    ...overrides,
  };
}
\\\

**Generated RequestId:**
- Uses Math.random() twice to generate a pseudo-random string
- Not cryptographically secure, suitable for tracing

---

## 5. MIDDLEWARE REGISTRATION FLOW

### 5.1 Application Setup - createApp()
Location: packages/core/src/app.ts (lines 60-118)

The createApp() function accepts middleware in CreateAppOptions:

\\\	ypescript
export interface CreateAppOptions {
  server: ServerAdapter;
  middleware?: MiddlewareEntry[];  // GLOBAL MIDDLEWARE
  routes: RouteGroup[];
  plugins?: TypoKitPlugin[];
  logging?: Partial<Logger>;
  telemetry?: Record<string, unknown>;
}
\\\

**Current Implementation (app.ts):**
- Creates app instance
- Accepts but does NOT actively use the middleware option in the shown code
- Middleware passing is delegated to the server adapter

### 5.2 Middleware Flow in Server Adapters

Location: packages/core/src/adapters/server.ts (lines 22-28)

\\\	ypescript
export interface ServerAdapter {
  name: string;
  
  registerRoutes(
    routeTable: CompiledRouteTable,
    handlerMap: HandlerMap,
    middlewareChain: MiddlewareChain,  // MIDDLEWARE PASSED HERE
    validatorMap?: ValidatorMap,
    serializerMap?: SerializerMap,
  ): void;
  
  // ... other methods
}
\\\

**Key Point:** Middleware is passed as a **MiddlewareChain**, NOT MiddlewareEntry[]

### 5.3 MiddlewareChain Type (From types)
Location: packages/types/src/index.ts (lines 147-150)

\\\	ypescript
export interface MiddlewareChain {
  /** Named middleware entries in execution order */
  entries: Array<{ name: string; handler: MiddlewareFn }>;
}
\\\

**Important Difference:**
- Core uses \Middleware\ type with generic typing
- Types package uses \MiddlewareFn\ which has a different signature

---

## 6. SERVER ADAPTER IMPLEMENTATION

### 6.1 Native Server Adapter - Request Handling
Location: packages/server-native/src/index.ts (lines 272-397)

**Key Section: Middleware Execution in handleRequest()** (lines 361-386)

\\\	ypescript
// Create request context
let ctx = createRequestContext();

// Execute middleware chain if present
if (state.middlewareChain && state.middlewareChain.entries.length > 0) {
  const entries: MiddlewareEntry[] = state.middlewareChain.entries.map(
    (e) => ({
      name: e.name,
      middleware: {
        handler: async (input) => {
          const mwReq: TypoKitRequest = {
            method: enrichedReq.method,
            path: enrichedReq.path,
            headers: input.headers,
            body: input.body,
            query: input.query,
            params: input.params,
          };
          const response = await e.handler(mwReq, input.ctx, async () => {
            return { status: 200, headers: {}, body: null };
          });
          return response as unknown as Record<string, unknown>;
        },
      },
    }),
  );

  ctx = await executeMiddlewareChain(enrichedReq, ctx, entries);
}

// Call the handler
const response = await handlerFn(enrichedReq, ctx);
\\\

**Important Flow:**
1. MiddlewareChain entries are transformed to MiddlewareEntry objects
2. executeMiddlewareChain() is called with transformed entries
3. Result context is passed to the handler

---

## 7. MIDDLEWARE TESTS - COMPREHENSIVE COVERAGE

Location: packages/core/src/middleware.test.ts

### 7.1 Priority Ordering Test (Lines 89-115)
Confirms that lower priority values execute first:
- A (priority 30) → Last
- B (priority 10) → First  
- C (priority 20) → Second

### 7.2 Default Priority Behavior (Lines 117-138)
- Middleware without priority is treated as priority 0
- Multiple middleware with priority 0 maintain insertion order (stable sort)

### 7.3 Error Short-Circuit Test (Lines 140-177)
When middleware throws:
- Chain immediately stops
- Remaining middleware NOT executed
- Exception propagates

### 7.4 Context Accumulation (Lines 62-87)
- Middleware 1 adds { step1: true }
- Middleware 2 can access ctx.step1
- Final context has both step1 and step2

---

## 8. PERFORMANCE OPTIMIZATION OPPORTUNITIES

### 8.1 Array.sort() Per Request
**Current Issue:**
- Line 83-85 in middleware.ts sorts on EVERY request
- Cost: O(n log n) where n = middleware count

**Optimization Strategies:**
1. **Pre-sort at Registration:** Sort middleware once during app initialization, cache sorted order
2. **Lazy Sort:** If middleware rarely changes order, sort once and reuse
3. **Topological Sort:** If middleware has explicit dependencies, build DAG instead of numeric priorities

### 8.2 Shallow Copy on Every Request
**Current Issue:**
- Line 83: \const sorted = [...entries]\ creates new array per request
- Line 96: \currentCtx = { ...currentCtx, ...added }\ spreads context on each middleware

**Optimization Strategies:**
1. **Pre-sorted Array:** Cache sorted entries, no need to copy
2. **Context Builder Pattern:** Instead of spreads, use Object.assign or Map for context accumulation
3. **Immutable Context:** Consider using Proxy or frozen objects if context is read-heavy

### 8.3 Async Sequential Execution
**Current Implementation:**
- Line 88-97: Sequential awaits, no parallelization
- Slower than possible for independent middleware

**Limitation:** Middleware can depend on earlier middleware's context additions, so parallelization must respect dependencies

---

## 9. ROUTE/HANDLER REGISTRATION FLOW

### 9.1 RouteGroup Structure
Location: packages/core/src/app.ts (lines 18-22)

\\\	ypescript
export interface RouteGroup {
  prefix: string;
  handlers: Record<string, unknown>;
  middleware?: MiddlewareEntry[];  // Per-route middleware
}
\\\

**Important:** Routes can have their own middleware, separate from global middleware

### 9.2 Handler Definition
Location: packages/core/src/handler.ts (exported from app.ts)

Handlers receive:
- \eq: TypoKitRequest\ (with extracted params from route)
- \ctx: RequestContext\ (enriched with middleware context)

Return:
- \TypoKitResponse\ (status, headers, body)

---

## 10. REQUEST PIPELINE SUMMARY

`
Incoming Request
  ↓
[Server Adapter normalizes to TypoKitRequest]
  ↓
[Route Lookup via radix tree]
  ↓
[Validation (params, query, body)]
  ↓
[Create RequestContext]
  ↓
[Execute Middleware Chain]
  ├─ Sort by priority
  ├─ Execute sequentially
  └─ Accumulate context
  ↓
[Call Handler with enriched context]
  ↓
[Serialize Response]
  ↓
[Write Response via adapter]
`

---

## 11. KEY FINDINGS FOR OPTIMIZATION

1. **Sort Happens Per-Request:** The critical performance bottleneck is line 83-85 of middleware.ts
2. **Priority System:** Uses simple numeric comparison, stable sort
3. **Sequential Execution:** Middleware must run in order due to context dependency model
4. **Context Accumulation:** Uses spread operator, creates new object on each middleware
5. **Shallow Copy:** Always creates copy of middleware entries array (inefficient with many middleware)

---

## FILES INVOLVED

- \packages/core/src/middleware.ts\ - Core middleware system
- \packages/core/src/app.ts\ - Application factory
- \packages/core/src/adapters/server.ts\ - ServerAdapter interface
- \packages/server-native/src/index.ts\ - Native server implementation
- \packages/types/src/index.ts\ - Type definitions
- \packages/core/src/middleware.test.ts\ - Comprehensive tests

Generated: "@ (Get-Date -Format 'o')"
