import { describe, it, expect } from "@rstest/core";
import { parseAndExtractTypes, compileRoutes, generateOpenApi, diffSchemas, generateTestStubs, prepareValidatorInputs, collectValidatorOutputs } from "./index.js";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

// Helper to create a temporary TypeScript file
function createTempTsFile(content: string): string {
  const tmpDir = os.tmpdir();
  const filePath = path.join(tmpDir, `typokit-test-${Date.now()}-${Math.random().toString(36).slice(2)}.ts`);
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

// Helper to clean up a temporary file
function cleanupFile(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // ignore cleanup errors
  }
}

describe("parseAndExtractTypes", () => {
  it("should parse a simple User interface with JSDoc tags", async () => {
    const source = `
/**
 * @table users
 */
interface User {
  /** @id @generated */
  id: string;
  /** @format email @unique */
  email: string;
  /** @minLength 2 @maxLength 100 */
  name: string;
  age: number;
  active: boolean;
  bio?: string;
  /** @default now() @onUpdate now() */
  updatedAt: string;
}
`;
    const filePath = createTempTsFile(source);
    try {
      const result = await parseAndExtractTypes([filePath]);

      expect(result).toBeDefined();
      expect(result["User"]).toBeDefined();
      expect(result["User"].name).toBe("User");

      // Check properties exist
      const props = result["User"].properties;
      expect(props["id"]).toBeDefined();
      expect(props["email"]).toBeDefined();
      expect(props["name"]).toBeDefined();
      expect(props["age"]).toBeDefined();
      expect(props["active"]).toBeDefined();
      expect(props["bio"]).toBeDefined();
      expect(props["updatedAt"]).toBeDefined();

      // Check types
      expect(props["id"].type).toBe("string");
      expect(props["email"].type).toBe("string");
      expect(props["name"].type).toBe("string");
      expect(props["age"].type).toBe("number");
      expect(props["active"].type).toBe("boolean");
      expect(props["bio"].type).toBe("string");

      // Check optionality
      expect(props["id"].optional).toBe(false);
      expect(props["bio"].optional).toBe(true);
    } finally {
      cleanupFile(filePath);
    }
  });

  it("should parse exported interfaces", async () => {
    const source = `
export interface Post {
  id: string;
  title: string;
  content: string;
  published: boolean;
}
`;
    const filePath = createTempTsFile(source);
    try {
      const result = await parseAndExtractTypes([filePath]);

      expect(result["Post"]).toBeDefined();
      expect(result["Post"].name).toBe("Post");
      expect(Object.keys(result["Post"].properties).length).toBe(4);
      expect(result["Post"].properties["title"].type).toBe("string");
    } finally {
      cleanupFile(filePath);
    }
  });

  it("should parse complex types including arrays and unions", async () => {
    const source = `
interface Product {
  id: string;
  tags: string[];
  status: "active" | "inactive" | "draft";
  metadata?: Record<string, unknown>;
}
`;
    const filePath = createTempTsFile(source);
    try {
      const result = await parseAndExtractTypes([filePath]);

      expect(result["Product"]).toBeDefined();
      const props = result["Product"].properties;
      expect(props["tags"].type).toBe("string[]");
      expect(props["status"].type).toBe("\"active\" | \"inactive\" | \"draft\"");
      expect(props["metadata"].type).toBe("Record<string, unknown>");
      expect(props["metadata"].optional).toBe(true);
    } finally {
      cleanupFile(filePath);
    }
  });

  it("should parse multiple interfaces from a single file", async () => {
    const source = `
interface User {
  id: string;
  name: string;
}

interface Post {
  id: string;
  authorId: string;
  title: string;
}

interface Comment {
  id: string;
  postId: string;
  body: string;
}
`;
    const filePath = createTempTsFile(source);
    try {
      const result = await parseAndExtractTypes([filePath]);

      expect(Object.keys(result).length).toBe(3);
      expect(result["User"]).toBeDefined();
      expect(result["Post"]).toBeDefined();
      expect(result["Comment"]).toBeDefined();
    } finally {
      cleanupFile(filePath);
    }
  });

  it("should parse multiple files", async () => {
    const source1 = `
interface User {
  id: string;
  name: string;
}
`;
    const source2 = `
interface Post {
  id: string;
  title: string;
}
`;
    const file1 = createTempTsFile(source1);
    const file2 = createTempTsFile(source2);
    try {
      const result = await parseAndExtractTypes([file1, file2]);

      expect(result["User"]).toBeDefined();
      expect(result["Post"]).toBeDefined();
    } finally {
      cleanupFile(file1);
      cleanupFile(file2);
    }
  });

  it("should return SchemaTypeMap-compatible shape", async () => {
    const source = `
interface Task {
  id: string;
  title: string;
  done: boolean;
}
`;
    const filePath = createTempTsFile(source);
    try {
      const result = await parseAndExtractTypes([filePath]);

      // Verify the result shape matches SchemaTypeMap = Record<string, TypeMetadata>
      const task = result["Task"];
      expect(typeof task.name).toBe("string");
      expect(typeof task.properties).toBe("object");

      // Verify property shape matches { type: string; optional: boolean }
      const idProp = task.properties["id"];
      expect(typeof idProp.type).toBe("string");
      expect(typeof idProp.optional).toBe("boolean");
    } finally {
      cleanupFile(filePath);
    }
  });

  it("should throw for nonexistent files", async () => {
    await expect(
      parseAndExtractTypes(["/nonexistent/path/test.ts"])
    ).rejects.toThrow();
  });
});

