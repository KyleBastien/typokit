// @typokit/example-todo-server — Test Application Factory
//
// Creates a fully wired TypoKit app for integration and contract testing.
// Routes are registered with the native server adapter using a compiled
// route table, handler map, and validators.

import type {
  CompiledRouteTable,
  HandlerMap,
  MiddlewareChain,
  TypoKitRequest,
  TypoKitResponse,
  RequestContext,
  ServerHandle,
  ValidatorMap,
  ValidationResult,
  ValidationFieldError,
} from "@typokit/types";
import type { TypoKitApp } from "@typokit/core";
import { createErrorMiddleware } from "@typokit/core";
import { AppError } from "@typokit/errors";
import { nativeServer } from "@typokit/server-native";
import userHandlers from "./handlers/users.js";
import todoHandlers from "./handlers/todos.js";
import * as userService from "./services/user-service.js";
import * as todoService from "./services/todo-service.js";

// ─── Handler Wrapper ─────────────────────────────────────────

type AnyHandler = (input: {
  params: Record<string, string>;
  query: Record<string, string | string[] | undefined>;
  body: unknown;
  ctx: RequestContext;
}) => Promise<unknown>;

/** Wrap a typed handler into a HandlerMap-compatible function with error handling */
function wrapHandler(
  handler: AnyHandler,
  successStatus: number = 200,
): (req: TypoKitRequest, ctx: RequestContext) => Promise<TypoKitResponse> {
  return async (req: TypoKitRequest, ctx: RequestContext): Promise<TypoKitResponse> => {
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
    errors.push({ path: "email", expected: "email string", actual: body.email });
  }
  if (typeof body.displayName !== "string" || body.displayName.length < 2) {
    errors.push({ path: "displayName", expected: "string (min 2 chars)", actual: body.displayName });
  }

  return errors.length > 0 ? { success: false, errors } : { success: true, data: input };
}

function validateUpdateUser(input: unknown): ValidationResult {
  const body = (input ?? {}) as Record<string, unknown>;
  const errors: ValidationFieldError[] = [];

  if (body.email !== undefined && (typeof body.email !== "string" || !body.email.includes("@"))) {
    errors.push({ path: "email", expected: "email string", actual: body.email });
  }
  if (body.displayName !== undefined && (typeof body.displayName !== "string" || body.displayName.length < 2)) {
    errors.push({ path: "displayName", expected: "string (min 2 chars)", actual: body.displayName });
  }
  if (body.status !== undefined && !["active", "suspended", "deleted"].includes(body.status as string)) {
    errors.push({ path: "status", expected: '"active" | "suspended" | "deleted"', actual: body.status });
  }

  return errors.length > 0 ? { success: false, errors } : { success: true, data: input };
}

function validateCreateTodo(input: unknown): ValidationResult {
  const body = (input ?? {}) as Record<string, unknown>;
  const errors: ValidationFieldError[] = [];

  if (typeof body.title !== "string" || body.title.length < 1) {
    errors.push({ path: "title", expected: "string (min 1 char)", actual: body.title });
  }
  if (typeof body.userId !== "string") {
    errors.push({ path: "userId", expected: "string", actual: body.userId });
  }

  return errors.length > 0 ? { success: false, errors } : { success: true, data: input };
}

function validateUpdateTodo(input: unknown): ValidationResult {
  const body = (input ?? {}) as Record<string, unknown>;
  const errors: ValidationFieldError[] = [];

  if (body.title !== undefined && (typeof body.title !== "string" || body.title.length < 1)) {
    errors.push({ path: "title", expected: "string (min 1 char)", actual: body.title });
  }
  if (body.completed !== undefined && typeof body.completed !== "boolean") {
    errors.push({ path: "completed", expected: "boolean", actual: body.completed });
  }

  return errors.length > 0 ? { success: false, errors } : { success: true, data: input };
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
          POST: { ref: "users#create", middleware: [], validators: { body: "CreateUserInput" } },
        },
        paramChild: {
          segment: ":id",
          paramName: "id",
          handlers: {
            GET: { ref: "users#get", middleware: [] },
            PUT: { ref: "users#update", middleware: [], validators: { body: "UpdateUserInput" } },
            DELETE: { ref: "users#delete", middleware: [] },
          },
        },
      },
      todos: {
        segment: "todos",
        handlers: {
          GET: { ref: "todos#list", middleware: [] },
          POST: { ref: "todos#create", middleware: [], validators: { body: "CreateTodoInput" } },
        },
        paramChild: {
          segment: ":id",
          paramName: "id",
          handlers: {
            GET: { ref: "todos#get", middleware: [] },
            PUT: { ref: "todos#update", middleware: [], validators: { body: "UpdateTodoInput" } },
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
    "users#list": wrapHandler(userHandlers["GET /users"] as unknown as AnyHandler),
    "users#create": wrapHandler(userHandlers["POST /users"] as unknown as AnyHandler, 201),
    "users#get": wrapHandler(userHandlers["GET /users/:id"] as unknown as AnyHandler),
    "users#update": wrapHandler(userHandlers["PUT /users/:id"] as unknown as AnyHandler),
    "users#delete": wrapHandler(userHandlers["DELETE /users/:id"] as unknown as AnyHandler, 204),
    "todos#list": wrapHandler(todoHandlers["GET /todos"] as unknown as AnyHandler),
    "todos#create": wrapHandler(todoHandlers["POST /todos"] as unknown as AnyHandler, 201),
    "todos#get": wrapHandler(todoHandlers["GET /todos/:id"] as unknown as AnyHandler),
    "todos#update": wrapHandler(todoHandlers["PUT /todos/:id"] as unknown as AnyHandler),
    "todos#delete": wrapHandler(todoHandlers["DELETE /todos/:id"] as unknown as AnyHandler, 204),
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

// ─── Test App Factory ────────────────────────────────────────

/**
 * Create a fully wired TypoKit test application.
 * Routes are registered with the native server adapter including validators.
 * Auth middleware is bypassed for direct handler access.
 */
export function createTestTodoApp(): TypoKitApp {
  const adapter = nativeServer();
  const routeTable = buildRouteTable();
  const handlerMap = buildHandlerMap();
  const middlewareChain: MiddlewareChain = { entries: [] };
  const validatorMap = buildValidatorMap();

  adapter.registerRoutes(routeTable, handlerMap, middlewareChain, validatorMap);

  const errorMiddleware = createErrorMiddleware();
  let serverHandle: ServerHandle | null = null;

  return {
    errorMiddleware,
    async listen(port: number) {
      serverHandle = await adapter.listen(port);
      return serverHandle;
    },
    getNativeServer() {
      return adapter.getNativeServer?.() ?? null;
    },
    async close() {
      if (serverHandle) {
        await serverHandle.close();
        serverHandle = null;
      }
    },
  };
}

/** Reset the in-memory data stores between tests */
export function resetStore(): void {
  userService.resetUsers();
  todoService.resetTodos();
}
