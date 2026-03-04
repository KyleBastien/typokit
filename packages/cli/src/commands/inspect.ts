// @typokit/cli — Inspect Commands
// Subcommands for querying framework internal state as structured JSON

import type { CliLogger } from "../logger.js";
import type { TypoKitConfig } from "../config.js";

// ─── Types ───────────────────────────────────────────────────

export interface InspectOptions {
  rootDir: string;
  config: Required<TypoKitConfig>;
  logger: CliLogger;
  subcommand: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

export interface InspectResult {
  success: boolean;
  data: unknown;
  error?: string;
}

interface RouteInfo {
  method: string;
  path: string;
  params?: string[];
  query?: Record<string, string>;
  body?: string;
  response?: string;
  middleware?: string[];
  handler?: string;
}

interface MiddlewareInfo {
  name: string;
  priority: number;
  type: string;
}

interface DependencyNode {
  name: string;
  dependsOn: string[];
}

interface SchemaInfo {
  name: string;
  properties: Record<string, { type: string; optional?: boolean; tags?: Record<string, string> }>;
  usedIn: string[];
}

interface BuildHookInfo {
  name: string;
  order: number;
  description: string;
}

interface ServerInfo {
  adapter: string;
  platform: string;
  status: string;
  port?: number;
  host?: string;
}

interface ErrorEntry {
  timestamp: string;
  traceId: string;
  code: string;
  message: string;
  route?: string;
  phase?: string;
}

interface PerformanceInfo {
  route: string;
  p50: number;
  p95: number;
  p99: number;
  count: number;
  avgMs: number;
}

// ─── Output Formatting ──────────────────────────────────────

function isJsonOutput(flags: Record<string, string | boolean>): boolean {
  return flags["json"] === true || flags["format"] === "json";
}

function writeOutput(
  data: unknown,
  json: boolean,
  logger: CliLogger,
): void {
  const g = globalThis as Record<string, unknown>;
  const proc = g["process"] as { stdout: { write(s: string): void } } | undefined;
  const stdout = proc?.stdout ?? { write: () => {} };

  if (json) {
    stdout.write(JSON.stringify(data, null, 2) + "\n");
  } else {
    formatHumanReadable(data, logger);
  }
}

function formatHumanReadable(data: unknown, logger: CliLogger): void {
  if (Array.isArray(data)) {
    for (const item of data) {
      if (typeof item === "object" && item !== null) {
        const obj = item as Record<string, unknown>;
        if ("method" in obj && "path" in obj) {
          // Route info
          logger.info(`  ${String(obj["method"])} ${String(obj["path"])}`);
          if (obj["params"]) logger.info(`    params: ${JSON.stringify(obj["params"])}`);
          if (obj["handler"]) logger.info(`    handler: ${String(obj["handler"])}`);
        } else if ("name" in obj && "priority" in obj) {
          // Middleware info
          logger.info(`  [${String(obj["priority"])}] ${String(obj["name"])} (${String(obj["type"])})`);
        } else if ("name" in obj && "dependsOn" in obj) {
          // Dependency node
          const deps = obj["dependsOn"] as string[];
          logger.info(`  ${String(obj["name"])} → ${deps.length > 0 ? deps.join(", ") : "(none)"}`);
        } else if ("name" in obj && "order" in obj) {
          // Build hook
          logger.info(`  ${String(obj["order"])}. ${String(obj["name"])}: ${String(obj["description"])}`);
        } else if ("timestamp" in obj && "code" in obj) {
          // Error entry
          logger.info(`  [${String(obj["timestamp"])}] ${String(obj["code"])}: ${String(obj["message"])}`);
          if (obj["route"]) logger.info(`    route: ${String(obj["route"])}`);
        } else {
          logger.info(`  ${JSON.stringify(obj)}`);
        }
      } else {
        logger.info(`  ${String(item)}`);
      }
    }
  } else if (typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === "object" && value !== null) {
        logger.info(`${key}:`);
        formatHumanReadable(value, logger);
      } else {
        logger.info(`  ${key}: ${String(value)}`);
      }
    }
  } else {
    logger.info(String(data));
  }
}

// ─── Subcommand Implementations ─────────────────────────────

async function readGeneratedFile(rootDir: string, config: Required<TypoKitConfig>, relativePath: string): Promise<string | null> {
  const { join } = await import(/* @vite-ignore */ "path") as {
    join: (...args: string[]) => string;
  };
  const { existsSync, readFileSync } = await import(/* @vite-ignore */ "fs") as {
    existsSync: (p: string) => boolean;
    readFileSync: (p: string, encoding: string) => string;
  };

  const filePath = join(rootDir, config.outputDir, relativePath);
  if (!existsSync(filePath)) {
    return null;
  }
  return readFileSync(filePath, "utf-8");
}

