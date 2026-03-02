// @typokit/example-todo-client — Generated type-safe API client for the todo reference app

import type {
  UsersRoutes,
  TodosRoutes,
  PublicUser,
  PublicTodo,
  CreateUserInput,
  UpdateUserInput,
  CreateTodoInput,
  UpdateTodoInput,
  PaginatedResponse,
} from "@typokit/example-todo-schema";
import { createClient } from "@typokit/client";
import type { ClientOptions, TypeSafeClient, RouteMap } from "@typokit/client";

// ─── Combined Route Map ──────────────────────────────────────
// Maps "METHOD /path" keyed contracts into the RouteMap format:
//   { "/path": { METHOD: RouteContract<...> } }

/** All todo app routes in RouteMap format for the type-safe client */
export type TodoAppRoutes = {
  "/users": {
    GET: UsersRoutes["GET /users"];
    POST: UsersRoutes["POST /users"];
  };
  "/users/:id": {
    GET: UsersRoutes["GET /users/:id"];
    PUT: UsersRoutes["PUT /users/:id"];
    DELETE: UsersRoutes["DELETE /users/:id"];
  };
  "/todos": {
    GET: TodosRoutes["GET /todos"];
    POST: TodosRoutes["POST /todos"];
  };
  "/todos/:id": {
    GET: TodosRoutes["GET /todos/:id"];
    PUT: TodosRoutes["PUT /todos/:id"];
    DELETE: TodosRoutes["DELETE /todos/:id"];
  };
}

// ─── Client Factory ──────────────────────────────────────────

/**
 * Create a type-safe API client for the todo reference app.
 *
 * @example
 * ```ts
 * const client = createTodoClient({ baseUrl: "http://localhost:3000" });
 *
 * // Full autocomplete on paths, params, query, body, and response
 * const users = await client.get("/users", { query: { page: 1, pageSize: 10 } });
 * const user = await client.post("/users", { body: { email: "a@b.com", displayName: "Alice" } });
 * const todo = await client.get("/todos/:id", { params: { id: "abc" } });
 * ```
 */
export function createTodoClient(options: ClientOptions): TypeSafeClient<TodoAppRoutes> {
  return createClient<TodoAppRoutes>(options);
}

// ─── Re-exports for convenience ──────────────────────────────

export type {
  PublicUser,
  PublicTodo,
  CreateUserInput,
  UpdateUserInput,
  CreateTodoInput,
  UpdateTodoInput,
  PaginatedResponse,
  ClientOptions,
  TypeSafeClient,
  RouteMap,
  UsersRoutes,
  TodosRoutes,
};

export { createClient };
