// @typokit/plugin-debug — Debug Sidecar Server
//
// A plugin that runs a read-only debug HTTP server on a separate port,
// exposing structured introspection endpoints for AI agents and dev tools.

import type { TypoKitPlugin, AppInstance } from "@typokit/core";
import type {
  CompiledRoute,
  CompiledRouteTable,
  HttpMethod,
  SchemaChange,
  ServerHandle,
  TypoKitRequest,
  TypoKitResponse,
} from "@typokit/types";
import type { AppError } from "@typokit/errors";
import type { RequestContext } from "@typokit/types";
import type {
  HistogramDataPoint,
  LogEntry,
  SpanData,
} from "@typokit/otel";
import { redactFields } from "@typokit/otel";
import { createServer } from "@typokit/platform-node";

// ─── Types ───────────────────────────────────────────────────

/** Security configuration for production mode */
export interface DebugSecurityConfig {
  /** API key required via X-Debug-Key header */
  apiKey?: string;
  /** IP/CIDR allowlist (e.g., ["127.0.0.1", "10.0.0.0/8"]) */
  allowlist?: string[];
  /** Hostname to bind to (default: "127.0.0.1" in production) */
  hostname?: string;
  /** Field paths to redact from responses (e.g., ["*.password", "authorization"]) */
  redact?: string[];
  /** Rate limit: max requests per window */
  rateLimit?: number;
  /** Rate limit window in milliseconds (default: 60000) */
  rateLimitWindow?: number;
}

/** Options for the debugPlugin factory */
export interface DebugPluginOptions {
  /** Port for the debug sidecar (default: 9800) */
  port?: number;
  /** Enable in production mode (default: false — only auto-enabled in dev) */
  production?: boolean;
  /** Security config (required in production mode) */
  security?: DebugSecurityConfig;
}

// ─── Internal State ──────────────────────────────────────────

interface RouteInfo {
  method: HttpMethod;
  path: string;
  ref: string;
  middleware: string[];
  validators?: { params?: string; query?: string; body?: string };
  serializer?: string;
}

