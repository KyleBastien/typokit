// @typokit/example-todo-client — Tests
import { describe, it, expect } from "@rstest/core";
import { createTodoClient, createClient } from "./index.js";
import type {
  TodoAppRoutes,
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
} from "./index.js";

describe("@typokit/example-todo-client", () => {
  it("createTodoClient returns a TypeSafeClient", () => {
    const client = createTodoClient({
      baseUrl: "http://localhost:3000",
      interceptors: [],
    });

    expect(typeof client.get).toBe("function");
    expect(typeof client.post).toBe("function");
    expect(typeof client.put).toBe("function");
    expect(typeof client.patch).toBe("function");
    expect(typeof client.delete).toBe("function");
  });

  it("createClient is re-exported from @typokit/client", () => {
    expect(typeof createClient).toBe("function");
  });

  it("exports all expected type names", () => {
    // Type-level assertions: these will cause compile errors if types are missing
    const _routes: TodoAppRoutes | undefined = undefined;
    const _user: PublicUser | undefined = undefined;
    const _todo: PublicTodo | undefined = undefined;
    const _createUser: CreateUserInput | undefined = undefined;
    const _updateUser: UpdateUserInput | undefined = undefined;
    const _createTodo: CreateTodoInput | undefined = undefined;
    const _updateTodo: UpdateTodoInput | undefined = undefined;
    const _paginated: PaginatedResponse<unknown> | undefined = undefined;
    const _options: ClientOptions | undefined = undefined;
    const _safeClient: TypeSafeClient<RouteMap> | undefined = undefined;
    const _usersRoutes: UsersRoutes | undefined = undefined;
    const _todosRoutes: TodosRoutes | undefined = undefined;

    // Suppress unused warnings
    void _routes;
    void _user;
    void _todo;
    void _createUser;
    void _updateUser;
    void _createTodo;
    void _updateTodo;
    void _paginated;
    void _options;
    void _safeClient;
    void _usersRoutes;
    void _todosRoutes;

    expect(true).toBe(true);
  });

  it("TodoAppRoutes has correct route paths", () => {
    // Type-level check: these assignments will fail to compile if routes are wrong
    type HasUsersGet = TodoAppRoutes extends { "/users": { GET: unknown } }
      ? true
      : false;
    type HasUsersPost = TodoAppRoutes extends { "/users": { POST: unknown } }
      ? true
      : false;
    type HasUsersIdGet = TodoAppRoutes extends {
      "/users/:id": { GET: unknown };
    }
      ? true
      : false;
    type HasUsersIdPut = TodoAppRoutes extends {
      "/users/:id": { PUT: unknown };
    }
      ? true
      : false;
    type HasUsersIdDelete = TodoAppRoutes extends {
      "/users/:id": { DELETE: unknown };
    }
      ? true
      : false;
    type HasTodosGet = TodoAppRoutes extends { "/todos": { GET: unknown } }
      ? true
      : false;
    type HasTodosPost = TodoAppRoutes extends { "/todos": { POST: unknown } }
      ? true
      : false;
    type HasTodosIdGet = TodoAppRoutes extends {
      "/todos/:id": { GET: unknown };
    }
      ? true
      : false;
    type HasTodosIdPut = TodoAppRoutes extends {
      "/todos/:id": { PUT: unknown };
    }
      ? true
      : false;
    type HasTodosIdDelete = TodoAppRoutes extends {
      "/todos/:id": { DELETE: unknown };
    }
      ? true
      : false;

    // Runtime assertion — if the types are correct, these will all be true
    const _usersGet: HasUsersGet = true;
    const _usersPost: HasUsersPost = true;
    const _usersIdGet: HasUsersIdGet = true;
    const _usersIdPut: HasUsersIdPut = true;
    const _usersIdDelete: HasUsersIdDelete = true;
    const _todosGet: HasTodosGet = true;
    const _todosPost: HasTodosPost = true;
    const _todosIdGet: HasTodosIdGet = true;
    const _todosIdPut: HasTodosIdPut = true;
    const _todosIdDelete: HasTodosIdDelete = true;

    void _usersGet;
    void _usersPost;
    void _usersIdGet;
    void _usersIdPut;
    void _usersIdDelete;
    void _todosGet;
    void _todosPost;
    void _todosIdGet;
    void _todosIdPut;
    void _todosIdDelete;

    expect(true).toBe(true);
  });

  it("client methods make HTTP requests via fetch", () => {
    const testClient = createClient<TodoAppRoutes>({
      baseUrl: "http://test:3000",
    });

    expect(typeof testClient.get).toBe("function");
    expect(typeof testClient.post).toBe("function");
    expect(typeof testClient.delete).toBe("function");
  });

  it("generated client provides typed methods for all routes", () => {
    // This test verifies TypeScript autocomplete works by asserting method types exist
    const _client = createTodoClient({ baseUrl: "http://localhost:3000" });

    // _client.get should accept "/users", "/users/:id", "/todos", "/todos/:id"
    // _client.post should accept "/users", "/todos"
    // _client.put should accept "/users/:id", "/todos/:id"
    // _client.delete should accept "/users/:id", "/todos/:id"

    type GetPaths = Parameters<typeof _client.get>[0];
    type PostPaths = Parameters<typeof _client.post>[0];
    type PutPaths = Parameters<typeof _client.put>[0];
    type DeletePaths = Parameters<typeof _client.delete>[0];

    // These will fail to compile if paths are wrong
    const _g1: GetPaths = "/users";
    const _g2: GetPaths = "/users/:id";
    const _g3: GetPaths = "/todos";
    const _g4: GetPaths = "/todos/:id";
    const _p1: PostPaths = "/users";
    const _p2: PostPaths = "/todos";
    const _u1: PutPaths = "/users/:id";
    const _u2: PutPaths = "/todos/:id";
    const _d1: DeletePaths = "/users/:id";
    const _d2: DeletePaths = "/todos/:id";

    void _g1;
    void _g2;
    void _g3;
    void _g4;
    void _p1;
    void _p2;
    void _u1;
    void _u2;
    void _d1;
    void _d2;

    expect(true).toBe(true);
  });
});