describe("compileRoutes", () => {
  it("should compile route contracts into a radix tree TypeScript file", async () => {
    const source = `
interface UsersRoutes {
  "GET /users": RouteContract<void, void, void, void>;
  "POST /users": RouteContract<void, void, void, void>;
  "GET /users/:id": RouteContract<{ id: string }, void, void, void>;
}
interface HealthRoutes {
  "GET /health": RouteContract<void, void, void, void>;
}
`;
    const filePath = createTempTsFile(source);
    try {
      const result = await compileRoutes([filePath]);

      expect(result).toContain("AUTO-GENERATED");
      expect(result).toContain("CompiledRouteTable");
      expect(result).toContain("routeTree");
      expect(result).toContain("users");
      expect(result).toContain("health");
      expect(result).toContain("paramName");
      expect(result).toContain("id");
    } finally {
      cleanupFile(filePath);
    }
  });

  it("should handle wildcard routes", async () => {
    const source = `
interface FileRoutes {
  "GET /files/*path": RouteContract<void, void, void, void>;
}
`;
    const filePath = createTempTsFile(source);
    try {
      const result = await compileRoutes([filePath]);
      expect(result).toContain("wildcardChild");
      expect(result).toContain("path");
    } finally {
      cleanupFile(filePath);
    }
  });

  it("should throw for nonexistent files", async () => {
    await expect(
      compileRoutes(["/nonexistent/path/test.ts"])
    ).rejects.toThrow();
  });
});

describe("generateOpenApi", () => {
  it("should generate a valid OpenAPI 3.1 spec", async () => {
    const routeSource = `
interface UsersRoutes {
  "GET /users": RouteContract<void, void, void, void>;
  "POST /users": RouteContract<void, void, void, void>;
  "GET /users/:id": RouteContract<{ id: string }, void, void, void>;
}
`;
    const routeFile = createTempTsFile(routeSource);
    try {
      const result = await generateOpenApi([routeFile], []);
      const spec = JSON.parse(result);

      expect(spec.openapi).toBe("3.1.0");
      expect(spec.info.title).toBeDefined();
      expect(spec.info.version).toBeDefined();
      expect(spec.paths["/users"]).toBeDefined();
      expect(spec.paths["/users"]["get"]).toBeDefined();
      expect(spec.paths["/users"]["post"]).toBeDefined();
      expect(spec.paths["/users/{id}"]).toBeDefined();
      expect(spec.paths["/users/{id}"]["get"]).toBeDefined();
    } finally {
      cleanupFile(routeFile);
    }
  });

  it("should include path parameters in the spec", async () => {
    const routeSource = `
interface UsersRoutes {
  "GET /users/:id": RouteContract<{ id: string }, void, void, void>;
}
`;
    const routeFile = createTempTsFile(routeSource);
    try {
      const result = await generateOpenApi([routeFile], []);
      const spec = JSON.parse(result);

      const params = spec.paths["/users/{id}"]["get"].parameters;
      expect(params).toBeDefined();
      expect(params.length).toBeGreaterThanOrEqual(1);
      const idParam = params.find((p: Record<string, unknown>) => p.name === "id");
      expect(idParam).toBeDefined();
      expect(idParam.in).toBe("path");
      expect(idParam.required).toBe(true);
    } finally {
      cleanupFile(routeFile);
    }
  });

  it("should generate component schemas from type files", async () => {
    const routeSource = `
interface UsersRoutes {
  "GET /users": RouteContract<void, void, void, PublicUser>;
}
`;
    const typeSource = `
interface PublicUser {
  id: string;
  name: string;
  email: string;
}
`;
    const routeFile = createTempTsFile(routeSource);
    const typeFile = createTempTsFile(typeSource);
    try {
      const result = await generateOpenApi([routeFile], [typeFile]);
      const spec = JSON.parse(result);

      expect(spec.components).toBeDefined();
      expect(spec.components.schemas).toBeDefined();
      expect(spec.components.schemas["PublicUser"]).toBeDefined();
      expect(spec.components.schemas["PublicUser"].type).toBe("object");
      expect(spec.components.schemas["PublicUser"].properties.id).toBeDefined();
      expect(spec.components.schemas["PublicUser"].properties.name).toBeDefined();
    } finally {
      cleanupFile(routeFile);
      cleanupFile(typeFile);
    }
  });
});

