// Tests for @typokit/cli scaffold commands
import { describe, it, expect } from "@rstest/core";
import {
  toPascalCase,
  toCamelCase,
  generateRouteContracts,
  generateRouteHandlers,
  generateRouteMiddleware,
  generateService,
  generatePackageJson,
  generateTsconfig,
  generateAppTs,
  generateTypesTs,
  executeScaffold,
} from "./commands/scaffold.js";
import type {
  InitOptions,
  ScaffoldCommandOptions,
} from "./commands/scaffold.js";
import { createLogger } from "./logger.js";

const logger = createLogger({ verbose: false });

describe("scaffold — utility functions", () => {
  it("toPascalCase converts kebab-case", () => {
    expect(toPascalCase("user-profile")).toBe("UserProfile");
    expect(toPascalCase("auth")).toBe("Auth");
    expect(toPascalCase("my-cool-service")).toBe("MyCoolService");
  });

  it("toPascalCase converts snake_case", () => {
    expect(toPascalCase("user_profile")).toBe("UserProfile");
  });

  it("toCamelCase converts names", () => {
    expect(toCamelCase("user-profile")).toBe("userProfile");
    expect(toCamelCase("auth")).toBe("auth");
  });
});

describe("scaffold — template generation", () => {
  it("generateRouteContracts produces valid template", () => {
    const result = generateRouteContracts("users");
    expect(result).toContain("import type { RouteContract }");
    expect(result).toContain("export interface Users {");
    expect(result).toContain("export interface CreateUsersBody {");
    expect(result).toContain("export interface UpdateUsersBody {");
    expect(result).toContain("export interface UsersRoutes {");
    expect(result).toContain('"GET /users"');
    expect(result).toContain('"POST /users"');
    expect(result).toContain('"DELETE /users/:id"');
  });

  it("generateRouteHandlers produces valid template", () => {
    const result = generateRouteHandlers("posts");
    expect(result).toContain("import type { RouteHandler, RequestContext }");
    expect(result).toContain("export const listPosts");
    expect(result).toContain("export const getPosts");
    expect(result).toContain("export const createPosts");
    expect(result).toContain("export const updatePosts");
    expect(result).toContain("export const deletePosts");
    expect(result).toContain("export default {");
    expect(result).toContain('"GET /posts"');
  });

  it("generateRouteMiddleware produces valid template", () => {
    const result = generateRouteMiddleware("users");
    expect(result).toContain("import type { MiddlewareFn }");
    expect(result).toContain("export const usersMiddleware");
    expect(result).toContain("return next(ctx)");
  });

  it("generateService produces valid template", () => {
    const result = generateService("auth");
    expect(result).toContain("export class AuthService {");
    expect(result).toContain("export const authService = new AuthService()");
  });

  it("generateService handles kebab-case names", () => {
    const result = generateService("user-profile");
    expect(result).toContain("export class UserProfileService {");
    expect(result).toContain(
      "export const userProfileService = new UserProfileService()",
    );
  });

  it("generatePackageJson produces valid JSON", () => {
    const options: InitOptions = {
      name: "my-app",
      server: "native",
      db: "none",
    };
    const result = generatePackageJson(options);
    const parsed = JSON.parse(result) as Record<string, unknown>;
    expect(parsed["name"]).toBe("my-app");
    expect(parsed["type"]).toBe("module");

    const deps = parsed["dependencies"] as Record<string, string>;
    expect(deps["@typokit/core"]).toBe("^0.1.0");
    expect(deps["@typokit/server-native"]).toBe("^0.1.0");
  });

  it("generatePackageJson includes server adapter dependency", () => {
    const options: InitOptions = {
      name: "my-app",
      server: "fastify",
      db: "drizzle",
    };
    const result = generatePackageJson(options);
    const parsed = JSON.parse(result) as Record<string, unknown>;
    const deps = parsed["dependencies"] as Record<string, string>;
    expect(deps["@typokit/server-fastify"]).toBe("^0.1.0");
    expect(deps["@typokit/db-drizzle"]).toBe("^0.1.0");
  });

  it("generateTsconfig produces valid JSON", () => {
    const result = generateTsconfig();
    const parsed = JSON.parse(result) as Record<string, unknown>;
    const co = parsed["compilerOptions"] as Record<string, unknown>;
    expect(co["target"]).toBe("ES2022");
    expect(co["module"]).toBe("NodeNext");
    expect(co["strict"]).toBe(true);
  });

  it("generateAppTs uses correct server adapter", () => {
    const native = generateAppTs({ name: "app", server: "native", db: "none" });
    expect(native).toContain(
      'import { nativeServer } from "@typokit/server-native"',
    );
    expect(native).toContain("nativeServer()");

    const fastify = generateAppTs({
      name: "app",
      server: "fastify",
      db: "none",
    });
    expect(fastify).toContain(
      'import { fastifyServer } from "@typokit/server-fastify"',
    );
    expect(fastify).toContain("fastifyServer()");
  });

  it("generateTypesTs includes example type with JSDoc tags", () => {
    const result = generateTypesTs();
    expect(result).toContain("/** @table */");
    expect(result).toContain("export interface Example {");
    expect(result).toContain("/** @id @generated */");
  });
});

