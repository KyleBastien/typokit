// @typokit/cli — Scaffold Commands (init, add route, add service)

import type { CliLogger } from "../logger.js";

export interface ScaffoldCommandOptions {
  /** Project root directory */
  rootDir: string;
  /** Logger instance */
  logger: CliLogger;
  /** Scaffold subcommand: "init", "route", "service" */
  subcommand: string;
  /** Positional arguments (e.g., route/service name) */
  positional: string[];
  /** CLI flags */
  flags: Record<string, string | boolean>;
  /** Whether verbose mode is enabled */
  verbose: boolean;
}

export interface ScaffoldResult {
  /** Whether the command succeeded */
  success: boolean;
  /** Files created */
  filesCreated: string[];
  /** Duration in milliseconds */
  duration: number;
  /** Errors encountered */
  errors: string[];
}

export interface InitOptions {
  /** Project name */
  name: string;
  /** Server adapter to use */
  server: "native" | "fastify" | "hono" | "express";
  /** Database adapter to use */
  db: "drizzle" | "kysely" | "prisma" | "raw" | "none";
}

/** Generate a route contracts.ts template */
export function generateRouteContracts(name: string): string {
  const pascalName = toPascalCase(name);
  return `// Route contracts for ${name}
import type { RouteContract } from "@typokit/types";

/** ${pascalName} item type */
export interface ${pascalName} {
  id: string;
  createdAt: string;
  updatedAt: string;
}

/** Create ${pascalName} request body */
export interface Create${pascalName}Body {
  // TODO: Define create fields
}

/** Update ${pascalName} request body */
export interface Update${pascalName}Body {
  // TODO: Define update fields
}

/** Route contracts for /${name} */
export interface ${pascalName}Routes {
  "GET /${name}": RouteContract<Record<string, never>, { limit?: number; offset?: number }, never, ${pascalName}[]>;
  "GET /${name}/:id": RouteContract<{ id: string }, never, never, ${pascalName}>;
  "POST /${name}": RouteContract<Record<string, never>, never, Create${pascalName}Body, ${pascalName}>;
  "PUT /${name}/:id": RouteContract<{ id: string }, never, Update${pascalName}Body, ${pascalName}>;
  "DELETE /${name}/:id": RouteContract<{ id: string }, never, never, void>;
}
`;
}

/** Generate a route handlers.ts template */
export function generateRouteHandlers(name: string): string {
  const pascalName = toPascalCase(name);
  return `// Route handlers for ${name}
import type { RouteHandler, RequestContext } from "@typokit/types";
import type { ${pascalName}, Create${pascalName}Body, Update${pascalName}Body } from "./contracts.ts";

/** List all ${name} */
export const list${pascalName}: RouteHandler = async (ctx: RequestContext) => {
  const _query = ctx.query as { limit?: number; offset?: number };
  // TODO: Implement list logic
  return { status: 200, body: [] as ${pascalName}[] };
};

/** Get a single ${name} by ID */
export const get${pascalName}: RouteHandler = async (ctx: RequestContext) => {
  const { id } = ctx.params as { id: string };
  // TODO: Implement get logic
  return { status: 200, body: { id } as ${pascalName} };
};

/** Create a new ${name} */
export const create${pascalName}: RouteHandler = async (ctx: RequestContext) => {
  const _body = ctx.body as Create${pascalName}Body;
  // TODO: Implement create logic
  return { status: 201, body: {} as ${pascalName} };
};

/** Update an existing ${name} */
export const update${pascalName}: RouteHandler = async (ctx: RequestContext) => {
  const { id } = ctx.params as { id: string };
  const _body = ctx.body as Update${pascalName}Body;
  // TODO: Implement update logic
  return { status: 200, body: { id } as ${pascalName} };
};

/** Delete a ${name} */
export const delete${pascalName}: RouteHandler = async (ctx: RequestContext) => {
  const { id } = ctx.params as { id: string };
  // TODO: Implement delete logic
  void id;
  return { status: 204, body: undefined };
};

/** Default export: all handlers for registration in app.ts */
export default {
  "GET /${name}": list${pascalName},
  "GET /${name}/:id": get${pascalName},
  "POST /${name}": create${pascalName},
  "PUT /${name}/:id": update${pascalName},
  "DELETE /${name}/:id": delete${pascalName},
};
`;
}

