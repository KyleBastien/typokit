import { describe, it, expect } from "@rstest/core";
import {
  generateValidator,
  generateValidatorBatch,
  ValidatorGenerationError,
} from "./index.js";

import type { TypeMetadata } from "@typokit/types";

// Helper: evaluate generated validator code and run it against input
function run(code: string, fnName: string, input: unknown): unknown {
  const fn = new Function("input", code + `\nreturn ${fnName}(input);`);
  return fn(input);
}

describe("generateValidator", () => {
  it("generates validator for simple types", () => {
    const metadata: TypeMetadata = {
      name: "User",
      properties: {
        name: { type: "string", optional: false },
        age: { type: "number", optional: false },
        active: { type: "boolean", optional: false },
      },
    };

    const code = generateValidator(metadata);
    expect(code).toContain("function validateUser(input)");

    const valid = run(code, "validateUser", {
      name: "John",
      age: 30,
      active: true,
    }) as { success: boolean };
    expect(valid.success).toBe(true);

    const invalid = run(code, "validateUser", {
      name: 123,
      age: "thirty",
      active: "yes",
    }) as { success: boolean; errors: unknown[] };
    expect(invalid.success).toBe(false);
    expect(invalid.errors.length).toBe(3);
  });

  it("generates validator for union types", () => {
    const metadata: TypeMetadata = {
      name: "FlexId",
      properties: {
        id: { type: "string | number", optional: false },
      },
    };

    const code = generateValidator(metadata);
    const check = (v: unknown) =>
      run(code, "validateFlexId", v) as { success: boolean };

    expect(check({ id: "abc" }).success).toBe(true);
    expect(check({ id: 42 }).success).toBe(true);
    expect(check({ id: true }).success).toBe(false);
  });

  it("generates validator for nested object types", () => {
    const metadata: TypeMetadata = {
      name: "Profile",
      properties: {
        address: { type: "Address", optional: false },
      },
    };

    const code = generateValidator(metadata);
    const check = (v: unknown) =>
      run(code, "validateProfile", v) as { success: boolean };

    expect(check({ address: { street: "123 Main" } }).success).toBe(true);
    expect(check({ address: null }).success).toBe(false);
    expect(check({ address: "not object" }).success).toBe(false);
  });

  it("generates validator for array types", () => {
    const metadata: TypeMetadata = {
      name: "TagList",
      properties: {
        tags: { type: "string[]", optional: false },
        scores: { type: "number[]", optional: false },
      },
    };

    const code = generateValidator(metadata);
    const check = (v: unknown) =>
      run(code, "validateTagList", v) as { success: boolean };

    expect(check({ tags: ["a", "b"], scores: [1, 2] }).success).toBe(true);
    expect(check({ tags: [1, 2], scores: [1, 2] }).success).toBe(false);
    expect(check({ tags: "not array", scores: [1] }).success).toBe(false);
  });

  it("generates validator for optional fields", () => {
    const metadata: TypeMetadata = {
      name: "UpdateUser",
      properties: {
        name: { type: "string", optional: true },
        age: { type: "number", optional: true },
        email: { type: "string", optional: false },
      },
    };

    const code = generateValidator(metadata);
    const check = (v: unknown) =>
      run(code, "validateUpdateUser", v) as { success: boolean };

    expect(check({ name: "John", age: 30, email: "j@e.com" }).success).toBe(
      true,
    );
    expect(check({ email: "j@e.com" }).success).toBe(true);
    expect(check({ name: "John" }).success).toBe(false);
    expect(check({ email: "j@e.com", name: 123 }).success).toBe(false);
  });

  it("generates validator for empty properties", () => {
    const metadata: TypeMetadata = {
      name: "Empty",
      properties: {},
    };

    const code = generateValidator(metadata);
    const check = (v: unknown) =>
      run(code, "validateEmpty", v) as { success: boolean };

    expect(check({}).success).toBe(true);
    expect(check(null).success).toBe(false);
  });

  it("rejects non-object input in generated validators", () => {
    const metadata: TypeMetadata = {
      name: "Test",
      properties: { x: { type: "string", optional: false } },
    };

    const code = generateValidator(metadata);
    const check = (v: unknown) =>
      run(code, "validateTest", v) as { success: boolean };

    expect(check(null).success).toBe(false);
    expect(check(undefined).success).toBe(false);
    expect(check("string").success).toBe(false);
    expect(check(42).success).toBe(false);
  });

  it("generates validator for nullable union types", () => {
    const metadata: TypeMetadata = {
      name: "Nullable",
      properties: {
        value: { type: "string | null", optional: false },
      },
    };

    const code = generateValidator(metadata);
    const check = (v: unknown) =>
      run(code, "validateNullable", v) as { success: boolean };

    expect(check({ value: "hello" }).success).toBe(true);
    expect(check({ value: null }).success).toBe(true);
    expect(check({ value: 42 }).success).toBe(false);
  });

  it("generates validator for template literal types", () => {
    const metadata: TypeMetadata = {
      name: "EventName",
      properties: {
        event: { type: "`on_${string}`", optional: false },
      },
    };

    const code = generateValidator(metadata);
    const check = (v: unknown) =>
      run(code, "validateEventName", v) as { success: boolean };

    expect(check({ event: "on_click" }).success).toBe(true);
    expect(check({ event: "on_" }).success).toBe(true);
    expect(check({ event: "off_click" }).success).toBe(false);
    expect(check({ event: 42 }).success).toBe(false);
  });

  it("generates validator for recursive types", () => {
    const metadata: TypeMetadata = {
      name: "TreeNode",
      properties: {
        value: { type: "number", optional: false },
        children: { type: "TreeNode[]", optional: true },
      },
    };

    const code = generateValidator(metadata);
    expect(code).toContain("function validateTreeNode");
    expect(code).toContain("Array.isArray");

    const check = (v: unknown) =>
      run(code, "validateTreeNode", v) as { success: boolean };
    expect(check({ value: 1 }).success).toBe(true);
    expect(check({ value: 1, children: [{ value: 2 }] }).success).toBe(true);
    expect(check({ value: "not a number" }).success).toBe(false);
  });

  it("throws ValidatorGenerationError on empty name", () => {
    const metadata = { name: "", properties: {} } as TypeMetadata;
    expect(() => generateValidator(metadata)).toThrow(ValidatorGenerationError);
  });

  it("error includes type name and reason", () => {
    try {
      generateValidator({ name: "", properties: {} });
      expect(true).toBe(false); // should not reach here
    } catch (err) {
      expect(err).toBeInstanceOf(ValidatorGenerationError);
      const vge = err as ValidatorGenerationError;
      expect(vge.reason).toContain("non-empty");
    }
  });
});