/** Parse route entries from compiled router TypeScript output */
function parseRoutesFromCompiled(content: string): RouteInfo[] {
  const routes: RouteInfo[] = [];
  // The compiled router contains route definitions as a radix tree structure
  // Parse the route entries from comment blocks or structured data
  const routePattern = /\/\/ Route: (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) ([^\n]+)/g;
  let match: RegExpExecArray | null;
  while ((match = routePattern.exec(content)) !== null) {
    routes.push({
      method: match[1],
      path: match[2].trim(),
    });
  }

  // Also try to extract from the TypeScript type annotations
  // Pattern: "METHOD /path" in route table keys
  const keyPattern = /"(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) (\/[^"]+)"/g;
  while ((match = keyPattern.exec(content)) !== null) {
    const method = match[1];
    const path = match[2];
    // Avoid duplicates
    if (!routes.some(r => r.method === method && r.path === path)) {
      const params: string[] = [];
      const paramPattern = /:(\w+)/g;
      let paramMatch: RegExpExecArray | null;
      while ((paramMatch = paramPattern.exec(path)) !== null) {
        params.push(paramMatch[1]);
      }
      routes.push({
        method,
        path,
        params: params.length > 0 ? params : undefined,
      });
    }
  }

  return routes;
}

/** Parse schema types from OpenAPI or type metadata files */
function parseSchemaFromOpenApi(content: string, typeName?: string): SchemaInfo[] {
  try {
    const spec = JSON.parse(content) as {
      components?: {
        schemas?: Record<string, {
          type?: string;
          properties?: Record<string, { type?: string; format?: string }>;
          required?: string[];
        }>;
      };
      paths?: Record<string, Record<string, { parameters?: Array<{ schema?: { $ref?: string } }>; requestBody?: { content?: Record<string, { schema?: { $ref?: string } }> }; responses?: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }> }>>;
    };

    const schemas: SchemaInfo[] = [];
    const componentSchemas = spec.components?.schemas ?? {};

    for (const [name, schema] of Object.entries(componentSchemas)) {
      if (typeName && name !== typeName) continue;

      const properties: SchemaInfo["properties"] = {};
      const required = schema.required ?? [];

      if (schema.properties) {
        for (const [propName, propDef] of Object.entries(schema.properties)) {
          properties[propName] = {
            type: propDef.type ?? "unknown",
            optional: !required.includes(propName) ? true : undefined,
          };
        }
      }

      // Find where this type is used in paths
      const usedIn: string[] = [];
      if (spec.paths) {
        for (const [pathKey, methods] of Object.entries(spec.paths)) {
          for (const [method, operation] of Object.entries(methods)) {
            const refPattern = `#/components/schemas/${name}`;
            const opStr = JSON.stringify(operation);
            if (opStr.includes(refPattern)) {
              usedIn.push(`${method.toUpperCase()} ${pathKey}`);
            }
          }
        }
      }

      schemas.push({ name, properties, usedIn });
    }

    return schemas;
  } catch {
    return [];
  }
}

