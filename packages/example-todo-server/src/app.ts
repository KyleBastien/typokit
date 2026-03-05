// @typokit/example-todo-server — App Factory

import type {
  ServerAdapter,
  CreateAppOptions,
  TypoKitApp,
} from "@typokit/core";
import { createApp } from "@typokit/core";
import { requireAuth } from "./middleware/require-auth.js";
import userHandlers from "./handlers/users.js";
import todoHandlers from "./handlers/todos.js";

/**
 * Create the todo-server application.
 * Accepts a server adapter so the reference app is adapter-agnostic.
 */
export function createTodoApp(server: ServerAdapter): TypoKitApp {
  const options: CreateAppOptions = {
    server,
    middleware: [],
    routes: [
      {
        prefix: "/users",
        handlers: userHandlers as Record<string, unknown>,
        middleware: [
          // requireAuth on write operations
          {
            name: "requireAuth",
            middleware: requireAuth,
            priority: 0,
          },
        ],
      },
      {
        prefix: "/todos",
        handlers: todoHandlers as Record<string, unknown>,
        middleware: [
          {
            name: "requireAuth",
            middleware: requireAuth,
            priority: 0,
          },
        ],
      },
    ],
  };

  return createApp(options);
}