/** Generate a route middleware.ts template */
export function generateRouteMiddleware(name: string): string {
  return `// Route-specific middleware for ${name}
import type { MiddlewareFn } from "@typokit/types";

/**
 * Example middleware for ${name} routes.
 * Add route-specific middleware here (e.g., authorization, rate limiting).
 */
export const ${toCamelCase(name)}Middleware: MiddlewareFn = async (ctx, next) => {
  // TODO: Implement route-specific middleware
  return next(ctx);
};
`;
}

/** Generate a service template */
export function generateService(name: string): string {
  const pascalName = toPascalCase(name);
  return `// ${pascalName} service — business logic layer

/**
 * ${pascalName}Service handles business logic for ${name}.
 * Keep handlers thin — put complex logic here.
 */
export class ${pascalName}Service {
  /**
   * Example method. Replace with actual business logic.
   */
  async execute(): Promise<void> {
    // TODO: Implement ${name} business logic
  }
}

/** Singleton instance for convenience */
export const ${toCamelCase(name)}Service = new ${pascalName}Service();
`;
}

/** Generate package.json for a new project */
export function generatePackageJson(options: InitOptions): string {
  const deps: Record<string, string> = {
    "@typokit/core": "^0.1.0",
    "@typokit/types": "^0.1.0",
    "@typokit/errors": "^0.1.0",
    "@typokit/cli": "^0.1.0",
  };

  if (options.server !== "native") {
    deps[`@typokit/server-${options.server}`] = "^0.1.0";
  } else {
    deps["@typokit/server-native"] = "^0.1.0";
  }

  if (options.db !== "none") {
    deps[`@typokit/db-${options.db}`] = "^0.1.0";
  }

  return JSON.stringify(
    {
      name: options.name,
      version: "0.1.0",
      type: "module",
      private: true,
      scripts: {
        build: "typokit build",
        dev: "typokit dev",
        test: "typokit test",
        "generate:db": "typokit generate:db",
        "generate:client": "typokit generate:client",
        typecheck: "tsc --noEmit",
      },
      dependencies: deps,
      devDependencies: {
        typescript: "^5.7.0",
        "@typokit/transform-native": "^0.1.0",
      },
    },
    null,
    2,
  ) + "\n";
}

/** Generate tsconfig.json for a new project */
export function generateTsconfig(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        allowImportingTsExtensions: true,
        rewriteRelativeImportExtensions: true,
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        outDir: "dist",
        rootDir: "src",
        declaration: true,
        declarationMap: true,
        sourceMap: true,
      },
      include: ["src"],
    },
    null,
    2,
  ) + "\n";
}

/** Generate the main app.ts for a new project */
export function generateAppTs(options: InitOptions): string {
  const serverImport = options.server === "native"
    ? `import { nativeServer } from "@typokit/server-native";`
    : `import { ${options.server}Server } from "@typokit/server-${options.server}";`;

  const serverValue = options.server === "native"
    ? "nativeServer()"
    : `${options.server}Server()`;

  return `// Application entry point — explicit route registration
import { createApp } from "@typokit/core";
${serverImport}

export const app = createApp({
  server: ${serverValue},
  middleware: [],
  routes: [
    // Register route modules here:
    // { prefix: "/users", handlers: usersHandlers },
  ],
});

// Start the server
app.listen({ port: 3000 }).then(() => {
  console.log("Server running on http://localhost:3000");
});
`;
}

/** Generate the types.ts seed file for a new project */
export function generateTypesTs(): string {
  return `// Schema type definitions — the single source of truth
// TypoKit generates validation, DB schema, OpenAPI, and client types from these interfaces.
// See: https://github.com/typokit/typokit#schema-types

/** @table */
export interface Example {
  /** @id @generated */
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}
`;
}