describe("diffSchemas", () => {
  it("should detect added entity", async () => {
    const oldTypes = {};
    const newTypes = {
      User: {
        name: "User",
        properties: {
          id: { type: "string", optional: false },
          name: { type: "string", optional: false },
        },
      },
    };

    const draft = await diffSchemas(oldTypes, newTypes, "add_user");

    expect(draft.name).toBe("add_user");
    expect(draft.destructive).toBe(false);
    expect(draft.changes.length).toBe(1);
    expect(draft.changes[0].type).toBe("add");
    expect(draft.changes[0].entity).toBe("User");
    expect(draft.sql).toContain("CREATE TABLE");
  });

  it("should detect removed entity as destructive", async () => {
    const oldTypes = {
      User: {
        name: "User",
        properties: {
          id: { type: "string", optional: false },
        },
      },
    };
    const newTypes = {};

    const draft = await diffSchemas(oldTypes, newTypes, "remove_user");

    expect(draft.destructive).toBe(true);
    expect(draft.changes[0].type).toBe("remove");
    expect(draft.sql).toContain("DROP TABLE");
    expect(draft.sql).toContain("DESTRUCTIVE");
  });

  it("should detect added and modified fields", async () => {
    const oldTypes = {
      User: {
        name: "User",
        properties: {
          id: { type: "string", optional: false },
          age: { type: "string", optional: false },
        },
      },
    };
    const newTypes = {
      User: {
        name: "User",
        properties: {
          id: { type: "string", optional: false },
          age: { type: "number", optional: false },
          email: { type: "string", optional: false },
        },
      },
    };

    const draft = await diffSchemas(oldTypes, newTypes, "modify_user");

    expect(draft.destructive).toBe(true);
    const addChange = draft.changes.find(
      (c: Record<string, unknown>) => c.type === "add" && c.field === "email"
    );
    expect(addChange).toBeDefined();
    const modifyChange = draft.changes.find(
      (c: Record<string, unknown>) => c.type === "modify" && c.field === "age"
    );
    expect(modifyChange).toBeDefined();
  });

  it("should report no changes for identical schemas", async () => {
    const types = {
      User: {
        name: "User",
        properties: {
          id: { type: "string", optional: false },
        },
      },
    };

    const draft = await diffSchemas(types, types, "no_changes");

    expect(draft.destructive).toBe(false);
    expect(draft.changes.length).toBe(0);
    expect(draft.sql).toContain("No changes");
  });
});

describe("generateTestStubs", () => {
  it("should generate test stubs from route contracts", async () => {
    const source = `
interface UsersRoutes {
  "GET /users": RouteContract<void, void, void, void>;
  "POST /users": RouteContract<void, void, { email: string; name: string }, void>;
  "GET /users/:id": RouteContract<{ id: string }, void, void, void>;
}
`;
    const filePath = createTempTsFile(source);
    try {
      const result = await generateTestStubs([filePath]);

      expect(result).toContain("AUTO-GENERATED");
      expect(result).toContain("describe(\"GET /users\"");
      expect(result).toContain("describe(\"POST /users\"");
      expect(result).toContain("describe(\"GET /users/:id\"");
      expect(result).toContain("accepts valid request");
      expect(result).toContain("rejects missing required fields");
      expect(result).toContain("handles path parameters");
    } finally {
      cleanupFile(filePath);
    }
  });

  it("should throw for nonexistent files", async () => {
    await expect(
      generateTestStubs(["/nonexistent/path/test.ts"])
    ).rejects.toThrow();
  });
});

describe("prepareValidatorInputs", () => {
  it("should prepare type metadata for Typia bridge", async () => {
    const source = `
interface User {
  id: string;
  name: string;
  age?: number;
}
interface Post {
  id: string;
  title: string;
}
`;
    const filePath = createTempTsFile(source);
    try {
      const inputs = await prepareValidatorInputs([filePath]);

      expect(inputs.length).toBe(2);
      // Should be alphabetically sorted
      const postInput = inputs.find((i: Record<string, unknown>) => i.name === "Post");
      const userInput = inputs.find((i: Record<string, unknown>) => i.name === "User");
      expect(postInput).toBeDefined();
      expect(userInput).toBeDefined();
      expect(Object.keys((userInput as Record<string, Record<string, unknown>>).properties).length).toBe(3);
    } finally {
      cleanupFile(filePath);
    }
  });
});

describe("collectValidatorOutputs", () => {
  it("should map type names to file paths", async () => {
    const results: [string, string][] = [
      ["User", "export function validateUser() {}"],
      ["BlogPost", "export function validateBlogPost() {}"],
    ];

    const output = await collectValidatorOutputs(results);

    expect(output[".typokit/validators/user.ts"]).toContain("validateUser");
    expect(output[".typokit/validators/blog-post.ts"]).toContain("validateBlogPost");
  });
});
