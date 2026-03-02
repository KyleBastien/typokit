// @typokit/example-todo-server — User Service (in-memory)

import type { PaginatedResponse } from "@typokit/types";
import type {
  User,
  PublicUser,
  CreateUserInput,
  UpdateUserInput,
} from "@typokit/example-todo-schema";

const users: Map<string, User> = new Map();
let counter = 0;

function generateId(): string {
  counter++;
  return `user-${counter.toString().padStart(4, "0")}`;
}

function toPublic(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export function listUsers(
  page: number = 1,
  pageSize: number = 20,
): PaginatedResponse<PublicUser> {
  const all = Array.from(users.values());
  const total = all.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  const data = all.slice(start, start + pageSize).map(toPublic);

  return {
    data,
    pagination: { total, page, pageSize, totalPages },
  };
}

export function getUserById(id: string): PublicUser | undefined {
  const user = users.get(id);
  return user ? toPublic(user) : undefined;
}

export function findUserByEmail(email: string): PublicUser | undefined {
  for (const user of users.values()) {
    if (user.email === email) {
      return toPublic(user);
    }
  }
  return undefined;
}

export function createUser(input: CreateUserInput): PublicUser {
  const now = new Date();
  const user: User = {
    id: generateId(),
    email: input.email,
    displayName: input.displayName,
    status: input.status ?? "active",
    createdAt: now,
    updatedAt: now,
  };
  users.set(user.id, user);
  return toPublic(user);
}

export function updateUser(
  id: string,
  input: UpdateUserInput,
): PublicUser | undefined {
  const user = users.get(id);
  if (!user) return undefined;

  const now = new Date();
  const updated: User = {
    ...user,
    ...(input.email !== undefined ? { email: input.email } : {}),
    ...(input.displayName !== undefined
      ? { displayName: input.displayName }
      : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    updatedAt: now,
  };
  users.set(id, updated);
  return toPublic(updated);
}

/** Reset store (for testing) */
export function resetUsers(): void {
  users.clear();
  counter = 0;
}