/** Convert kebab-case or snake_case name to PascalCase */
export function toPascalCase(name: string): string {
  return name
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/** Convert kebab-case or snake_case name to camelCase */
export function toCamelCase(name: string): string {
  const pascal = toPascalCase(name);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/**
 * Execute `typokit init` — create a new project from template.
 */
export async function scaffoldInit(
  rootDir: string,
  options: InitOptions,
  logger: CliLogger,
): Promise<ScaffoldResult> {
  const start = Date.now();
  const { join } = await import(/* @vite-ignore */ "path") as {
    join: (...args: string[]) => string;
  };
  const { mkdirSync, writeFileSync, existsSync } = await import(/* @vite-ignore */ "fs") as {
    mkdirSync: (p: string, o?: { recursive?: boolean }) => void;
    writeFileSync: (p: string, data: string) => void;
    existsSync: (p: string) => boolean;
  };

  const projectDir = join(rootDir, options.name);
  const filesCreated: string[] = [];
  const errors: string[] = [];

  // Check if directory already exists with content
  if (existsSync(projectDir)) {
    errors.push(`Directory "${options.name}" already exists`);
    return { success: false, filesCreated, duration: Date.now() - start, errors };
  }

  try {
    // Create directory structure per Section 4.4
    const dirs = [
      projectDir,
      join(projectDir, "src"),
      join(projectDir, "src", "routes"),
      join(projectDir, "src", "middleware"),
      join(projectDir, "src", "services"),
    ];

    for (const dir of dirs) {
      mkdirSync(dir, { recursive: true });
    }

    // Write package.json
    const pkgPath = join(projectDir, "package.json");
    writeFileSync(pkgPath, generatePackageJson(options));
    filesCreated.push(pkgPath);
    logger.info(`Created ${pkgPath}`);

    // Write tsconfig.json
    const tscPath = join(projectDir, "tsconfig.json");
    writeFileSync(tscPath, generateTsconfig());
    filesCreated.push(tscPath);
    logger.info(`Created ${tscPath}`);

    // Write src/app.ts
    const appPath = join(projectDir, "src", "app.ts");
    writeFileSync(appPath, generateAppTs(options));
    filesCreated.push(appPath);
    logger.info(`Created ${appPath}`);

    // Write src/types.ts
    const typesPath = join(projectDir, "src", "types.ts");
    writeFileSync(typesPath, generateTypesTs());
    filesCreated.push(typesPath);
    logger.info(`Created ${typesPath}`);

    logger.info(`\nProject "${options.name}" created successfully!`);
    logger.info(`\n  cd ${options.name}`);
    logger.info("  npm install");
    logger.info("  typokit dev\n");

    return { success: true, filesCreated, duration: Date.now() - start, errors };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(msg);
    return { success: false, filesCreated, duration: Date.now() - start, errors };
  }
}

/**
 * Execute `typokit add route <name>` — scaffold a route module.
 */
export async function scaffoldRoute(
  rootDir: string,
  name: string,
  logger: CliLogger,
): Promise<ScaffoldResult> {
  const start = Date.now();
  const { join } = await import(/* @vite-ignore */ "path") as {
    join: (...args: string[]) => string;
  };
  const { mkdirSync, writeFileSync, existsSync } = await import(/* @vite-ignore */ "fs") as {
    mkdirSync: (p: string, o?: { recursive?: boolean }) => void;
    writeFileSync: (p: string, data: string) => void;
    existsSync: (p: string) => boolean;
  };

  const filesCreated: string[] = [];
  const errors: string[] = [];

  if (!name) {
    errors.push("Route name is required. Usage: typokit add route <name>");
    return { success: false, filesCreated, duration: Date.now() - start, errors };
  }

  const routeDir = join(rootDir, "src", "routes", name);

  if (existsSync(routeDir)) {
    errors.push(`Route directory "${name}" already exists at src/routes/${name}`);
    return { success: false, filesCreated, duration: Date.now() - start, errors };
  }

  try {
    mkdirSync(routeDir, { recursive: true });

    // contracts.ts — route type contracts
    const contractsPath = join(routeDir, "contracts.ts");
    writeFileSync(contractsPath, generateRouteContracts(name));
    filesCreated.push(contractsPath);
    logger.info(`Created ${contractsPath}`);

    // handlers.ts — handler implementations
    const handlersPath = join(routeDir, "handlers.ts");
    writeFileSync(handlersPath, generateRouteHandlers(name));
    filesCreated.push(handlersPath);
    logger.info(`Created ${handlersPath}`);

    // middleware.ts — route-specific middleware
    const middlewarePath = join(routeDir, "middleware.ts");
    writeFileSync(middlewarePath, generateRouteMiddleware(name));
    filesCreated.push(middlewarePath);
    logger.info(`Created ${middlewarePath}`);

    logger.info(`\nRoute "${name}" scaffolded at src/routes/${name}/`);
    logger.info("  Don't forget to register it in src/app.ts!\n");

    return { success: true, filesCreated, duration: Date.now() - start, errors };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(msg);
    return { success: false, filesCreated, duration: Date.now() - start, errors };
  }
}

/**
 * Execute `typokit add service <name>` — scaffold a service file.
 */
export async function scaffoldService(
  rootDir: string,
  name: string,
  logger: CliLogger,
): Promise<ScaffoldResult> {
  const start = Date.now();
  const { join } = await import(/* @vite-ignore */ "path") as {
    join: (...args: string[]) => string;
  };
  const { mkdirSync, writeFileSync, existsSync } = await import(/* @vite-ignore */ "fs") as {
    mkdirSync: (p: string, o?: { recursive?: boolean }) => void;
    writeFileSync: (p: string, data: string) => void;
    existsSync: (p: string) => boolean;
  };

  const filesCreated: string[] = [];
  const errors: string[] = [];

  if (!name) {
    errors.push("Service name is required. Usage: typokit add service <name>");
    return { success: false, filesCreated, duration: Date.now() - start, errors };
  }

  const servicesDir = join(rootDir, "src", "services");
  const servicePath = join(servicesDir, `${name}.service.ts`);

  if (existsSync(servicePath)) {
    errors.push(`Service "${name}" already exists at src/services/${name}.service.ts`);
    return { success: false, filesCreated, duration: Date.now() - start, errors };
  }

  try {
    mkdirSync(servicesDir, { recursive: true });

    writeFileSync(servicePath, generateService(name));
    filesCreated.push(servicePath);
    logger.info(`Created ${servicePath}`);

    logger.info(`\nService "${name}" scaffolded at src/services/${name}.service.ts\n`);

    return { success: true, filesCreated, duration: Date.now() - start, errors };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(msg);
    return { success: false, filesCreated, duration: Date.now() - start, errors };
  }
}

/**
 * Execute scaffold commands dispatcher.
 */
export async function executeScaffold(options: ScaffoldCommandOptions): Promise<ScaffoldResult> {
  const { rootDir, logger, subcommand, positional, flags } = options;

  if (subcommand === "init") {
    const name = positional[0] ?? (typeof flags["name"] === "string" ? flags["name"] : "my-app");
    const server = parseServerFlag(flags["server"]);
    const db = parseDbFlag(flags["db"]);

    return scaffoldInit(rootDir, { name, server, db }, logger);
  }

  if (subcommand === "route") {
    const name = positional[0] ?? "";
    return scaffoldRoute(rootDir, name, logger);
  }

  if (subcommand === "service") {
    const name = positional[0] ?? "";
    return scaffoldService(rootDir, name, logger);
  }

  return {
    success: false,
    filesCreated: [],
    duration: 0,
    errors: [`Unknown scaffold subcommand: "${subcommand}". Use: init, route, service`],
  };
}

/** Parse server adapter flag */
function parseServerFlag(value: string | boolean | undefined): InitOptions["server"] {
  if (typeof value === "string") {
    const valid = ["native", "fastify", "hono", "express"] as const;
    if (valid.includes(value as typeof valid[number])) {
      return value as InitOptions["server"];
    }
  }
  return "native";
}

/** Parse database adapter flag */
function parseDbFlag(value: string | boolean | undefined): InitOptions["db"] {
  if (typeof value === "string") {
    const valid = ["drizzle", "kysely", "prisma", "raw", "none"] as const;
    if (valid.includes(value as typeof valid[number])) {
      return value as InitOptions["db"];
    }
  }
  return "none";
}
