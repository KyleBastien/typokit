// Database seeding script with sample users and todos
import type { InferInsertModel } from "drizzle-orm";
import type { users, todos } from "./schema.js";

type NewUser = InferInsertModel<typeof users>;
type NewTodo = InferInsertModel<typeof todos>;

function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function now(): string {
  return new Date().toISOString();
}

export function getSeedUsers(): NewUser[] {
  const timestamp = now();
  return [
    {
      id: uuid(),
      email: "alice@example.com",
      displayName: "Alice Johnson",
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: uuid(),
      email: "bob@example.com",
      displayName: "Bob Smith",
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: uuid(),
      email: "charlie@example.com",
      displayName: "Charlie Brown",
      status: "suspended",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];
}

export function getSeedTodos(userIds: string[]): NewTodo[] {
  const timestamp = now();
  return [
    {
      id: uuid(),
      title: "Set up project structure",
      description: "Initialize the monorepo with Nx and configure packages",
      completed: true,
      userId: userIds[0],
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: uuid(),
      title: "Write database layer",
      description: "Create Drizzle schema and repository functions",
      completed: false,
      userId: userIds[0],
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: uuid(),
      title: "Review pull requests",
      description: null,
      completed: false,
      userId: userIds[1],
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: uuid(),
      title: "Update documentation",
      description: "Add API reference docs for new endpoints",
      completed: false,
      userId: userIds[1],
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: uuid(),
      title: "Fix login bug",
      description: "Users see a blank page on expired session",
      completed: true,
      userId: userIds[2],
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];
}
