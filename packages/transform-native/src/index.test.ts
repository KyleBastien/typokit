import { describe, it, expect } from "@rstest/core";
import {
  parseAndExtractTypes,
  compileRoutes,
  generateOpenApi,
  diffSchemas,
  generateTestStubs,
  prepareValidatorInputs,
  collectValidatorOutputs,
  computeContentHash,
  buildPipeline,
} from "./index.js";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

// Skip all tests when the native binary is not available for the current platform
const triples: Record<string, Record<string, string>> = {
  win32: { x64: "win32-x64-msvc" },
  darwin: { x64: "darwin-x64", arm64: "darwin-arm64" },
  linux: { x64: "linux-x64-gnu", arm64: "linux-arm64-gnu" },
};
const triple = triples[process.platform]?.[process.arch];
const hasNativeBinary =
  !!triple &&
  fs.existsSync(
    path.resolve(import.meta.dirname, "..", `index.${triple}.node`),
  );
const describeNative = describe.skipIf(!hasNativeBinary);

// Helper to create a temporary TypeScript file
function createTempTsFile(content: string): string {
  const tmpDir = os.tmpdir();
  const filePath = path.join(
    tmpDir,
    `typokit-test-${Date.now()}-${Math.random().toString(36).slice(2)}.ts`,
  );
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

describeNative("parseAndExtractTypes", () => {
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
      expect(props["status"].type).toBe('"active" | "inactive" | "draft"');
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
      parseAndExtractTypes(["/nonexistent/path/test.ts"]),
    ).rejects.toThrow();
  });
});

describeNative("compileRoutes", () => {
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
      compileRoutes(["/nonexistent/path/test.ts"]),
    ).rejects.toThrow();
  });
});

describeNative("generateOpenApi", () => {
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
      const idParam = params.find(
        (p: Record<string, unknown>) => p.name === "id",
      );
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
      expect(
        spec.components.schemas["PublicUser"].properties.name,
      ).toBeDefined();
    } finally {
      cleanupFile(routeFile);
      cleanupFile(typeFile);
    }
  });
});

describeNative("diffSchemas", () => {
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
      (c) => c.type === "add" && c.field === "email",
    );
    expect(addChange).toBeDefined();
    const modifyChange = draft.changes.find(
      (c) => c.type === "modify" && c.field === "age",
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

describeNative("generateTestStubs", () => {
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
      expect(result).toContain('describe("GET /users"');
      expect(result).toContain('describe("POST /users"');
      expect(result).toContain('describe("GET /users/:id"');
      expect(result).toContain("accepts valid request");
      expect(result).toContain("rejects missing required fields");
      expect(result).toContain("handles path parameters");
    } finally {
      cleanupFile(filePath);
    }
  });

  it("should throw for nonexistent files", async () => {
    await expect(
      generateTestStubs(["/nonexistent/path/test.ts"]),
    ).rejects.toThrow();
  });
});

describeNative("prepareValidatorInputs", () => {
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
      const postInput = inputs.find((i) => i.name === "Post");
      const userInput = inputs.find((i) => i.name === "User");
      expect(postInput).toBeDefined();
      expect(userInput).toBeDefined();
      expect(
        Object.keys(
          (userInput as unknown as Record<string, Record<string, unknown>>)
            .properties,
        ).length,
      ).toBe(3);
    } finally {
      cleanupFile(filePath);
    }
  });
});

describeNative("collectValidatorOutputs", () => {
  it("should map type names to file paths", async () => {
    const results: [string, string][] = [
      ["User", "export function validateUser() {}"],
      ["BlogPost", "export function validateBlogPost() {}"],
    ];

    const output = await collectValidatorOutputs(results);

    expect(output[".typokit/validators/user.ts"]).toContain("validateUser");
    expect(output[".typokit/validators/blog-post.ts"]).toContain(
      "validateBlogPost",
    );
  });
});

describeNative("computeContentHash", () => {
  it("should produce deterministic hash regardless of file order", async () => {
    const f1 = createTempTsFile("interface A { id: string; }");
    const f2 = createTempTsFile("interface B { id: string; }");
    try {
      const hash1 = await computeContentHash([f1, f2]);
      const hash2 = await computeContentHash([f2, f1]);
      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(64); // SHA-256 hex
    } finally {
      cleanupFile(f1);
      cleanupFile(f2);
    }
  });

  it("should change when file content changes", async () => {
    const filePath = createTempTsFile("interface A { id: string; }");
    try {
      const hash1 = await computeContentHash([filePath]);
      fs.writeFileSync(
        filePath,
        "interface A { id: string; name: string; }",
        "utf-8",
      );
      const hash2 = await computeContentHash([filePath]);
      expect(hash1).not.toBe(hash2);
    } finally {
      cleanupFile(filePath);
    }
  });
});

