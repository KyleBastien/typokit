// @typokit/example-todo-server — OpenAPI 3.1 Spec Generator
//
// Generates a valid OpenAPI 3.1.0 specification from the todo-app route contracts.
// Usage: npx tsx src/generate-openapi.ts [--output ./dist/openapi.json]

import type { ErrorResponse } from "@typokit/types";

// ─── JSON Schema Component Definitions ──────────────────────────

const PublicUserSchema = {
  type: "object" as const,
  properties: {
    id: { type: "string", format: "uuid" },
    email: { type: "string", format: "email" },
    displayName: { type: "string", minLength: 2, maxLength: 100 },
    status: { type: "string", enum: ["active", "suspended", "deleted"] },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
  required: ["id", "email", "displayName", "status", "createdAt", "updatedAt"],
};

const PublicTodoSchema = {
  type: "object" as const,
  properties: {
    id: { type: "string", format: "uuid" },
    title: { type: "string", minLength: 1, maxLength: 255 },
    description: { type: "string" },
    completed: { type: "boolean" },
    userId: { type: "string", format: "uuid" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
  required: ["id", "title", "completed", "userId", "createdAt", "updatedAt"],
};

const CreateUserInputSchema = {
  type: "object" as const,
  properties: {
    email: { type: "string", format: "email" },
    displayName: { type: "string", minLength: 2, maxLength: 100 },
    status: { type: "string", enum: ["active", "suspended", "deleted"] },
  },
  required: ["email", "displayName"],
};

const UpdateUserInputSchema = {
  type: "object" as const,
  properties: {
    email: { type: "string", format: "email" },
    displayName: { type: "string", minLength: 2, maxLength: 100 },
    status: { type: "string", enum: ["active", "suspended", "deleted"] },
  },
};

const CreateTodoInputSchema = {
  type: "object" as const,
  properties: {
    title: { type: "string", minLength: 1, maxLength: 255 },
    description: { type: "string" },
    completed: { type: "boolean" },
    userId: { type: "string", format: "uuid" },
  },
  required: ["title", "userId"],
};

const UpdateTodoInputSchema = {
  type: "object" as const,
  properties: {
    title: { type: "string", minLength: 1, maxLength: 255 },
    description: { type: "string" },
    completed: { type: "boolean" },
  },
};

const ErrorResponseSchema = {
  type: "object" as const,
  properties: {
    code: { type: "string" },
    status: { type: "integer" },
    message: { type: "string" },
    details: {},
  },
  required: ["code", "status", "message"],
};

const PaginationSchema = {
  type: "object" as const,
  properties: {
    total: { type: "integer" },
    page: { type: "integer" },
    pageSize: { type: "integer" },
    totalPages: { type: "integer" },
  },
  required: ["total", "page", "pageSize", "totalPages"],
};

function paginatedResponseOf(itemRef: string) {
  return {
    type: "object" as const,
    properties: {
      data: {
        type: "array",
        items: { $ref: `#/components/schemas/${itemRef}` },
      },
      pagination: { $ref: "#/components/schemas/Pagination" },
    },
    required: ["data", "pagination"],
  };
}

// ─── Error Response Helpers ─────────────────────────────────────

function errorResponse(description: string) {
  return {
    description,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/ErrorResponse" },
      },
    },
  };
}

// ─── OpenAPI Spec Builder ───────────────────────────────────────

export function generateOpenApiSpec(): Record<string, unknown> {
  // Force the variable to be used for the linter
  const _errorResponseType: ErrorResponse | undefined = undefined;
  void _errorResponseType;

  const spec = {
    openapi: "3.1.0",
    info: {
      title: "TypoKit Todo App API",
      description:
        "Reference Todo application built with the TypoKit framework. Demonstrates typed route contracts, validation, and OpenAPI generation.",
      version: "0.1.0",
      contact: {
        name: "TypoKit",
      },
    },
    servers: [
      {
        url: "http://localhost:3000",
        description: "Local development server",
      },
    ],
    paths: {
      // ─── Users ────────────────────────────────────────
      "/users": {
        get: {
          summary: "List users",
          operationId: "listUsers",
          tags: ["Users"],
          parameters: [
            {
              name: "page",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 1 },
            },
            {
              name: "pageSize",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 1 },
            },
          ],
          responses: {
            "200": {
              description: "Paginated list of users",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/PaginatedPublicUserResponse",
                  },
                },
              },
            },
            "401": errorResponse("Unauthorized"),
            "500": errorResponse("Internal server error"),
          },
        },
        post: {
          summary: "Create a user",
          operationId: "createUser",
          tags: ["Users"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateUserInput" },
              },
            },
          },
          responses: {
            "201": {
              description: "User created",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PublicUser" },
                },
              },
            },
            "400": errorResponse("Validation error"),
            "401": errorResponse("Unauthorized"),
            "409": errorResponse("Conflict — email already exists"),
            "500": errorResponse("Internal server error"),
          },
        },
      },
      "/users/{id}": {
        get: {
          summary: "Get a user by ID",
          operationId: "getUser",
          tags: ["Users"],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "200": {
              description: "User found",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PublicUser" },
                },
              },
            },
            "401": errorResponse("Unauthorized"),
            "404": errorResponse("User not found"),
            "500": errorResponse("Internal server error"),
          },
        },
        put: {
          summary: "Update a user",
          operationId: "updateUser",
          tags: ["Users"],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/UpdateUserInput" },
              },
            },
          },
          responses: {
            "200": {
              description: "User updated",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PublicUser" },
                },
              },
            },
            "400": errorResponse("Validation error"),
            "401": errorResponse("Unauthorized"),
            "404": errorResponse("User not found"),
            "500": errorResponse("Internal server error"),
          },
        },
        delete: {
          summary: "Delete a user",
          operationId: "deleteUser",
          tags: ["Users"],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "204": { description: "User deleted" },
            "401": errorResponse("Unauthorized"),
            "404": errorResponse("User not found"),
            "500": errorResponse("Internal server error"),
          },
        },
      },

      // ─── Todos ────────────────────────────────────────
      "/todos": {
        get: {
          summary: "List todos",
          operationId: "listTodos",
          tags: ["Todos"],
          parameters: [
            {
              name: "page",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 1 },
            },
            {
              name: "pageSize",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 1 },
            },
            {
              name: "userId",
              in: "query",
              required: false,
              schema: { type: "string", format: "uuid" },
            },
            {
              name: "completed",
              in: "query",
              required: false,
              schema: { type: "boolean" },
            },
          ],
          responses: {
            "200": {
              description: "Paginated list of todos",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/PaginatedPublicTodoResponse",
                  },
                },
              },
            },
            "401": errorResponse("Unauthorized"),
            "500": errorResponse("Internal server error"),
          },
        },
        post: {
          summary: "Create a todo",
          operationId: "createTodo",
          tags: ["Todos"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateTodoInput" },
              },
            },
          },
          responses: {
            "201": {
              description: "Todo created",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PublicTodo" },
                },
              },
            },
            "400": errorResponse("Validation error"),
            "401": errorResponse("Unauthorized"),
            "500": errorResponse("Internal server error"),
          },
        },
      },
      "/todos/{id}": {
        get: {
          summary: "Get a todo by ID",
          operationId: "getTodo",
          tags: ["Todos"],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "200": {
              description: "Todo found",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PublicTodo" },
                },
              },
            },
            "401": errorResponse("Unauthorized"),
            "404": errorResponse("Todo not found"),
            "500": errorResponse("Internal server error"),
          },
        },
        put: {
          summary: "Update a todo",
          operationId: "updateTodo",
          tags: ["Todos"],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/UpdateTodoInput" },
              },
            },
          },
          responses: {
            "200": {
              description: "Todo updated",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PublicTodo" },
                },
              },
            },
            "400": errorResponse("Validation error"),
            "401": errorResponse("Unauthorized"),
            "404": errorResponse("Todo not found"),
            "500": errorResponse("Internal server error"),
          },
        },
        delete: {
          summary: "Delete a todo",
          operationId: "deleteTodo",
          tags: ["Todos"],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "204": { description: "Todo deleted" },
            "401": errorResponse("Unauthorized"),
            "404": errorResponse("Todo not found"),
            "500": errorResponse("Internal server error"),
          },
        },
      },
    },
    components: {
      schemas: {
        PublicUser: PublicUserSchema,
        PublicTodo: PublicTodoSchema,
        CreateUserInput: CreateUserInputSchema,
        UpdateUserInput: UpdateUserInputSchema,
        CreateTodoInput: CreateTodoInputSchema,
        UpdateTodoInput: UpdateTodoInputSchema,
        ErrorResponse: ErrorResponseSchema,
        Pagination: PaginationSchema,
        PaginatedPublicUserResponse: paginatedResponseOf("PublicUser"),
        PaginatedPublicTodoResponse: paginatedResponseOf("PublicTodo"),
      },
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
    tags: [
      { name: "Users", description: "User management operations" },
      { name: "Todos", description: "Todo management operations" },
    ],
  };

  return spec;
}

// ─── CLI entry point ────────────────────────────────────────────

async function main() {
  const args = (globalThis as Record<string, unknown>)["process"] as
    | { argv: string[] }
    | undefined;
  const argv = args?.argv ?? [];

  let outputPath = "./dist/openapi.json";
  const outputIdx = argv.indexOf("--output");
  if (outputIdx !== -1 && argv[outputIdx + 1]) {
    outputPath = argv[outputIdx + 1];
  }

  const spec = generateOpenApiSpec();
  const json = JSON.stringify(spec, null, 2);

  // Dynamic import for Node.js fs/path (no @types/node in main deps)
  const fs = await import("node:fs");
  const path = await import("node:path");

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(outputPath, json + "\n", "utf-8");

  const proc = (globalThis as Record<string, unknown>)["process"] as
    | { stdout: { write: (s: string) => void } }
    | undefined;
  proc?.stdout.write(`OpenAPI spec written to ${outputPath}\n`);
}

main().catch((err: unknown) => {
  const proc = (globalThis as Record<string, unknown>)["process"] as
    | { stderr: { write: (s: string) => void }; exit: (c: number) => void }
    | undefined;
  proc?.stderr.write(`Error: ${String(err)}\n`);
  proc?.exit(1);
});
