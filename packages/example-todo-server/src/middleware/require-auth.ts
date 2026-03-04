// @typokit/example-todo-server — Auth Middleware

import { defineMiddleware } from "@typokit/core";

/** Context properties added by requireAuth middleware */
export interface AuthContext {
  [key: string]: unknown;
  userId: string;
  userRole: "user" | "admin";
}

/**
 * Middleware that checks for an Authorization header and narrows
 * the context type to include userId and userRole.
 * Demonstrates context type narrowing with defineMiddleware.
 */
export const requireAuth = defineMiddleware<AuthContext>(async ({ headers, ctx }) => {
  const authHeader = headers["authorization"];
  const token = typeof authHeader === "string" ? authHeader : undefined;

  if (!token || !token.startsWith("Bearer ")) {
    return ctx.fail(401, "UNAUTHORIZED", "Missing or invalid authorization header");
  }

  // Demo: extract user info from token (in real app, validate JWT)
  const payload = token.slice(7); // strip "Bearer "
  const parts = payload.split(":");
  const userId = parts[0] ?? "unknown";
  const userRole = parts[1] === "admin" ? "admin" as const : "user" as const;

  return { userId, userRole };
});
