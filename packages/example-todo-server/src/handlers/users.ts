// @typokit/example-todo-server — User Route Handlers

import type { HandlerInput } from "@typokit/core";
import type { UsersRoutes } from "@typokit/example-todo-schema";
import * as userService from "../services/user-service.js";

type H<K extends keyof UsersRoutes> = (
  input: HandlerInput<UsersRoutes[K]>,
) => Promise<UsersRoutes[K]["response"]>;

const handlers: { [K in keyof UsersRoutes]: H<K> } = {
  "GET /users": async ({ query }) => {
    const page = query?.page ?? 1;
    const pageSize = query?.pageSize ?? 20;
    return userService.listUsers(page, pageSize);
  },

  "POST /users": async ({ body, ctx }) => {
    // Check for duplicate email
    const existing = userService.findUserByEmail(body.email);
    if (existing) {
      ctx.fail(
        409,
        "USER_EMAIL_CONFLICT",
        `User with email ${body.email} already exists`,
      );
    }
    return userService.createUser(body);
  },

  "GET /users/:id": async ({ params, ctx }) => {
    const user = userService.getUserById(params.id);
    if (!user) {
      return ctx.fail(404, "USER_NOT_FOUND", `User ${params.id} not found`);
    }
    return user;
  },

  "PUT /users/:id": async ({ params, body, ctx }) => {
    // Check if user exists
    const existing = userService.getUserById(params.id);
    if (!existing) {
      return ctx.fail(404, "USER_NOT_FOUND", `User ${params.id} not found`);
    }

    // Check email uniqueness if changing email
    if (body.email !== undefined) {
      const duplicate = userService.findUserByEmail(body.email);
      if (duplicate && duplicate.id !== params.id) {
        return ctx.fail(
          409,
          "USER_EMAIL_CONFLICT",
          `User with email ${body.email} already exists`,
        );
      }
    }

    const updated = userService.updateUser(params.id, body);
    if (!updated) {
      return ctx.fail(404, "USER_NOT_FOUND", `User ${params.id} not found`);
    }
    return updated;
  },

  "DELETE /users/:id": async ({ params, ctx }) => {
    const existing = userService.getUserById(params.id);
    if (!existing) {
      ctx.fail(404, "USER_NOT_FOUND", `User ${params.id} not found`);
    }
    // Soft delete not implemented in schema — just remove from store
    userService.updateUser(params.id, { status: "deleted" });
    return undefined as unknown as void;
  },
};

export default handlers;