export async function inspectRoutes(rootDir: string, config: Required<TypoKitConfig>): Promise<InspectResult> {
  const content = await readGeneratedFile(rootDir, config, "routes/compiled-router.ts");
  if (!content) {
    return {
      success: false,
      data: [],
      error: "No compiled routes found. Run 'typokit build' first.",
    };
  }

  const routes = parseRoutesFromCompiled(content);

  // Also try to enrich from OpenAPI spec
  const openApiContent = await readGeneratedFile(rootDir, config, "schemas/openapi.json");
  if (openApiContent) {
    try {
      const spec = JSON.parse(openApiContent) as {
        paths?: Record<string, Record<string, {
          summary?: string;
          parameters?: Array<{ name: string; in: string; schema?: { type?: string } }>;
          requestBody?: { content?: Record<string, { schema?: { $ref?: string; type?: string } }> };
          responses?: Record<string, { description?: string; content?: Record<string, { schema?: { $ref?: string; type?: string } }> }>;
        }>>;
      };

      if (spec.paths) {
        for (const route of routes) {
          const pathEntry = spec.paths[route.path];
          if (!pathEntry) continue;
          const methodEntry = pathEntry[route.method.toLowerCase()];
          if (!methodEntry) continue;

          // Extract query params
          if (methodEntry.parameters) {
            const queryParams: Record<string, string> = {};
            for (const param of methodEntry.parameters) {
              if (param.in === "query") {
                queryParams[param.name] = param.schema?.type ?? "string";
              }
            }
            if (Object.keys(queryParams).length > 0) {
              route.query = queryParams;
            }
          }

          // Extract body ref
          const bodyContent = methodEntry.requestBody?.content;
          if (bodyContent) {
            const jsonBody = bodyContent["application/json"];
            if (jsonBody?.schema) {
              route.body = jsonBody.schema["$ref"]?.replace("#/components/schemas/", "") ?? jsonBody.schema.type;
            }
          }

          // Extract response ref
          const resp200 = methodEntry.responses?.["200"];
          if (resp200?.content) {
            const jsonResp = resp200.content["application/json"];
            if (jsonResp?.schema) {
              route.response = jsonResp.schema["$ref"]?.replace("#/components/schemas/", "") ?? jsonResp.schema.type;
            }
          }
        }
      }
    } catch {
      // OpenAPI enrichment failed, continue with basic routes
    }
  }

  return { success: true, data: routes };
}

export async function inspectRoute(rootDir: string, config: Required<TypoKitConfig>, routeKey: string): Promise<InspectResult> {
  const result = await inspectRoutes(rootDir, config);
  if (!result.success) return result;

  const routes = result.data as RouteInfo[];
  // Match "GET /users/:id" format
  const parts = routeKey.split(" ", 2);
  const method = parts[0]?.toUpperCase() ?? "";
  const path = parts[1] ?? "";

  const found = routes.find(r => r.method === method && r.path === path);
  if (!found) {
    return {
      success: false,
      data: null,
      error: `Route not found: ${routeKey}`,
    };
  }

  return { success: true, data: found };
}