describe("generateValidatorBatch", () => {
  it("generates validators for multiple types", () => {
    const types: TypeMetadata[] = [
      {
        name: "User",
        properties: {
          name: { type: "string", optional: false },
          age: { type: "number", optional: false },
        },
      },
      {
        name: "Post",
        properties: {
          title: { type: "string", optional: false },
          author: { type: "User", optional: false },
        },
      },
    ];

    const result = generateValidatorBatch(types);
    expect(result.size).toBe(2);
    expect(result.has("User")).toBe(true);
    expect(result.has("Post")).toBe(true);
    expect(result.get("User")).toContain("function validateUser");
    expect(result.get("Post")).toContain("function validatePost");
  });

  it("cross-references types in the batch", () => {
    const types: TypeMetadata[] = [
      {
        name: "Address",
        properties: {
          street: { type: "string", optional: false },
        },
      },
      {
        name: "Person",
        properties: {
          name: { type: "string", optional: false },
          address: { type: "Address", optional: false },
        },
      },
    ];

    const result = generateValidatorBatch(types);
    const personCode = result.get("Person")!;
    const check = (v: unknown) =>
      run(personCode, "validatePerson", v) as { success: boolean };

    expect(check({ name: "Jane", address: { street: "Elm" } }).success).toBe(
      true,
    );
    expect(check({ name: "Jane", address: null }).success).toBe(false);
  });

  it("throws ValidatorGenerationError for invalid type in batch", () => {
    const types: TypeMetadata[] = [
      { name: "Good", properties: { x: { type: "string", optional: false } } },
      { name: "", properties: {} },
    ];

    expect(() => generateValidatorBatch(types)).toThrow(
      ValidatorGenerationError,
    );
  });
});
