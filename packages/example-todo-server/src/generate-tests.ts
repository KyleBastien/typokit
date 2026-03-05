// @typokit/example-todo-server — Contract Test Generator
//
// Demonstrates using generateContractTests() from @typokit/testing
// to produce contract test files for all routes.
//
// Usage: build the project first, then run:
//   node dist/generate-tests.js

import type { SchemaTypeMap, HttpMethod } from "@typokit/types";
import type { ContractTestRoute } from "@typokit/testing";
import { generateContractTests } from "@typokit/testing";

// ─── Route Definitions ───────────────────────────────────────

const routes: ContractTestRoute[] = [
  // Users
  { method: "GET" as HttpMethod, path: "/users", handlerRef: "users#list" },
  {
    method: "POST" as HttpMethod,
    path: "/users",
    handlerRef: "users#create",
    validators: { body: "CreateUserInput" },
    expectedStatus: 201,
  },
  { method: "GET" as HttpMethod, path: "/users/:id", handlerRef: "users#get" },
  {
    method: "PUT" as HttpMethod,
    path: "/users/:id",
    handlerRef: "users#update",
    validators: { body: "UpdateUserInput" },
  },
  {
    method: "DELETE" as HttpMethod,
    path: "/users/:id",
    handlerRef: "users#delete",
  },
  // Todos
  { method: "GET" as HttpMethod, path: "/todos", handlerRef: "todos#list" },
  {
    method: "POST" as HttpMethod,
    path: "/todos",
    handlerRef: "todos#create",
    validators: { body: "CreateTodoInput" },
    expectedStatus: 201,
  },
  { method: "GET" as HttpMethod, path: "/todos/:id", handlerRef: "todos#get" },
  {
    method: "PUT" as HttpMethod,
    path: "/todos/:id",
    handlerRef: "todos#update",
    validators: { body: "UpdateTodoInput" },
  },
  {
    method: "DELETE" as HttpMethod,
    path: "/todos/:id",
    handlerRef: "todos#delete",
  },
];

// ─── Schema Definitions ──────────────────────────────────────

const schemas: SchemaTypeMap = {
  CreateUserInput: {
    name: "CreateUserInput",
    properties: {
      email: { type: "string", optional: false, jsdoc: { format: "email" } },
      displayName: {
        type: "string",
        optional: false,
        jsdoc: { minLength: "2", maxLength: "100" },
      },
    },
  },
  UpdateUserInput: {
    name: "UpdateUserInput",
    properties: {
      email: { type: "string", optional: true, jsdoc: { format: "email" } },
      displayName: {
        type: "string",
        optional: true,
        jsdoc: { minLength: "2", maxLength: "100" },
      },
      status: { type: '"active" | "suspended" | "deleted"', optional: true },
    },
  },
  CreateTodoInput: {
    name: "CreateTodoInput",
    properties: {
      title: {
        type: "string",
        optional: false,
        jsdoc: { minLength: "1", maxLength: "255" },
      },
      userId: { type: "string", optional: false },
    },
  },
  UpdateTodoInput: {
    name: "UpdateTodoInput",
    properties: {
      title: {
        type: "string",
        optional: true,
        jsdoc: { minLength: "1", maxLength: "255" },
      },
      description: { type: "string", optional: true },
      completed: { type: "boolean", optional: true },
    },
  },
};

// ─── Generate ────────────────────────────────────────────────

const outputs = generateContractTests({
  runner: "rstest",
  appImport: "../test-app",
  routes,
  schemas,
});

for (const output of outputs) {
  console.log(`Generated: ${output.filePath}`);
  console.log(output.content);
  console.log("---");
}