export async function inspectMiddleware(rootDir: string, config: Required<TypoKitConfig>): Promise<InspectResult> {
  // Middleware info is not persisted to disk during build.
  // Return what we can infer from the build output or provide empty result.
  const content = await readGeneratedFile(rootDir, config, "routes/compiled-router.ts");
  const middleware: MiddlewareInfo[] = [];

  if (content) {
    // Check for middleware references in compiled output
    const mwPattern = /middleware:\s*\[([^\]]*)\]/g;
    let match: RegExpExecArray | null;
    let order = 0;
    while ((match = mwPattern.exec(content)) !== null) {
      const refs = match[1].split(",").map(s => s.trim().replace(/['"]/g, "")).filter(Boolean);
      for (const ref of refs) {
        if (!middleware.some(m => m.name === ref)) {
          middleware.push({
            name: ref,
            priority: order++,
            type: "registered",
          });
        }
      }
    }
  }

  // Always include the built-in error middleware
  middleware.push({
    name: "errorMiddleware",
    priority: middleware.length,
    type: "built-in",
  });

  return { success: true, data: middleware };
}

export async function inspectDependencies(rootDir: string, _config: Required<TypoKitConfig>): Promise<InspectResult> {
  const { join } = await import(/* @vite-ignore */ "path") as {
    join: (...args: string[]) => string;
  };
  const { existsSync, readFileSync } = await import(/* @vite-ignore */ "fs") as {
    existsSync: (p: string) => boolean;
    readFileSync: (p: string, encoding: string) => string;
  };

  // Build dependency graph from package.json files in the project
  const nodes: DependencyNode[] = [];
  const pkgPath = join(rootDir, "package.json");

  if (existsSync(pkgPath)) {
    try {
      const pkgContent = readFileSync(pkgPath, "utf-8");
      const pkg = JSON.parse(pkgContent) as {
        name?: string;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };

      const deps = Object.keys(pkg.dependencies ?? {}).filter(d => d.startsWith("@typokit/"));
      nodes.push({
        name: pkg.name ?? "root",
        dependsOn: deps,
      });
    } catch {
      // Skip unparseable
    }
  }

  // Also check for workspace packages if we're in a monorepo
  const packagesDir = join(rootDir, "packages");
  const { readdirSync } = await import(/* @vite-ignore */ "fs") as {
    readdirSync: (p: string) => string[];
  };

  if (existsSync(packagesDir)) {
    try {
      const packages = readdirSync(packagesDir);
      for (const pkg of packages) {
        const subPkgPath = join(packagesDir, pkg, "package.json");
        if (existsSync(subPkgPath)) {
          try {
            const content = readFileSync(subPkgPath, "utf-8");
            const subPkg = JSON.parse(content) as {
              name?: string;
              dependencies?: Record<string, string>;
            };
            const deps = Object.keys(subPkg.dependencies ?? {}).filter(d => d.startsWith("@typokit/"));
            nodes.push({
              name: subPkg.name ?? `@typokit/${pkg}`,
              dependsOn: deps,
            });
          } catch {
            // Skip
          }
        }
      }
    } catch {
      // Not a monorepo root
    }
  }

  return { success: true, data: nodes };
}

export async function inspectSchema(rootDir: string, config: Required<TypoKitConfig>, typeName: string): Promise<InspectResult> {
  const openApiContent = await readGeneratedFile(rootDir, config, "schemas/openapi.json");
  if (!openApiContent) {
    return {
      success: false,
      data: null,
      error: "No OpenAPI spec found. Run 'typokit build' first.",
    };
  }

  const schemas = parseSchemaFromOpenApi(openApiContent, typeName);
  if (schemas.length === 0) {
    return {
      success: false,
      data: null,
      error: `Schema not found: ${typeName}`,
    };
  }

  return { success: true, data: schemas[0] };
}

export async function inspectErrors(
  debugPort: number,
  lastN: number,
): Promise<InspectResult> {
  // Errors require a running server with debug sidecar
  // Attempt to fetch from the debug sidecar endpoint
  try {
    const url = `http://localhost:${debugPort}/_debug/errors?last=${lastN}`;
    const response = await fetchDebugEndpoint(url);
    return { success: true, data: response };
  } catch {
    return {
      success: false,
      data: [] as ErrorEntry[],
      error: `Could not connect to debug sidecar on port ${debugPort}. Is the server running with debug enabled?`,
    };
  }
}

export async function inspectPerformance(
  debugPort: number,
  routePath: string,
): Promise<InspectResult> {
  try {
    const url = `http://localhost:${debugPort}/_debug/performance?route=${encodeURIComponent(routePath)}`;
    const response = await fetchDebugEndpoint(url);
    return { success: true, data: response };
  } catch {
    return {
      success: false,
      data: null as unknown as PerformanceInfo,
      error: `Could not connect to debug sidecar on port ${debugPort}. Is the server running with debug enabled?`,
    };
  }
}

export async function inspectServer(debugPort: number): Promise<InspectResult> {
  try {
    const url = `http://localhost:${debugPort}/_debug/health`;
    const response = await fetchDebugEndpoint(url);
    return { success: true, data: response };
  } catch {
    return {
      success: false,
      data: {
        adapter: "unknown",
        platform: "unknown",
        status: "not running",
      } as ServerInfo,
      error: `Could not connect to debug sidecar on port ${debugPort}. Is the server running with debug enabled?`,
    };
  }
}

export async function inspectBuildPipeline(rootDir: string, config: Required<TypoKitConfig>): Promise<InspectResult> {
  // Build pipeline hooks are defined in the plugin system
  // Return the standard hook order from the TypoKit build pipeline
  const hooks: BuildHookInfo[] = [
    { name: "beforeTransform", order: 1, description: "Register additional type sources before parsing" },
    { name: "afterTypeParse", order: 2, description: "Inspect or modify the schema type map after parsing" },
    { name: "afterValidators", order: 3, description: "Add custom validators after Typia generation" },
    { name: "afterRouteTable", order: 4, description: "Post-process the compiled route table" },
    { name: "emit", order: 5, description: "Plugins emit their own artifacts" },
    { name: "done", order: 6, description: "Cleanup, reporting, and finalization" },
  ];

  // Try to detect registered plugins from config or build output
  const { join } = await import(/* @vite-ignore */ "path") as {
    join: (...args: string[]) => string;
  };
  const { existsSync } = await import(/* @vite-ignore */ "fs") as {
    existsSync: (p: string) => boolean;
  };

  const cacheHashPath = join(rootDir, config.outputDir, ".cache-hash");
  const lastBuild = existsSync(cacheHashPath) ? "cached" : "no build found";

  // Try to load plugins and show their registered taps
  let registeredTaps: Array<{ hookName: string; tapName: string; order: number }> = [];
  try {
    const { createBuildPipeline, getPipelineTaps } = await import(
      /* @vite-ignore */ "@typokit/core"
    ) as {
      createBuildPipeline: () => {
        hooks: Record<string, { tap(name: string, fn: (...args: unknown[]) => void): void }>;
      };
      getPipelineTaps: (pipeline: unknown) => Array<{ hookName: string; tapName: string; order: number }>;
    };
    const pipeline = createBuildPipeline();
    registeredTaps = getPipelineTaps(pipeline);
  } catch {
    // Core not available — skip tap introspection
  }

  return {
    success: true,
    data: {
      hooks,
      registeredTaps,
      lastBuildStatus: lastBuild,
      outputDir: config.outputDir,
    },
  };
}

/** Helper to fetch from the debug sidecar HTTP endpoint */
async function fetchDebugEndpoint(url: string): Promise<unknown> {
  // Use dynamic import for http module (no @types/node)
  const http = await import(/* @vite-ignore */ "http") as {
    get: (url: string, cb: (res: { statusCode?: number; on(event: string, cb: (data?: unknown) => void): void; setEncoding(enc: string): void }) => void) => { on(event: string, cb: (err: Error) => void): void };
  };

  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = "";
      res.setEncoding("utf-8");
      res.on("data", (chunk: unknown) => {
        body += String(chunk);
      });
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(body);
        }
      });
    });
    req.on("error", (err: Error) => {
      reject(err);
    });
  });
}