describeNative("buildPipeline", () => {
  function createTempDir(): string {
    const tmpDir = os.tmpdir();
    const dir = path.join(
      tmpDir,
      `typokit-pipeline-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  function cleanupDir(dir: string): void {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }

  it("should generate all outputs to .typokit/ directory", async () => {
    const typeSource = `
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
  age?: number;
  active: boolean;
}
`;
    const routeSource = `
interface UsersRoutes {
  "GET /users": RouteContract<void, void, void, void>;
  "POST /users": RouteContract<void, void, { email: string; name: string }, void>;
  "GET /users/:id": RouteContract<{ id: string }, void, void, void>;
  "PUT /users/:id": RouteContract<{ id: string }, void, { name: string }, void>;
  "DELETE /users/:id": RouteContract<{ id: string }, void, void, void>;
}
`;
    const typeFile = createTempTsFile(typeSource);
    const routeFile = createTempTsFile(routeSource);
    const outputDir = createTempDir();
    const typokitDir = path.join(outputDir, ".typokit");

    try {
      const result = await buildPipeline({
        typeFiles: [typeFile],
        routeFiles: [routeFile],
        outputDir: typokitDir,
      });

      // Should have regenerated
      expect(result.regenerated).toBe(true);
      expect(result.contentHash.length).toBe(64);
      expect(result.filesWritten.length).toBeGreaterThanOrEqual(3);

      // Types should be extracted
      expect(result.types["User"]).toBeDefined();
      expect(result.types["User"].properties["id"]).toBeDefined();
      expect(result.types["User"].properties["email"]).toBeDefined();

      // Compiled routes should exist
      const routesPath = path.join(typokitDir, "routes", "compiled-router.ts");
      expect(fs.existsSync(routesPath)).toBe(true);
      const routesContent = fs.readFileSync(routesPath, "utf-8");
      expect(routesContent).toContain("routeTree");
      expect(routesContent).toContain("users");

      // OpenAPI spec should exist
      const openapiPath = path.join(typokitDir, "schemas", "openapi.json");
      expect(fs.existsSync(openapiPath)).toBe(true);
      const openapiContent = fs.readFileSync(openapiPath, "utf-8");
      const spec = JSON.parse(openapiContent);
      expect(spec.openapi).toBe("3.1.0");
      expect(spec.paths["/users"]).toBeDefined();
      expect(spec.paths["/users/{id}"]).toBeDefined();

      // Test stubs should exist
      const testsPath = path.join(typokitDir, "tests", "contract.test.ts");
      expect(fs.existsSync(testsPath)).toBe(true);
      const testsContent = fs.readFileSync(testsPath, "utf-8");
      expect(testsContent).toContain("GET /users");
      expect(testsContent).toContain("POST /users");

      // Cache hash should exist
      const cachePath = path.join(typokitDir, ".cache-hash");
      expect(fs.existsSync(cachePath)).toBe(true);
      expect(fs.readFileSync(cachePath, "utf-8").trim()).toBe(
        result.contentHash,
      );

      // Directories should be created
      expect(fs.existsSync(path.join(typokitDir, "validators"))).toBe(true);
      expect(fs.existsSync(path.join(typokitDir, "client"))).toBe(true);
    } finally {
      cleanupFile(typeFile);
      cleanupFile(routeFile);
      cleanupDir(outputDir);
    }
  });

  it("should skip regeneration on cache hit", async () => {
    const typeSource = `
interface Task {
  id: string;
  title: string;
  done: boolean;
}
`;
    const routeSource = `
interface TaskRoutes {
  "GET /tasks": RouteContract<void, void, void, void>;
}
`;
    const typeFile = createTempTsFile(typeSource);
    const routeFile = createTempTsFile(routeSource);
    const outputDir = createTempDir();
    const typokitDir = path.join(outputDir, ".typokit");

    try {
      // First build
      const result1 = await buildPipeline({
        typeFiles: [typeFile],
        routeFiles: [routeFile],
        outputDir: typokitDir,
      });
      expect(result1.regenerated).toBe(true);

      // Second build — same inputs, should hit cache
      const result2 = await buildPipeline({
        typeFiles: [typeFile],
        routeFiles: [routeFile],
        outputDir: typokitDir,
      });
      expect(result2.regenerated).toBe(false);
      expect(result2.contentHash).toBe(result1.contentHash);
      expect(result2.filesWritten.length).toBe(0);
    } finally {
      cleanupFile(typeFile);
      cleanupFile(routeFile);
      cleanupDir(outputDir);
    }
  });

  it("should regenerate when source files change", async () => {
    const typeSource1 = `
interface Task {
  id: string;
  title: string;
}
`;
    const routeSource = `
interface TaskRoutes {
  "GET /tasks": RouteContract<void, void, void, void>;
}
`;
    const typeFile = createTempTsFile(typeSource1);
    const routeFile = createTempTsFile(routeSource);
    const outputDir = createTempDir();
    const typokitDir = path.join(outputDir, ".typokit");

    try {
      // First build
      const result1 = await buildPipeline({
        typeFiles: [typeFile],
        routeFiles: [routeFile],
        outputDir: typokitDir,
      });
      expect(result1.regenerated).toBe(true);

      // Modify source file
      fs.writeFileSync(
        typeFile,
        `
interface Task {
  id: string;
  title: string;
  done: boolean;
}
`,
        "utf-8",
      );

      // Second build — should regenerate
      const result2 = await buildPipeline({
        typeFiles: [typeFile],
        routeFiles: [routeFile],
        outputDir: typokitDir,
      });
      expect(result2.regenerated).toBe(true);
      expect(result2.contentHash).not.toBe(result1.contentHash);
    } finally {
      cleanupFile(typeFile);
      cleanupFile(routeFile);
      cleanupDir(outputDir);
    }
  });

  it("should generate validators when callback is provided", async () => {
    const typeSource = `
interface User {
  id: string;
  name: string;
}
`;
    const typeFile = createTempTsFile(typeSource);
    const outputDir = createTempDir();
    const typokitDir = path.join(outputDir, ".typokit");

    try {
      const result = await buildPipeline({
        typeFiles: [typeFile],
        routeFiles: [],
        outputDir: typokitDir,
        validatorCallback: (inputs) => {
          return inputs.map(
            (input) =>
              [
                input.name,
                `export function validate${input.name}(input: unknown) { return true; }`,
              ] as [string, string],
          );
        },
      });

      expect(result.regenerated).toBe(true);
      // Validator files should be written
      const validatorsDir = path.join(typokitDir, "validators");
      const validatorFiles = fs.readdirSync(validatorsDir);
      expect(validatorFiles.length).toBeGreaterThanOrEqual(1);
      expect(validatorFiles.some((f: string) => f.endsWith(".ts"))).toBe(true);
    } finally {
      cleanupFile(typeFile);
      cleanupDir(outputDir);
    }
  });

  it("should handle large schema efficiently (50 types + 20 routes < 500ms)", async () => {
    // Generate 50 type interfaces
    const typeLines: string[] = [];
    for (let i = 0; i < 50; i++) {
      typeLines.push(`interface Type${i} {
  id: string;
  name: string;
  email: string;
  age: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  score?: number;
}`);
    }
    const typeFile = createTempTsFile(typeLines.join("\n\n"));

    // Generate 20 route contracts
    const routeLines: string[] = [];
    for (let i = 0; i < 20; i++) {
      routeLines.push(`interface Route${i} {
  "GET /items${i}": RouteContract<void, void, void, void>;
  "POST /items${i}": RouteContract<void, void, void, void>;
  "GET /items${i}/:id": RouteContract<{ id: string }, void, void, void>;
}`);
    }
    const routeFile = createTempTsFile(routeLines.join("\n\n"));
    const outputDir = createTempDir();
    const typokitDir = path.join(outputDir, ".typokit");

    try {
      const start = Date.now();
      const result = await buildPipeline({
        typeFiles: [typeFile],
        routeFiles: [routeFile],
        outputDir: typokitDir,
      });
      const elapsed = Date.now() - start;

      expect(result.regenerated).toBe(true);
      expect(Object.keys(result.types).length).toBe(50);
      expect(elapsed).toBeLessThan(500);
    } finally {
      cleanupFile(typeFile);
      cleanupFile(routeFile);
      cleanupDir(outputDir);
    }
  });
});