interface ErrorRecord {
  timestamp: string;
  code: string;
  status: number;
  message: string;
  details?: Record<string, unknown>;
  route?: string;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// ─── Route Table Traversal ───────────────────────────────────

function collectRoutes(
  node: CompiledRoute,
  pathPrefix: string,
): RouteInfo[] {
  const routes: RouteInfo[] = [];
  const currentPath = pathPrefix + (node.segment ? `/${node.segment}` : "");

  if (node.handlers) {
    for (const [method, handler] of Object.entries(node.handlers)) {
      if (handler) {
        routes.push({
          method: method as HttpMethod,
          path: currentPath || "/",
          ref: handler.ref,
          middleware: handler.middleware,
          ...(handler.validators ? { validators: handler.validators } : {}),
          ...(handler.serializer ? { serializer: handler.serializer } : {}),
        });
      }
    }
  }

  if (node.children) {
    for (const child of Object.values(node.children)) {
      routes.push(...collectRoutes(child, currentPath));
    }
  }

  if (node.paramChild) {
    const paramPath = `${currentPath}/:${node.paramChild.paramName}`;
    routes.push(...collectRoutes(node.paramChild, paramPath.replace(`/${node.paramChild.segment}`, "")));
  }

  if (node.wildcardChild) {
    const wcPath = `${currentPath}/*${node.wildcardChild.paramName}`;
    routes.push(...collectRoutes(node.wildcardChild, wcPath.replace(`/${node.wildcardChild.segment}`, "")));
  }

  return routes;
}

// ─── CIDR Check ──────────────────────────────────────────────

function ipToLong(ip: string): number {
  const parts = ip.split(".").map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isIpAllowed(clientIp: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;
  const clientLong = ipToLong(clientIp);

  for (const entry of allowlist) {
    if (entry.includes("/")) {
      const [network, bits] = entry.split("/");
      const mask = (~0 << (32 - Number(bits))) >>> 0;
      if ((clientLong & mask) === (ipToLong(network) & mask)) return true;
    } else {
      if (clientIp === entry) return true;
    }
  }
  return false;
}

// ─── Percentile Calculation ──────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// ─── Debug Plugin Factory ────────────────────────────────────

/**
 * Create a debug sidecar plugin that exposes introspection endpoints
 * on a separate port.
 *
 * Development mode (default): no auth required, binds to 0.0.0.0.
 * Production mode (opt-in): requires apiKey, supports IP allowlist,
 * binds to 127.0.0.1 by default.
 */
export function debugPlugin(options: DebugPluginOptions = {}): TypoKitPlugin {
  const port = options.port ?? 9800;
  const isProduction = options.production ?? false;
  const security = options.security ?? {};
  const redactPatterns = security.redact ?? [];
  const rateLimit = security.rateLimit ?? 0;
  const rateLimitWindow = security.rateLimitWindow ?? 60_000;

  // Internal state
  let cachedRoutes: RouteInfo[] = [];
  let middlewareNames: string[] = [];
  const recentErrors: ErrorRecord[] = [];
  const recentTraces: SpanData[][] = [];
  const recentLogs: LogEntry[] = [];
  const performanceData: HistogramDataPoint[] = [];
  let serverHandle: ServerHandle | null = null;
  let dependencies: Record<string, string[]> = {};

  // Rate limiting state
  const rateLimitMap = new Map<string, RateLimitEntry>();

  function checkRateLimit(clientIp: string): boolean {
    if (rateLimit <= 0) return true;
    const now = Date.now();
    const entry = rateLimitMap.get(clientIp);
    if (!entry || now >= entry.resetAt) {
      rateLimitMap.set(clientIp, { count: 1, resetAt: now + rateLimitWindow });
      return true;
    }
    entry.count++;
    return entry.count <= rateLimit;
  }

  function getClientIp(req: TypoKitRequest): string {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
    return "127.0.0.1";
  }

  // Security middleware
  function checkSecurity(req: TypoKitRequest): TypoKitResponse | null {
    if (!isProduction) return null;

    // API key check
    if (security.apiKey) {
      const key = req.headers["x-debug-key"];
      if (key !== security.apiKey) {
        return {
          status: 401,
          headers: { "content-type": "application/json" },
          body: { error: { code: "UNAUTHORIZED", message: "Invalid or missing X-Debug-Key header" } },
        };
      }
    }

    // IP allowlist check
    if (security.allowlist && security.allowlist.length > 0) {
      const clientIp = getClientIp(req);
      if (!isIpAllowed(clientIp, security.allowlist)) {
        return {
          status: 403,
          headers: { "content-type": "application/json" },
          body: { error: { code: "FORBIDDEN", message: "IP not allowed" } },
        };
      }
    }

    // Rate limiting
    if (rateLimit > 0) {
      const clientIp = getClientIp(req);
      if (!checkRateLimit(clientIp)) {
        return {
          status: 429,
          headers: { "content-type": "application/json" },
          body: { error: { code: "RATE_LIMITED", message: "Too many requests" } },
        };
      }
    }

    return null;
  }

  function maybeRedact(data: Record<string, unknown>): Record<string, unknown> {
    if (redactPatterns.length === 0) return data;
    return redactFields(data, redactPatterns);
  }

  function parseDuration(value: string | string[] | undefined): number {
    if (!value || Array.isArray(value)) return 300_000; // default 5 min
    const match = value.match(/^(\d+)(ms|s|m|h)?$/);
    if (!match) return 300_000;
    const num = Number(match[1]);
    switch (match[2]) {
      case "ms": return num;
      case "s": return num * 1000;
      case "m": return num * 60_000;
      case "h": return num * 3_600_000;
      default: return num * 1000; // default to seconds
    }
  }

  // Endpoint handlers
  const endpoints: Record<string, (req: TypoKitRequest) => unknown> = {
    "/_debug/routes": () => {
      return { routes: cachedRoutes };
    },

    "/_debug/middleware": () => {
      return { middleware: middlewareNames };
    },

    "/_debug/performance": (req) => {
      const windowMs = parseDuration(req.query["window"] as string | undefined);
      const cutoff = new Date(Date.now() - windowMs).toISOString();
      const relevant = performanceData.filter((d) => d.timestamp >= cutoff);
      const durations = relevant.map((d) => d.value).sort((a, b) => a - b);

      return {
        window: `${windowMs}ms`,
        count: durations.length,
        p50: percentile(durations, 50),
        p95: percentile(durations, 95),
        p99: percentile(durations, 99),
        min: durations.length > 0 ? durations[0] : 0,
        max: durations.length > 0 ? durations[durations.length - 1] : 0,
      };
    },

    "/_debug/errors": (req) => {
      const sinceMs = parseDuration(req.query["since"] as string | undefined);
      const cutoff = new Date(Date.now() - sinceMs).toISOString();
      const filtered = recentErrors.filter((e) => e.timestamp >= cutoff);

      return {
        errors: filtered.map((e) =>
          redactPatterns.length > 0
            ? { ...e, ...(e.details ? { details: maybeRedact(e.details) } : {}) }
            : e,
        ),
      };
    },

    "/_debug/health": () => {
      const proc = (globalThis as unknown as { process?: { memoryUsage?: () => { heapUsed: number; heapTotal: number; rss: number } } }).process;
      const mem = proc?.memoryUsage?.();

      return {
        status: "ok",
        uptime: Date.now(),
        memory: mem
          ? { heapUsed: mem.heapUsed, heapTotal: mem.heapTotal, rss: mem.rss }
          : null,
      };
    },

    "/_debug/dependencies": () => {
      return { dependencies };
    },

    "/_debug/traces": () => {
      return {
        traces: recentTraces.slice(-100).map((spans) =>
          spans.map((s) =>
            redactPatterns.length > 0
              ? { ...s, attributes: maybeRedact(s.attributes as unknown as Record<string, unknown>) as unknown as Record<string, string | number | boolean> }
              : s,
          ),
        ),
      };
    },

    "/_debug/logs": (req) => {
      const sinceMs = parseDuration(req.query["since"] as string | undefined);
      const cutoff = new Date(Date.now() - sinceMs).toISOString();
      const filtered = recentLogs.filter((l) => l.timestamp >= cutoff);

      return {
        logs: filtered.map((l) =>
          redactPatterns.length > 0 && l.data
            ? { ...l, data: maybeRedact(l.data) }
            : l,
        ),
      };
    },
  };

  async function handleRequest(req: TypoKitRequest): Promise<TypoKitResponse> {
    // Only GET requests allowed (read-only)
    if (req.method !== "GET") {
      return {
        status: 405,
        headers: { "content-type": "application/json", allow: "GET" },
        body: { error: { code: "METHOD_NOT_ALLOWED", message: "Debug endpoints are read-only" } },
      };
    }

    // Security check
    const secError = checkSecurity(req);
    if (secError) return secError;

    const handler = endpoints[req.path];
    if (!handler) {
      return {
        status: 404,
        headers: { "content-type": "application/json" },
        body: { error: { code: "NOT_FOUND", message: `Unknown debug endpoint: ${req.path}` } },
      };
    }

    const body = handler(req);
    return {
      status: 200,
      headers: { "content-type": "application/json" },
      body,
    };
  }

  const plugin: TypoKitPlugin = {
    name: "plugin-debug",

    async onStart(app: AppInstance): Promise<void> {
      // Collect middleware names from plugins
      middlewareNames = app.plugins
        .filter((p) => p.name !== "plugin-debug")
        .map((p) => p.name);

      // Build dependency graph from services
      dependencies = {};
      for (const [key, value] of Object.entries(app.services)) {
        if (typeof value === "object" && value !== null && "dependencies" in value) {
          dependencies[key] = (value as { dependencies: string[] }).dependencies;
        }
      }

      // Expose data collection APIs via services
      app.services["_debug"] = {
        recordError: (error: AppError, route?: string) => {
          recentErrors.push({
            timestamp: new Date().toISOString(),
            code: error.code,
            status: error.status,
            message: error.message,
            details: error.details,
            route,
          });
          // Keep at most 1000 errors
          if (recentErrors.length > 1000) recentErrors.splice(0, recentErrors.length - 1000);
        },
        recordTrace: (spans: SpanData[]) => {
          recentTraces.push(spans);
          if (recentTraces.length > 500) recentTraces.splice(0, recentTraces.length - 500);
        },
        recordLog: (entry: LogEntry) => {
          recentLogs.push(entry);
          if (recentLogs.length > 2000) recentLogs.splice(0, recentLogs.length - 2000);
        },
        recordPerformance: (dataPoint: HistogramDataPoint) => {
          performanceData.push(dataPoint);
          if (performanceData.length > 5000) performanceData.splice(0, performanceData.length - 5000);
        },
        setRouteTable: (routeTable: CompiledRouteTable) => {
          cachedRoutes = collectRoutes(routeTable, "");
        },
        setMiddleware: (names: string[]) => {
          middlewareNames = names;
        },
      };
    },

    async onReady(_app: AppInstance): Promise<void> {
      const hostname = isProduction
        ? (security.hostname ?? "127.0.0.1")
        : "0.0.0.0";

      const srv = createServer(handleRequest, { hostname });
      serverHandle = await srv.listen(port);
    },

    onError(error: AppError, ctx: RequestContext): void {
      recentErrors.push({
        timestamp: new Date().toISOString(),
        code: error.code,
        status: error.status,
        message: error.message,
        details: error.details,
        route: ctx.requestId,
      });
      if (recentErrors.length > 1000) recentErrors.splice(0, recentErrors.length - 1000);
    },

    async onStop(_app: AppInstance): Promise<void> {
      if (serverHandle) {
        await serverHandle.close();
        serverHandle = null;
      }
    },

    onSchemaChange(_changes: SchemaChange[]): void {
      // Route map will be refreshed by the next build cycle calling setRouteTable
      // Clear cached routes so they'll be re-populated
      cachedRoutes = [];
    },
  };

  return plugin;
}