// ─── Main Dispatcher ────────────────────────────────────────

export async function executeInspect(options: InspectOptions): Promise<InspectResult> {
  const { rootDir, config, logger, subcommand, positional, flags } = options;
  const json = isJsonOutput(flags);
  const debugPort = typeof flags["debug-port"] === "string"
    ? parseInt(flags["debug-port"], 10)
    : 9800;

  let result: InspectResult;

  switch (subcommand) {
    case "routes": {
      logger.step("inspect", "Listing all routes...");
      result = await inspectRoutes(rootDir, config);
      break;
    }

    case "route": {
      const routeKey = positional[0];
      if (!routeKey) {
        return {
          success: false,
          data: null,
          error: "Usage: typokit inspect route 'GET /users/:id'",
        };
      }
      logger.step("inspect", `Looking up route: ${routeKey}`);
      result = await inspectRoute(rootDir, config, routeKey);
      break;
    }

    case "middleware": {
      logger.step("inspect", "Listing middleware chain...");
      result = await inspectMiddleware(rootDir, config);
      break;
    }

    case "dependencies":
    case "deps": {
      logger.step("inspect", "Building dependency graph...");
      result = await inspectDependencies(rootDir, config);
      break;
    }

    case "schema": {
      const typeName = positional[0];
      if (!typeName) {
        return {
          success: false,
          data: null,
          error: "Usage: typokit inspect schema <TypeName>",
        };
      }
      logger.step("inspect", `Looking up schema: ${typeName}`);
      result = await inspectSchema(rootDir, config, typeName);
      break;
    }

    case "errors": {
      const lastN = typeof flags["last"] === "string"
        ? parseInt(flags["last"], 10)
        : 10;
      logger.step("inspect", `Fetching last ${lastN} errors...`);
      result = await inspectErrors(debugPort, lastN);
      break;
    }

    case "performance": {
      const routePath = typeof flags["route"] === "string"
        ? flags["route"]
        : "/";
      logger.step("inspect", `Fetching performance for: ${routePath}`);
      result = await inspectPerformance(debugPort, routePath);
      break;
    }

    case "server": {
      logger.step("inspect", "Querying server info...");
      result = await inspectServer(debugPort);
      break;
    }

    case "build-pipeline": {
      logger.step("inspect", "Listing build pipeline hooks...");
      result = await inspectBuildPipeline(rootDir, config);
      break;
    }

    default: {
      logger.error(`Unknown inspect subcommand: ${subcommand}`);
      logger.info("Available subcommands:");
      logger.info("  routes              List all registered routes");
      logger.info("  route <key>         Detailed single route info");
      logger.info("  middleware          Full middleware chain");
      logger.info("  dependencies        Service dependency graph");
      logger.info("  schema <TypeName>   Type details and usage");
      logger.info("  errors --last <N>   Recent errors (requires running server)");
      logger.info("  performance --route <path>  Latency percentiles (requires running server)");
      logger.info("  server              Active server adapter info");
      logger.info("  build-pipeline      Registered build hooks and order");
      return {
        success: false,
        data: null,
        error: `Unknown inspect subcommand: ${subcommand}`,
      };
    }
  }

  if (result.success) {
    writeOutput(result.data, json, logger);
  } else if (result.error) {
    logger.error(result.error);
  }

  return result;
}
