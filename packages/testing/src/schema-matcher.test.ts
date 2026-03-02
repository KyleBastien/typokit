import { describe, it, expect, beforeEach } from "@rstest/core";
import {
  toMatchSchema,
  registerSchemaValidators,
  clearSchemaValidators,
  matchSchema,
  getSchemaValidator,
} from "./schema-matcher.js";
import type { ValidatorFn, ValidationFieldError } from "@typokit/types";

// ─── Test Helpers ─────────────────────────────────────────────

/** Creates a validator that passes for objects with required PublicUser fields */
function createPublicUserValidator(): ValidatorFn {
  return (input: unknown) => {
    if (typeof input !== "object" || input === null) {
      return {
        success: false,
        errors: [
          { path: "$", expected: "object", actual: typeof input },
        ] as ValidationFieldError[],
      };
    }

    const obj = input as Record<string, unknown>;
    const errors: ValidationFieldError[] = [];

    if (typeof obj["id"] !== "string") {
      errors.push({ path: "id", expected: "string", actual: obj["id"] });
    }
    if (typeof obj["name"] !== "string") {
      errors.push({ path: "name", expected: "string", actual: obj["name"] });
    }
    if (typeof obj["email"] !== "string") {
      errors.push({ path: "email", expected: "string", actual: obj["email"] });
    }

    return {
      success: errors.length === 0,
      data: errors.length === 0 ? input : undefined,
      errors: errors.length > 0 ? errors : undefined,
    };
  };
}

/** Creates a simple pass/fail validator */
function createSimpleValidator(fieldName: string, fieldType: string): ValidatorFn {
  return (input: unknown) => {
    if (typeof input !== "object" || input === null) {
      return {
        success: false,
        errors: [{ path: "$", expected: "object", actual: typeof input }],
      };
    }
    const obj = input as Record<string, unknown>;
    if (typeof obj[fieldName] !== fieldType) {
      return {
        success: false,
        errors: [{ path: fieldName, expected: fieldType, actual: obj[fieldName] }],
      };
    }
    return { success: true, data: input };
  };
}

// ─── Tests ────────────────────────────────────────────────────

