import { describe, it, expect } from "@rstest/core";
import { createFactory } from "./factory.js";
import type { TypeMetadata } from "@typokit/types";

// ─── Test Fixtures ────────────────────────────────────────────

const userMetadata: TypeMetadata = {
  name: "User",
  properties: {
    id: { type: "string", optional: false, jsdoc: { format: "uuid" } },
    email: { type: "string", optional: false, jsdoc: { format: "email" } },
    displayName: {
      type: "string",
      optional: false,
      jsdoc: { minLength: "3", maxLength: "50" },
    },
    age: {
      type: "number",
      optional: true,
      jsdoc: { minimum: "0", maximum: "150" },
    },
    isActive: { type: "boolean", optional: false },
    role: { type: '"admin" | "user" | "moderator"', optional: false },
    website: { type: "string", optional: true, jsdoc: { format: "url" } },
    createdAt: {
      type: "string",
      optional: false,
      jsdoc: { format: "date-time" },
    },
    tags: { type: "string[]", optional: true },
  },
};

// ─── Tests ────────────────────────────────────────────────────

describe("createFactory", () => {
  it("builds a valid User instance", () => {
    const factory = createFactory<Record<string, unknown>>(userMetadata);
    const user = factory.build();

    expect(user).toBeDefined();
    expect(typeof user.id).toBe("string");
    expect(typeof user.email).toBe("string");
    expect(typeof user.displayName).toBe("string");
    expect(typeof user.isActive).toBe("boolean");
    expect(typeof user.createdAt).toBe("string");
  });

  it("generates valid email format", () => {
    const factory = createFactory<Record<string, unknown>>(userMetadata, {
      seed: 42,
    });
    const user = factory.build();
    const email = user.email as string;
    expect(email).toContain("@");
    expect(email).toContain(".com");
  });

  it("generates valid UUID format", () => {
    const factory = createFactory<Record<string, unknown>>(userMetadata, {
      seed: 42,
    });
    const user = factory.build();
    const id = user.id as string;
    // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    expect(id.split("-").length).toBe(5);
  });

  it("generates valid URL format", () => {
    const factory = createFactory<Record<string, unknown>>(userMetadata, {
      seed: 99,
    });
    const user = factory.build();
    if (user.website !== undefined) {
      const url = user.website as string;
      expect(url).toContain("https://");
      expect(url).toContain(".com");
    }
  });

  it("respects minLength/maxLength constraints", () => {
    const factory = createFactory<Record<string, unknown>>(userMetadata, {
      seed: 42,
    });
    const user = factory.build();
    const name = user.displayName as string;
    expect(name.length).toBeGreaterThanOrEqual(3);
    expect(name.length).toBeLessThanOrEqual(50);
  });

  it("respects minimum/maximum constraints for numbers", () => {
    const factory = createFactory<Record<string, unknown>>(userMetadata, {
      seed: 42,
    });
    const user = factory.build();
    if (user.age !== undefined) {
      const age = user.age as number;
      expect(age).toBeGreaterThanOrEqual(0);
      expect(age).toBeLessThanOrEqual(150);
    }
  });

  it("generates valid enum values from string unions", () => {
    const factory = createFactory<Record<string, unknown>>(userMetadata, {
      seed: 42,
    });
    const user = factory.build();
    expect(["admin", "user", "moderator"]).toContain(user.role);
  });

  it("overrides specific fields", () => {
    const factory = createFactory<Record<string, unknown>>(userMetadata, {
      seed: 42,
    });
    const user = factory.build({
      displayName: "Admin User",
      role: "admin",
    });
    expect(user.displayName).toBe("Admin User");
    expect(user.role).toBe("admin");
  });

  it("buildMany produces correct count", () => {
    const factory = createFactory<Record<string, unknown>>(userMetadata, {
      seed: 42,
    });
    const users = factory.buildMany(5);
    expect(users.length).toBe(5);
    for (const user of users) {
      expect(user.email).toBeDefined();
    }
  });

  it("buildMany applies overrides to all instances", () => {
    const factory = createFactory<Record<string, unknown>>(userMetadata, {
      seed: 42,
    });
    const users = factory.buildMany(3, { role: "admin" });
    for (const user of users) {
      expect(user.role).toBe("admin");
    }
  });

  it("buildInvalid produces invalid email", () => {
    const factory = createFactory<Record<string, unknown>>(userMetadata, {
      seed: 42,
    });
    const invalid = factory.buildInvalid("email");
    expect(invalid.email).toBe("not-an-email");
    // Other fields should still be valid
    expect(typeof invalid.displayName).toBe("string");
  });

  it("buildInvalid produces invalid UUID", () => {
    const factory = createFactory<Record<string, unknown>>(userMetadata, {
      seed: 42,
    });
    const invalid = factory.buildInvalid("id");
    expect(invalid.id).toBe("not-a-uuid");
  });

  it("buildInvalid produces invalid enum value", () => {
    const factory = createFactory<Record<string, unknown>>(userMetadata, {
      seed: 42,
    });
    const invalid = factory.buildInvalid("role");
    expect(["admin", "user", "moderator"]).not.toContain(invalid.role);
  });

  it("is deterministic with the same seed", () => {
    const factory1 = createFactory<Record<string, unknown>>(userMetadata, {
      seed: 42,
    });
    const factory2 = createFactory<Record<string, unknown>>(userMetadata, {
      seed: 42,
    });
    const user1 = factory1.build();
    const user2 = factory2.build();
    expect(user1).toEqual(user2);
  });

  it("produces different output with different seeds", () => {
    const factory1 = createFactory<Record<string, unknown>>(userMetadata, {
      seed: 42,
    });
    const factory2 = createFactory<Record<string, unknown>>(userMetadata, {
      seed: 99,
    });
    const user1 = factory1.build();
    const user2 = factory2.build();
    expect(user1.email).not.toEqual(user2.email);
  });

  it("generates date-time format values", () => {
    const factory = createFactory<Record<string, unknown>>(userMetadata, {
      seed: 42,
    });
    const user = factory.build();
    const date = user.createdAt as string;
    expect(date).toContain("T");
    expect(date).toContain("Z");
  });

  it("generates arrays for array types", () => {
    const factory = createFactory<Record<string, unknown>>(userMetadata, {
      seed: 42,
    });
    const user = factory.build();
    if (user.tags !== undefined) {
      expect(Array.isArray(user.tags)).toBe(true);
      const tags = user.tags as string[];
      for (const tag of tags) {
        expect(typeof tag).toBe("string");
      }
    }
  });
});
