// @typokit/example-todo-server — Todo Route Handlers

import type { HandlerInput } from "@typokit/core";
import type { TodosRoutes } from "@typokit/example-todo-schema";
import * as todoService from "../services/todo-service.js";
import * as userService from "../services/user-service.js";

type H<K extends keyof TodosRoutes> = (
  input: HandlerInput<TodosRoutes[K]>,
) => Promise<TodosRoutes[K]["response"]>;

const handlers: { [K in keyof TodosRoutes]: H<K> } = {
  "GET /todos": async ({ query }) => {
    return todoService.listTodos({
      page: query?.page ?? 1,
      pageSize: query?.pageSize ?? 20,
      userId: query?.userId,
      completed: query?.completed,
    });
  },

  "POST /todos": async ({ body, ctx }) => {
    // Validate that the referenced user exists
    const user = userService.getUserById(body.userId);
    if (!user) {
      ctx.fail(400, "INVALID_USER_ID", `User ${body.userId} does not exist`);
    }
    return todoService.createTodo(body);
  },

  "GET /todos/:id": async ({ params, ctx }) => {
    const todo = todoService.getTodoById(params.id);
    if (!todo) {
      return ctx.fail(404, "TODO_NOT_FOUND", `Todo ${params.id} not found`);
    }
    return todo;
  },

  "PUT /todos/:id": async ({ params, body, ctx }) => {
    const existing = todoService.getTodoById(params.id);
    if (!existing) {
      return ctx.fail(404, "TODO_NOT_FOUND", `Todo ${params.id} not found`);
    }
    const updated = todoService.updateTodo(params.id, body);
    if (!updated) {
      return ctx.fail(404, "TODO_NOT_FOUND", `Todo ${params.id} not found`);
    }
    return updated;
  },

  "DELETE /todos/:id": async ({ params, ctx }) => {
    const existing = todoService.getTodoById(params.id);
    if (!existing) {
      ctx.fail(404, "TODO_NOT_FOUND", `Todo ${params.id} not found`);
    }
    todoService.deleteTodo(params.id);
    return undefined as unknown as void;
  },
};

export default handlers;