describe("schema-matcher", () => {
  beforeEach(() => {
    clearSchemaValidators();
  });

  describe("registerSchemaValidators / getSchemaValidator", () => {
    it("should register and retrieve validators", () => {
      const validator = createPublicUserValidator();
      registerSchemaValidators({ PublicUser: validator });

      const retrieved = getSchemaValidator("PublicUser");
      expect(retrieved).toBe(validator);
    });

    it("should throw when schema not registered", () => {
      expect(() => getSchemaValidator("Unknown")).toThrow(
        'Schema "Unknown" not registered',
      );
    });

    it("should list available schemas in error message", () => {
      registerSchemaValidators({
        PublicUser: createPublicUserValidator(),
        Post: createSimpleValidator("title", "string"),
      });

      try {
        getSchemaValidator("Missing");
        expect(true).toBe(false); // should not reach
      } catch (err: unknown) {
        const msg = (err as Error).message;
        expect(msg).toContain("PublicUser");
        expect(msg).toContain("Post");
      }
    });

    it("should merge validators when registering multiple times", () => {
      registerSchemaValidators({ A: createSimpleValidator("a", "string") });
      registerSchemaValidators({ B: createSimpleValidator("b", "number") });

      expect(() => getSchemaValidator("A")).not.toThrow();
      expect(() => getSchemaValidator("B")).not.toThrow();
    });
  });

  describe("clearSchemaValidators", () => {
    it("should remove all registered validators", () => {
      registerSchemaValidators({ PublicUser: createPublicUserValidator() });
      clearSchemaValidators();

      expect(() => getSchemaValidator("PublicUser")).toThrow();
    });
  });

  describe("matchSchema (core logic)", () => {
    it("should pass for a valid PublicUser", () => {
      registerSchemaValidators({ PublicUser: createPublicUserValidator() });

      const validUser = { id: "u1", name: "Alice", email: "alice@example.com" };
      const result = matchSchema(validUser, "PublicUser");

      expect(result.pass).toBe(true);
      expect(result.message).toContain("NOT to match");
    });

    it("should fail for an invalid PublicUser (missing fields)", () => {
      registerSchemaValidators({ PublicUser: createPublicUserValidator() });

      const invalidUser = { id: 123, name: "Alice" }; // id is number, email missing
      const result = matchSchema(invalidUser, "PublicUser");

      expect(result.pass).toBe(false);
      expect(result.message).toContain("validation failed");
      expect(result.message).toContain("id");
      expect(result.message).toContain("email");
    });

    it("should fail for a non-object value", () => {
      registerSchemaValidators({ PublicUser: createPublicUserValidator() });

      const result = matchSchema("not an object", "PublicUser");
      expect(result.pass).toBe(false);
      expect(result.message).toContain("validation failed");
    });

    it("should include field-level error details", () => {
      registerSchemaValidators({ PublicUser: createPublicUserValidator() });

      const result = matchSchema({ id: 42, name: true, email: null }, "PublicUser");
      expect(result.pass).toBe(false);
      expect(result.message).toContain("id");
      expect(result.message).toContain("expected string");
      expect(result.message).toContain("name");
      expect(result.message).toContain("email");
    });

    it("should show schema name in pass message", () => {
      registerSchemaValidators({ PublicUser: createPublicUserValidator() });

      const result = matchSchema(
        { id: "1", name: "A", email: "a@b.com" },
        "PublicUser",
      );
      expect(result.message).toContain('"PublicUser"');
    });

    it("should show schema name in fail message", () => {
      registerSchemaValidators({ PublicUser: createPublicUserValidator() });

      const result = matchSchema({}, "PublicUser");
      expect(result.message).toContain('"PublicUser"');
    });
  });

  describe("toMatchSchema (framework matcher)", () => {
    it("should return pass: true for valid data", () => {
      registerSchemaValidators({ PublicUser: createPublicUserValidator() });

      const result = toMatchSchema.call(
        {},
        { id: "u1", name: "Alice", email: "alice@example.com" },
        "PublicUser",
      );

      expect(result.pass).toBe(true);
      expect(typeof result.message).toBe("function");
    });

    it("should return pass: false for invalid data", () => {
      registerSchemaValidators({ PublicUser: createPublicUserValidator() });

      const result = toMatchSchema.call({}, { wrong: "data" }, "PublicUser");

      expect(result.pass).toBe(false);
      expect(result.message()).toContain("validation failed");
    });

    it("should provide message as a function (Jest/Vitest API)", () => {
      registerSchemaValidators({ PublicUser: createPublicUserValidator() });

      const result = toMatchSchema.call(
        {},
        { id: "1", name: "A", email: "a@b" },
        "PublicUser",
      );

      // Jest/Vitest expect message to be a function
      expect(typeof result.message).toBe("function");
      expect(typeof result.message()).toBe("string");
    });

    it("should work with .not context (isNot)", () => {
      registerSchemaValidators({ PublicUser: createPublicUserValidator() });

      // When .not is used, pass: true means the assertion fails
      const result = toMatchSchema.call(
        { isNot: true },
        { id: "1", name: "A", email: "a@b.com" },
        "PublicUser",
      );

      // pass is true (value matches), so .not would make it fail
      expect(result.pass).toBe(true);
      expect(result.message()).toContain("NOT to match");
    });

    it("should work without this context", () => {
      registerSchemaValidators({ PublicUser: createPublicUserValidator() });

      const result = toMatchSchema(
        { id: "1", name: "A", email: "a@b.com" },
        "PublicUser",
      );

      expect(result.pass).toBe(true);
    });
  });

  describe("expect.extend integration", () => {
    it("should work with expect.extend for passing assertion", () => {
      registerSchemaValidators({ PublicUser: createPublicUserValidator() });

      // Simulate how expect.extend works in all three frameworks
      expect.extend({ toMatchSchema });

      const validUser = { id: "u1", name: "Alice", email: "alice@example.com" };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (expect(validUser) as any).toMatchSchema("PublicUser");
    });

    it("should work with expect.extend for failing assertion", () => {
      registerSchemaValidators({ PublicUser: createPublicUserValidator() });

      expect.extend({ toMatchSchema });

      const invalidUser = { wrong: "data" };
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (expect(invalidUser) as any).toMatchSchema("PublicUser");
        // Should not reach here
        expect(true).toBe(false);
      } catch (err: unknown) {
        const msg = (err as Error).message;
        expect(msg).toContain("validation failed");
      }
    });

    it("should work with .not for negated assertions", () => {
      registerSchemaValidators({ PublicUser: createPublicUserValidator() });

      expect.extend({ toMatchSchema });

      const invalidUser = { wrong: "data" };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (expect(invalidUser) as any).not.toMatchSchema("PublicUser");
    });
  });
});
