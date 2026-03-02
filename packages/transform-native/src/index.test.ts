import { describe, it, expect } from "@rstest/core";
import { parseAndExtractTypes } from "./index.js";
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
