// @typokit/example-todo-server — OpenAPI Spec Validation Tests

import { describe, it, expect } from "@rstest/core";
import { generateOpenApiSpec } from "./generate-openapi.js";

describe("generateOpenApiSpec", () => {
  const spec = generateOpenApiSpec() as Record<string, unknown>;

  it("should produce a valid OpenAPI 3.1.0 version", () => {
    expect(spec["openapi"]).toBe("3.1.0");
  });

  it("should have info with title and version", () => {
    const info = spec["info"] as Record<string, unknown>;
    expect(info["title"]).toBe("TypoKit Todo App API");
    expect(info["version"]).toBe("0.1.0");
  });

  it("should include all user routes", () => {
    const paths = spec["paths"] as Record<string, unknown>;
    expect(paths["/users"]).toBeDefined();
    expect(paths["/users/{id}"]).toBeDefined();

    const users = paths["/users"] as Record<string, unknown>;
    expect(users["get"]).toBeDefined();
    expect(users["post"]).toBeDefined();

    const usersById = paths["/users/{id}"] as Record<string, unknown>;
    expect(usersById["get"]).toBeDefined();
    expect(usersById["put"]).toBeDefined();
    expect(usersById["delete"]).toBeDefined();
  });

  it("should include all todo routes", () => {
    const paths = spec["paths"] as Record<string, unknown>;
    expect(paths["/todos"]).toBeDefined();
    expect(paths["/todos/{id}"]).toBeDefined();

    const todos = paths["/todos"] as Record<string, unknown>;
    expect(todos["get"]).toBeDefined();
    expect(todos["post"]).toBeDefined();

    const todosById = paths["/todos/{id}"] as Record<string, unknown>;
    expect(todosById["get"]).toBeDefined();
    expect(todosById["put"]).toBeDefined();
    expect(todosById["delete"]).toBeDefined();
  });

  it("should define all component schemas", () => {
    const components = spec["components"] as Record<string, unknown>;
    const schemas = components["schemas"] as Record<string, unknown>;

    expect(schemas["PublicUser"]).toBeDefined();
    expect(schemas["PublicTodo"]).toBeDefined();
    expect(schemas["CreateUserInput"]).toBeDefined();
    expect(schemas["UpdateUserInput"]).toBeDefined();
    expect(schemas["CreateTodoInput"]).toBeDefined();
    expect(schemas["UpdateTodoInput"]).toBeDefined();
    expect(schemas["ErrorResponse"]).toBeDefined();
    expect(schemas["Pagination"]).toBeDefined();
    expect(schemas["PaginatedPublicUserResponse"]).toBeDefined();
    expect(schemas["PaginatedPublicTodoResponse"]).toBeDefined();
  });

  it("should include error responses on routes", () => {
    const paths = spec["paths"] as Record<
      string,
      Record<string, Record<string, Record<string, unknown>>>
    >;
    const getUser = paths["/users/{id}"]["get"];
    const responses = getUser["responses"] as Record<string, unknown>;

    expect(responses["200"]).toBeDefined();
    expect(responses["401"]).toBeDefined();
    expect(responses["404"]).toBeDefined();
    expect(responses["500"]).toBeDefined();
  });

  it("should use $ref for schema references", () => {
    const paths = spec["paths"] as Record<
      string,
      Record<string, Record<string, Record<string, unknown>>>
    >;
    const postUser = paths["/users"]["post"];
    const body = postUser["requestBody"] as Record<
      string,
      Record<string, Record<string, Record<string, string>>>
    >;
    const schema = body["content"]["application/json"]["schema"];
    expect(schema["$ref"]).toBe("#/components/schemas/CreateUserInput");
  });

  it("should include path parameters for parameterized routes", () => {
    const paths = spec["paths"] as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    const getUserById = paths["/users/{id}"]["get"];
    const params = getUserById["parameters"] as Array<Record<string, unknown>>;

    expect(params.length).toBe(1);
    expect(params[0]["name"]).toBe("id");
    expect(params[0]["in"]).toBe("path");
    expect(params[0]["required"]).toBe(true);
  });

  it("should include query parameters for list routes", () => {
    const paths = spec["paths"] as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    const listTodos = paths["/todos"]["get"];
    const params = listTodos["parameters"] as Array<Record<string, unknown>>;

    // page, pageSize, userId, completed
    expect(params.length).toBe(4);
    const names = params.map((p) => p["name"]);
    expect(names).toContain("page");
    expect(names).toContain("pageSize");
    expect(names).toContain("userId");
    expect(names).toContain("completed");
  });

  it("should have tags for Users and Todos", () => {
    const tags = spec["tags"] as Array<Record<string, string>>;
    const tagNames = tags.map((t) => t["name"]);
    expect(tagNames).toContain("Users");
    expect(tagNames).toContain("Todos");
  });

  it("should have a server entry", () => {
    const servers = spec["servers"] as Array<Record<string, string>>;
    expect(servers.length).toBeGreaterThan(0);
    expect(servers[0]["url"]).toBeDefined();
  });

  it("should have security scheme defined", () => {
    const components = spec["components"] as Record<
      string,
      Record<string, Record<string, string>>
    >;
    const schemes = components["securitySchemes"];
    expect(schemes["bearerAuth"]).toBeDefined();
    expect(schemes["bearerAuth"]["type"]).toBe("http");
    expect(schemes["bearerAuth"]["scheme"]).toBe("bearer");
  });

  it("should have paginated response schemas with $ref to items", () => {
    const components = spec["components"] as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    const schemas = components["schemas"];
    const paginatedUsers = schemas["PaginatedPublicUserResponse"] as Record<
      string,
      unknown
    >;
    const props = paginatedUsers["properties"] as Record<
      string,
      Record<string, unknown>
    >;
    const dataItems = props["data"]["items"] as Record<string, string>;
    expect(dataItems["$ref"]).toBe("#/components/schemas/PublicUser");
  });

  it("should have required fields on PublicUser schema", () => {
    const components = spec["components"] as Record<
      string,
      Record<string, unknown>
    >;
    const schemas = components["schemas"] as Record<
      string,
      Record<string, unknown>
    >;
    const user = schemas["PublicUser"];
    const required = user["required"] as string[];
    expect(required).toContain("id");
    expect(required).toContain("email");
    expect(required).toContain("displayName");
    expect(required).toContain("status");
  });

  it("should have format constraints on schema properties", () => {
    const components = spec["components"] as Record<
      string,
      Record<string, unknown>
    >;
    const schemas = components["schemas"] as Record<
      string,
      Record<string, Record<string, Record<string, string>>>
    >;
    const createUser = schemas["CreateUserInput"];
    expect(createUser["properties"]["email"]["format"]).toBe("email");
  });
});
