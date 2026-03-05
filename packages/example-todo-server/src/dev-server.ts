// @typokit/example-todo-server — Dev Server with Debug Sidecar
//
// Demonstrates how to start the reference app with the debug plugin
// enabled. In development mode, the debug sidecar runs on port 9800
// and exposes introspection endpoints for routes, health, and errors.

import type {
  CompiledRouteTable,
  HandlerMap,
  MiddlewareChain,
  TypoKitRequest,
  TypoKitResponse,
  RequestContext,
  ValidatorMap,
  ValidationResult,
  ValidationFieldError,
} from "@typokit/types";
import type { TypoKitPlugin, AppInstance } from "@typokit/core";
import { createApp } from "@typokit/core";
import { AppError } from "@typokit/errors";
import { nativeServer } from "@typokit/server-native";
import { debugPlugin } from "@typokit/plugin-debug";
import userHandlers from "./handlers/users.js";
import todoHandlers from "./handlers/todos.js";

// ─── Handler Wrapper ─────────────────────────────────────────

type AnyHandler = (input: {
  params: Record<string, string>;
  query: Record<string, string | string[] | undefined>;
  body: unknown;
  ctx: RequestContext;
}) => Promise<unknown>;

function wrapHandler(
  handler: AnyHandler,
  successStatus: number = 200,
): (req: TypoKitRequest, ctx: RequestContext) => Promise<TypoKitResponse> {
  return async (
    req: TypoKitRequest,
    ctx: RequestContext,
  ): Promise<TypoKitResponse> => {
    try {
      const result = await handler({
        params: req.params,
        query: req.query,
        body: req.body,
        ctx,
      });
      if (result === undefined || result === null) {
        return { status: successStatus, headers: {}, body: null };
      }
      return {
        status: successStatus,
        headers: { "content-type": "application/json" },
        body: result,
      };
    } catch (error: unknown) {
      if (error instanceof AppError) {
        return {
          status: error.status,
          headers: { "content-type": "application/json" },
          body: error.toJSON(),
        };
      }
      throw error;
    }
  };
}

// ─── Validators ──────────────────────────────────────────────

function validateCreateUser(input: unknown): ValidationResult {
  const body = (input ?? {}) as Record<string, unknown>;
  const errors: ValidationFieldError[] = [];
  if (typeof body.email !== "string" || !body.email.includes("@")) {
    errors.push({
      path: "email",
      expected: "email string",
      actual: body.email,
    });
  }
  if (typeof body.displayName !== "string" || body.displayName.length < 2) {
    errors.push({
      path: "displayName",
      expected: "string (min 2 chars)",
      actual: body.displayName,
    });
  }
  return errors.length > 0
    ? { success: false, errors }
    : { success: true, data: input };
}

function validateUpdateUser(input: unknown): ValidationResult {
  const body = (input ?? {}) as Record<string, unknown>;
  const errors: ValidationFieldError[] = [];
  if (
    body.email !== undefined &&
    (typeof body.email !== "string" || !body.email.includes("@"))
  ) {
    errors.push({
      path: "email",
      expected: "email string",
      actual: body.email,
    });
  }
  if (
    body.displayName !== undefined &&
    (typeof body.displayName !== "string" || body.displayName.length < 2)
  ) {
    errors.push({
      path: "displayName",
      expected: "string (min 2 chars)",
      actual: body.displayName,
    });
  }
  return errors.length > 0
    ? { success: false, errors }
    : { success: true, data: input };
}

function validateCreateTodo(input: unknown): ValidationResult {
  const body = (input ?? {}) as Record<string, unknown>;
  const errors: ValidationFieldError[] = [];
  if (typeof body.title !== "string" || body.title.length < 1) {
    errors.push({
      path: "title",
      expected: "string (min 1 char)",
      actual: body.title,
    });
  }
  if (typeof body.userId !== "string") {
    errors.push({ path: "userId", expected: "string", actual: body.userId });
  }
  return errors.length > 0
    ? { success: false, errors }
    : { success: true, data: input };
}

function validateUpdateTodo(input: unknown): ValidationResult {
  const body = (input ?? {}) as Record<string, unknown>;
  const errors: ValidationFieldError[] = [];
  if (
    body.title !== undefined &&
    (typeof body.title !== "string" || body.title.length < 1)
  ) {
    errors.push({
      path: "title",
      expected: "string (min 1 char)",
      actual: body.title,
    });
  }
  if (body.completed !== undefined && typeof body.completed !== "boolean") {
    errors.push({
      path: "completed",
      expected: "boolean",
      actual: body.completed,
    });
  }
  return errors.length > 0
    ? { success: false, errors }
    : { success: true, data: input };
}

// ─── Route Table ─────────────────────────────────────────────

