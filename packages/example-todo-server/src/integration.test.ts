// @typokit/example-todo-server — Integration Tests
//
// Full CRUD workflow: create user → create todo → list todos by user → update todo → delete todo
// Uses createIntegrationSuite() with in-memory database and test factories.

import { describe, it, expect } from "@rstest/core";
import { createIntegrationSuite, createFactory } from "@typokit/testing";
import type { TypeMetadata } from "@typokit/types";
import { createTestTodoApp, resetStore } from "./test-app.js";

// ─── Schema Metadata for Test Factories ──────────────────────

const createUserMetadata: TypeMetadata = {
  name: "CreateUserInput",
  properties: {
    email: { type: "string", optional: false, jsdoc: { format: "email" } },
    displayName: { type: "string", optional: false, jsdoc: { minLength: "2", maxLength: "100" } },
  },
};

const createTodoMetadata: TypeMetadata = {
  name: "CreateTodoInput",
  properties: {
    title: { type: "string", optional: false, jsdoc: { minLength: "1", maxLength: "255" } },
    userId: { type: "string", optional: false },
  },
};

// ─── Test Factories ──────────────────────────────────────────

interface UserInput {
  email: string;
  displayName: string;
}

interface TodoInput {
  title: string;
  userId: string;
}

const userFactory = createFactory<UserInput>(createUserMetadata, { seed: 42 });
const todoFactory = createFactory<TodoInput>(createTodoMetadata, { seed: 43 });

// ─── Integration Tests ──────────────────────────────────────

describe("Integration: User → Todo CRUD workflow", () => {
  const app = createTestTodoApp();
  const suite = createIntegrationSuite(app, { database: true });

  it("completes full workflow: create user → create todo → list → update → delete", async () => {
    await suite.setup();
    try {
      resetStore();

      // Store test data in the in-memory database for tracking
      const db = suite.db!;

      // 1. Create a user using factory data
      const userData = userFactory.build();
      const createUserRes = await suite.client.post("/users", {
        body: userData,
      });
      expect(createUserRes.status).toBe(201);
      const user = createUserRes.body as {
        id: string;
        email: string;
        displayName: string;
        status: string;
      };
      expect(user.email).toBe(userData.email);
      expect(user.displayName).toBe(userData.displayName);
      expect(user.id).toBeDefined();
      expect(user.status).toBe("active");

      // Track in in-memory database
      db.insert("users", { id: user.id, email: user.email });

      // 2. Create a todo for the user
      const todoData = todoFactory.build({ userId: user.id });
      const createTodoRes = await suite.client.post("/todos", {
        body: todoData,
      });
      expect(createTodoRes.status).toBe(201);
      const todo = createTodoRes.body as {
        id: string;
        title: string;
        userId: string;
        completed: boolean;
      };
      expect(todo.title).toBe(todoData.title);
      expect(todo.userId).toBe(user.id);
      expect(todo.completed).toBe(false);

      // Track in in-memory database
      db.insert("todos", { id: todo.id, title: todo.title, userId: user.id });

      // 3. List todos filtered by user
      const listRes = await suite.client.get("/todos", {
        query: { userId: user.id },
      });
      expect(listRes.status).toBe(200);
      const listBody = listRes.body as {
        data: Array<{ id: string; userId: string }>;
        pagination: { total: number };
      };
      expect(listBody.data.length).toBe(1);
      expect(listBody.data[0].id).toBe(todo.id);
      expect(listBody.data[0].userId).toBe(user.id);
      expect(listBody.pagination.total).toBe(1);

      // Verify tracking matches
      expect(db.findAll("todos")).toHaveLength(1);

      // 4. Update the todo
      const updateRes = await suite.client.put(`/todos/${todo.id}`, {
        body: { completed: true, title: "Updated Title" },
      });
      expect(updateRes.status).toBe(200);
      const updatedTodo = updateRes.body as {
        id: string;
        title: string;
        completed: boolean;
      };
      expect(updatedTodo.completed).toBe(true);
      expect(updatedTodo.title).toBe("Updated Title");

      // 5. Delete the todo
      const deleteRes = await suite.client.delete(`/todos/${todo.id}`);
      expect(deleteRes.status).toBe(204);

      // 6. Verify deletion — todo should return 404
      const getDeletedRes = await suite.client.get(`/todos/${todo.id}`);
      expect(getDeletedRes.status).toBe(404);

      // Verify list is now empty for this user
      const emptyListRes = await suite.client.get("/todos", {
        query: { userId: user.id },
      });
      const emptyBody = emptyListRes.body as {
        data: unknown[];
        pagination: { total: number };
      };
      expect(emptyBody.data.length).toBe(0);
      expect(emptyBody.pagination.total).toBe(0);
    } finally {
      await suite.teardown();
    }
  });

  it("creates multiple todos and lists them", async () => {
    const app2 = createTestTodoApp();
    const suite2 = createIntegrationSuite(app2, { database: true });
    await suite2.setup();
    try {
      resetStore();

      // Create a user
      const userData = userFactory.build();
      const userRes = await suite2.client.post("/users", { body: userData });
      const user = userRes.body as { id: string };

      // Create multiple todos
      const titles = ["Buy groceries", "Clean house", "Read book"];
      for (const title of titles) {
        const res = await suite2.client.post("/todos", {
          body: { title, userId: user.id },
        });
        expect(res.status).toBe(201);

        // Track in suite database
        suite2.db!.insert("todos", { title, userId: user.id });
      }

      // List all todos
      const listRes = await suite2.client.get("/todos");
      const body = listRes.body as {
        data: Array<{ title: string }>;
        pagination: { total: number };
      };
      expect(body.pagination.total).toBe(3);
      expect(body.data.length).toBe(3);

      // Verify in-memory db tracking
      expect(suite2.db!.findAll("todos")).toHaveLength(3);
    } finally {
      await suite2.teardown();
    }
  });

  it("handles user conflict on duplicate email", async () => {
    const app3 = createTestTodoApp();
    const suite3 = createIntegrationSuite(app3, { database: true });
    await suite3.setup();
    try {
      resetStore();

      const userData = userFactory.build();

      // Create first user
      const res1 = await suite3.client.post("/users", { body: userData });
      expect(res1.status).toBe(201);

      // Attempt duplicate
      const res2 = await suite3.client.post("/users", { body: userData });
      expect(res2.status).toBe(409);
    } finally {
      await suite3.teardown();
    }
  });
});
