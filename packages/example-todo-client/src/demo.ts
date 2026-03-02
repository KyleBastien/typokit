// @typokit/example-todo-client — Demo script showing typed client usage
//
// Usage: Start the example-todo-server, then run this script:
//   npx tsx packages/example-todo-client/src/demo.ts
//
// This script demonstrates full type-safe autocomplete on:
//   - Route paths
//   - Path parameters
//   - Query parameters
//   - Request bodies
//   - Response types

import { createTodoClient } from "./index.js";
import type { PublicUser, PublicTodo } from "./index.js";

const BASE_URL = (globalThis as unknown as { process: { env: Record<string, string | undefined> } })
  .process?.env?.["TODO_API_URL"] ?? "http://localhost:3000";

async function main() {
  const client = createTodoClient({ baseUrl: BASE_URL });

  console.log(`🔗 Connecting to ${BASE_URL}\n`);

  // ── Create a user (typed body: CreateUserInput) ──────────────
  console.log("📝 Creating user...");
  const newUser: PublicUser = await client.post("/users", {
    body: {
      email: "demo@example.com",
      displayName: "Demo User",
    },
  });
  console.log("  Created:", newUser.id, newUser.displayName);

  // ── List users (typed query: { page?, pageSize? }) ──────────
  console.log("\n📋 Listing users...");
  const usersPage = await client.get("/users", {
    query: { page: 1, pageSize: 5 },
  });
  console.log(`  Found ${usersPage.pagination.total} user(s), page ${usersPage.pagination.page}/${usersPage.pagination.totalPages}`);
  for (const u of usersPage.data) {
    console.log(`    - ${u.displayName} (${u.email})`);
  }

  // ── Get a single user (typed params: { id: string }) ────────
  console.log("\n🔍 Fetching user by ID...");
  const fetchedUser: PublicUser = await client.get("/users/:id", {
    params: { id: newUser.id },
  });
  console.log("  Found:", fetchedUser.displayName, fetchedUser.email);

  // ── Update user (typed params + body: UpdateUserInput) ──────
  console.log("\n✏️  Updating user...");
  const updatedUser: PublicUser = await client.put("/users/:id", {
    params: { id: newUser.id },
    body: { displayName: "Updated Demo User" },
  });
  console.log("  Updated:", updatedUser.displayName);

  // ── Create todos (typed body: CreateTodoInput) ──────────────
  console.log("\n📝 Creating todos...");
  const todo1: PublicTodo = await client.post("/todos", {
    body: {
      title: "Write documentation",
      description: "Complete the API docs",
      userId: newUser.id,
    },
  });
  console.log("  Created todo:", todo1.id, todo1.title);

  const todo2: PublicTodo = await client.post("/todos", {
    body: {
      title: "Review PR",
      userId: newUser.id,
    },
  });
  console.log("  Created todo:", todo2.id, todo2.title);

  // ── List todos with filters (typed query with userId, completed) ──
  console.log("\n📋 Listing todos for user...");
  const todosPage = await client.get("/todos", {
    query: { userId: newUser.id, completed: false, page: 1, pageSize: 10 },
  });
  console.log(`  Found ${todosPage.pagination.total} todo(s)`);
  for (const t of todosPage.data) {
    console.log(`    - [${t.completed ? "✅" : "⬜"}] ${t.title}`);
  }

  // ── Update todo (typed params + body: UpdateTodoInput) ──────
  console.log("\n✏️  Completing first todo...");
  const completedTodo: PublicTodo = await client.put("/todos/:id", {
    params: { id: todo1.id },
    body: { completed: true },
  });
  console.log("  Completed:", completedTodo.title, completedTodo.completed);

  // ── Get single todo (typed params: { id: string }) ──────────
  console.log("\n🔍 Fetching todo by ID...");
  const fetchedTodo: PublicTodo = await client.get("/todos/:id", {
    params: { id: todo2.id },
  });
  console.log("  Found:", fetchedTodo.title, "completed:", fetchedTodo.completed);

  // ── Delete todo (typed params: { id: string }) ──────────────
  console.log("\n🗑️  Deleting second todo...");
  await client.delete("/todos/:id", {
    params: { id: todo2.id },
  });
  console.log("  Deleted!");

  // ── Delete user ─────────────────────────────────────────────
  console.log("\n🗑️  Deleting user...");
  await client.delete("/users/:id", {
    params: { id: newUser.id },
  });
  console.log("  Deleted!");

  console.log("\n✅ Demo complete — all operations succeeded with full type safety!");
}

main().catch((err: unknown) => {
  console.error("Demo failed:", err);
  (globalThis as unknown as { process: { exit: (code: number) => void } }).process.exit(1);
});