function buildRouteTable(): CompiledRouteTable {
  return {
    segment: "",
    children: {
      users: {
        segment: "users",
        handlers: {
          GET: { ref: "users#list", middleware: [] },
          POST: {
            ref: "users#create",
            middleware: [],
            validators: { body: "CreateUserInput" },
          },
        },
        paramChild: {
          segment: ":id",
          paramName: "id",
          handlers: {
            GET: { ref: "users#get", middleware: [] },
            PUT: {
              ref: "users#update",
              middleware: [],
              validators: { body: "UpdateUserInput" },
            },
            DELETE: { ref: "users#delete", middleware: [] },
          },
        },
      },
      todos: {
        segment: "todos",
        handlers: {
          GET: { ref: "todos#list", middleware: [] },
          POST: {
            ref: "todos#create",
            middleware: [],
            validators: { body: "CreateTodoInput" },
          },
        },
        paramChild: {
          segment: ":id",
          paramName: "id",
          handlers: {
            GET: { ref: "todos#get", middleware: [] },
            PUT: {
              ref: "todos#update",
              middleware: [],
              validators: { body: "UpdateTodoInput" },
            },
            DELETE: { ref: "todos#delete", middleware: [] },
          },
        },
      },
    },
  };
}

// ─── Handler Map ─────────────────────────────────────────────

function buildHandlerMap(): HandlerMap {
  return {
    "users#list": wrapHandler(
      userHandlers["GET /users"] as unknown as AnyHandler,
    ),
    "users#create": wrapHandler(
      userHandlers["POST /users"] as unknown as AnyHandler,
      201,
    ),
    "users#get": wrapHandler(
      userHandlers["GET /users/:id"] as unknown as AnyHandler,
    ),
    "users#update": wrapHandler(
      userHandlers["PUT /users/:id"] as unknown as AnyHandler,
    ),
    "users#delete": wrapHandler(
      userHandlers["DELETE /users/:id"] as unknown as AnyHandler,
      204,
    ),
    "todos#list": wrapHandler(
      todoHandlers["GET /todos"] as unknown as AnyHandler,
    ),
    "todos#create": wrapHandler(
      todoHandlers["POST /todos"] as unknown as AnyHandler,
      201,
    ),
    "todos#get": wrapHandler(
      todoHandlers["GET /todos/:id"] as unknown as AnyHandler,
    ),
    "todos#update": wrapHandler(
      todoHandlers["PUT /todos/:id"] as unknown as AnyHandler,
    ),
    "todos#delete": wrapHandler(
      todoHandlers["DELETE /todos/:id"] as unknown as AnyHandler,
      204,
    ),
  };
}

// ─── Validator Map ───────────────────────────────────────────

function buildValidatorMap(): ValidatorMap {
  return {
    CreateUserInput: validateCreateUser,
    UpdateUserInput: validateUpdateUser,
    CreateTodoInput: validateCreateTodo,
    UpdateTodoInput: validateUpdateTodo,
  };
}

// ─── Dev App with Debug Sidecar ──────────────────────────────

export interface DevServerOptions {
  /** App server port (default: 3000) */
  port?: number;
  /** Debug sidecar port (default: 9800) */
  debugPort?: number;
}

/**
 * Create the todo-server application with the debug sidecar plugin enabled.
 * The debug sidecar starts on a separate port and exposes introspection
 * endpoints for routes, health, errors, performance, and more.
 */
export function createDevTodoApp(options: DevServerOptions = {}) {
  const debugPort = options.debugPort ?? 9800;

  const adapter = nativeServer();
  const routeTable = buildRouteTable();
  const handlerMap = buildHandlerMap();
  const middlewareChain: MiddlewareChain = { entries: [] };
  const validatorMap = buildValidatorMap();

  // Register routes with the native server adapter
  adapter.registerRoutes(routeTable, handlerMap, middlewareChain, validatorMap);

  // Create the debug plugin — auto-enabled in dev mode (no auth required)
  const debug = debugPlugin({ port: debugPort });

  // Bridge plugin that feeds the compiled route table into the debug sidecar
  const routeTableBridge: TypoKitPlugin = {
    name: "route-table-bridge",
    async onStart(app: AppInstance): Promise<void> {
      const debugService = app.services["_debug"] as
        | { setRouteTable: (rt: CompiledRouteTable) => void }
        | undefined;
      if (debugService?.setRouteTable) {
        debugService.setRouteTable(routeTable);
      }
    },
  };

  // Create the app with both plugins wired in (debug must come first)
  const app = createApp({
    server: adapter,
    middleware: [],
    routes: [],
    plugins: [debug, routeTableBridge],
  });

  return app;
}

/**
 * Start the dev server. This is the CLI entry point for `typokit dev`.
 */
export async function startDevServer(
  options: DevServerOptions = {},
): Promise<{ appPort: number; debugPort: number; close: () => Promise<void> }> {
  const port = options.port ?? 3000;
  const debugPort = options.debugPort ?? 9800;

  const app = createDevTodoApp({ port, debugPort });

  await app.listen(port);

  return {
    appPort: port,
    debugPort,
    close: async () => {
      await app.close();
    },
  };
}
