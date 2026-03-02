// @typokit/example-todo-schema — Reference app schema package

import type { RouteContract, PaginatedResponse } from "@typokit/types";

// ─── Re-exports from @typokit/types ──────────────────────────

export type { PaginatedResponse, ErrorResponse } from "@typokit/types";

// ─── Entity Types ────────────────────────────────────────────

/** @table users */
export interface User {
  /** @id @generated uuid */
  id: string;

  /** @format email @unique */
  email: string;

  /** @minLength 2 @maxLength 100 */
  displayName: string;

  /** @default "active" */
  status: "active" | "suspended" | "deleted";

  /** @generated now */
  createdAt: Date;

  /** @generated now @onUpdate now */
  updatedAt: Date;
}

/** @table todos */
export interface Todo {
  /** @id @generated uuid */
  id: string;

  /** @minLength 1 @maxLength 255 */
  title: string;

  /** Optional description */
  description?: string;

  /** @default false */
  completed: boolean;

  /** Foreign key to User.id */
  userId: string;

  /** @generated now */
  createdAt: Date;

  /** @generated now @onUpdate now */
  updatedAt: Date;
}

// ─── Derived Input / Output Types ────────────────────────────

/** Input for creating a new user (server-generated fields omitted) */
export interface CreateUserInput {
  /** @format email */
  email: string;

  /** @minLength 2 @maxLength 100 */
  displayName: string;

  /** @default "active" */
  status?: "active" | "suspended" | "deleted";
}

/** Input for updating an existing user (all fields optional) */
export interface UpdateUserInput {
  /** @format email */
  email?: string;

  /** @minLength 2 @maxLength 100 */
  displayName?: string;

  status?: "active" | "suspended" | "deleted";
}

/** Public-facing user (safe to return in API responses) */
export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  status: "active" | "suspended" | "deleted";
  createdAt: Date;
  updatedAt: Date;
}

/** Input for creating a new todo */
export interface CreateTodoInput {
  /** @minLength 1 @maxLength 255 */
  title: string;

  description?: string;

  /** @default false */
  completed?: boolean;

  userId: string;
}

/** Input for updating an existing todo */
export interface UpdateTodoInput {
  /** @minLength 1 @maxLength 255 */
  title?: string;

  description?: string;

  completed?: boolean;
}

/** Public-facing todo */
export interface PublicTodo {
  id: string;
  title: string;
  description?: string;
  completed: boolean;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Route Contracts ─────────────────────────────────────────

/** Users CRUD route contracts */
export interface UsersRoutes {
  "GET /users": RouteContract<
    void,
    { page?: number; pageSize?: number },
    void,
    PaginatedResponse<PublicUser>
  >;

  "POST /users": RouteContract<
    void,
    void,
    CreateUserInput,
    PublicUser
  >;

  "GET /users/:id": RouteContract<
    { id: string },
    void,
    void,
    PublicUser
  >;

  "PUT /users/:id": RouteContract<
    { id: string },
    void,
    UpdateUserInput,
    PublicUser
  >;

  "DELETE /users/:id": RouteContract<
    { id: string },
    void,
    void,
    void
  >;
}

/** Todos CRUD route contracts */
export interface TodosRoutes {
  "GET /todos": RouteContract<
    void,
    { page?: number; pageSize?: number; userId?: string; completed?: boolean },
    void,
    PaginatedResponse<PublicTodo>
  >;

  "POST /todos": RouteContract<
    void,
    void,
    CreateTodoInput,
    PublicTodo
  >;

  "GET /todos/:id": RouteContract<
    { id: string },
    void,
    void,
    PublicTodo
  >;

  "PUT /todos/:id": RouteContract<
    { id: string },
    void,
    UpdateTodoInput,
    PublicTodo
  >;

  "DELETE /todos/:id": RouteContract<
    { id: string },
    void,
    void,
    void
  >;
}
