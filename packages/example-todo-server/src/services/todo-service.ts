// @typokit/example-todo-server — Todo Service (in-memory)

import type { PaginatedResponse } from "@typokit/types";
import type {
  Todo,
  PublicTodo,
  CreateTodoInput,
  UpdateTodoInput,
} from "@typokit/example-todo-schema";

const todos: Map<string, Todo> = new Map();
let counter = 0;

function generateId(): string {
  counter++;
  return `todo-${counter.toString().padStart(4, "0")}`;
}

function toPublic(todo: Todo): PublicTodo {
  return {
    id: todo.id,
    title: todo.title,
    description: todo.description,
    completed: todo.completed,
    userId: todo.userId,
    createdAt: todo.createdAt,
    updatedAt: todo.updatedAt,
  };
}

export interface ListTodosQuery {
  page?: number;
  pageSize?: number;
  userId?: string;
  completed?: boolean;
}

export function listTodos(
  query: ListTodosQuery = {},
): PaginatedResponse<PublicTodo> {
  const { page = 1, pageSize = 20, userId, completed } = query;

  let items = Array.from(todos.values());

  if (userId !== undefined) {
    items = items.filter((t) => t.userId === userId);
  }
  if (completed !== undefined) {
    items = items.filter((t) => t.completed === completed);
  }

  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  const data = items.slice(start, start + pageSize).map(toPublic);

  return {
    data,
    pagination: { total, page, pageSize, totalPages },
  };
}

export function getTodoById(id: string): PublicTodo | undefined {
  const todo = todos.get(id);
  return todo ? toPublic(todo) : undefined;
}

export function createTodo(input: CreateTodoInput): PublicTodo {
  const now = new Date();
  const todo: Todo = {
    id: generateId(),
    title: input.title,
    description: input.description,
    completed: input.completed ?? false,
    userId: input.userId,
    createdAt: now,
    updatedAt: now,
  };
  todos.set(todo.id, todo);
  return toPublic(todo);
}

export function updateTodo(
  id: string,
  input: UpdateTodoInput,
): PublicTodo | undefined {
  const todo = todos.get(id);
  if (!todo) return undefined;

  const now = new Date();
  const updated: Todo = {
    ...todo,
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.description !== undefined
      ? { description: input.description }
      : {}),
    ...(input.completed !== undefined ? { completed: input.completed } : {}),
    updatedAt: now,
  };
  todos.set(id, updated);
  return toPublic(updated);
}

export function deleteTodo(id: string): boolean {
  return todos.delete(id);
}

/** Reset store (for testing) */
export function resetTodos(): void {
  todos.clear();
  counter = 0;
}