describe("scaffold — executeScaffold dispatcher", () => {
  it("returns error for unknown subcommand", async () => {
    const opts: ScaffoldCommandOptions = {
      rootDir: "/tmp/test",
      logger,
      subcommand: "unknown",
      positional: [],
      flags: {},
      verbose: false,
    };
    const result = await executeScaffold(opts);
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain("Unknown scaffold subcommand");
  });

  it("returns error for route without name", async () => {
    const opts: ScaffoldCommandOptions = {
      rootDir: "/tmp/test",
      logger,
      subcommand: "route",
      positional: [],
      flags: {},
      verbose: false,
    };
    const result = await executeScaffold(opts);
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain("Route name is required");
  });

  it("returns error for service without name", async () => {
    const opts: ScaffoldCommandOptions = {
      rootDir: "/tmp/test",
      logger,
      subcommand: "service",
      positional: [],
      flags: {},
      verbose: false,
    };
    const result = await executeScaffold(opts);
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain("Service name is required");
  });

  it("init uses default name when none provided", async () => {
    const opts: ScaffoldCommandOptions = {
      rootDir: "/tmp/nonexistent-scaffold-test-" + Date.now(),
      logger,
      subcommand: "init",
      positional: [],
      flags: {},
      verbose: false,
    };
    // This may fail due to permissions, but we check the flow
    const result = await executeScaffold(opts);
    // It either succeeds or fails with a real FS error, not a name error
    if (!result.success) {
      expect(result.errors[0]).not.toContain("name is required");
    }
    // Clean up if succeeded
    if (result.success) {
      const { rmSync } = (await import("fs")) as {
        rmSync: (
          p: string,
          o?: { recursive?: boolean; force?: boolean },
        ) => void;
      };
      const { join } = (await import("path")) as {
        join: (...args: string[]) => string;
      };
      try {
        rmSync(join(opts.rootDir, "my-app"), { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });
});

describe("scaffold — route contracts match arch doc Section 4.4", () => {
  it("creates contracts.ts, handlers.ts, middleware.ts", () => {
    const contracts = generateRouteContracts("users");
    const handlers = generateRouteHandlers("users");
    const middleware = generateRouteMiddleware("users");

    // All three files are generated
    expect(contracts.length).toBeGreaterThan(0);
    expect(handlers.length).toBeGreaterThan(0);
    expect(middleware.length).toBeGreaterThan(0);

    // Contracts has CRUD route signatures
    expect(contracts).toContain("GET /users");
    expect(contracts).toContain("POST /users");
    expect(contracts).toContain("PUT /users/:id");
    expect(contracts).toContain("DELETE /users/:id");

    // Handlers export a default object for registration
    expect(handlers).toContain("export default");
  });

  it("handler imports match contracts types", () => {
    const handlers = generateRouteHandlers("products");
    expect(handlers).toContain(
      'import type { Products, CreateProductsBody, UpdateProductsBody } from "./contracts.ts"',
    );
  });
});
