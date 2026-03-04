// @typokit/testing — Contract Test Generation Tests

import { describe, it, expect } from "@rstest/core";
import {
  generateContractTests,
  detectTestRunner,
} from "./contract-generator.js";
import type {
  ContractTestRoute,
  ContractTestOptions,
} from "./contract-generator.js";
import type { SchemaTypeMap } from "@typokit/types";

// ─── Sample schemas ──────────────────────────────────────────

const sampleSchemas: SchemaTypeMap = {
  CreateUserInput: {
    name: "CreateUserInput",
    properties: {
      email: {
        type: "string",
        optional: false,
        jsdoc: { format: "email" },
      },
      displayName: {
        type: "string",
        optional: false,
      },
      role: {
        type: '"admin" | "user" | "moderator"',
        optional: true,
      },
    },
  },
  PublicUser: {
    name: "PublicUser",
    properties: {
      id: { type: "string", optional: false },
      email: { type: "string", optional: false },
      displayName: { type: "string", optional: false },
    },
  },
  UpdateUserInput: {
    name: "UpdateUserInput",
    properties: {
      displayName: { type: "string", optional: true },
      age: { type: "number", optional: true },
    },
  },
  CreatePostInput: {
    name: "CreatePostInput",
    properties: {
      title: { type: "string", optional: false },
      body: { type: "string", optional: false },
      published: { type: "boolean", optional: false },
    },
  },
};

const sampleRoutes: ContractTestRoute[] = [
  {
    method: "GET",
    path: "/users",
    handlerRef: "listUsers",
    responseSchema: "PublicUser",
  },
  {
    method: "POST",
    path: "/users",
    handlerRef: "createUser",
    validators: { body: "CreateUserInput" },
    responseSchema: "PublicUser",
  },
  {
    method: "PUT",
    path: "/users/:id",
    handlerRef: "updateUser",
    validators: { body: "UpdateUserInput" },
  },
  {
    method: "GET",
    path: "/posts",
    handlerRef: "listPosts",
  },
  {
    method: "POST",
    path: "/posts",
    handlerRef: "createPost",
    validators: { body: "CreatePostInput" },
    expectedStatus: 201,
  },
];

function makeOptions(
  overrides?: Partial<ContractTestOptions>,
): ContractTestOptions {
  return {
    runner: "vitest",
    appImport: "../src/app",
    routes: sampleRoutes,
    schemas: sampleSchemas,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────

describe("generateContractTests", () => {
  it("generates files grouped by path prefix", () => {
    const outputs = generateContractTests(makeOptions());

    expect(outputs.length).toBe(2);

    const filePaths = outputs.map((o) => o.filePath).sort();
    expect(filePaths).toEqual([
      "__generated__/posts.contract.test.ts",
      "__generated__/users.contract.test.ts",
    ]);
  });

  it("includes DO NOT EDIT header in all files", () => {
    const outputs = generateContractTests(makeOptions());

    for (const output of outputs) {
      expect(output.content.startsWith("// DO NOT EDIT")).toBe(true);
      expect(output.content).toContain("regenerated on schema change");
    }
  });

  it("uses vitest imports for vitest runner", () => {
    const outputs = generateContractTests(
      makeOptions({ runner: "vitest" }),
    );
    for (const output of outputs) {
      expect(output.content).toContain('from "vitest"');
    }
  });

  it("uses jest imports for jest runner", () => {
    const outputs = generateContractTests(
      makeOptions({ runner: "jest" }),
    );
    for (const output of outputs) {
      expect(output.content).toContain('from "@jest/globals"');
    }
  });

  it("uses rstest imports for rstest runner", () => {
    const outputs = generateContractTests(
      makeOptions({ runner: "rstest" }),
    );
    for (const output of outputs) {
      expect(output.content).toContain('from "@rstest/core"');
    }
  });

  it("imports createTestClient from @typokit/testing", () => {
    const outputs = generateContractTests(makeOptions());

    for (const output of outputs) {
      expect(output.content).toContain(
        'import { createTestClient } from "@typokit/testing"',
      );
    }
  });

  it("imports app from the configured appImport path", () => {
    const outputs = generateContractTests(
      makeOptions({ appImport: "../../app/index" }),
    );

    for (const output of outputs) {
      expect(output.content).toContain(
        'import { app } from "../../app/index"',
      );
    }
  });

  it("generates valid input test for POST route with body schema", () => {
    const outputs = generateContractTests(makeOptions());
    const usersFile = outputs.find((o) =>
      o.filePath.includes("users"),
    )!;

    expect(usersFile.content).toContain('describe("POST /users"');
    expect(usersFile.content).toContain(
      'it("accepts valid CreateUserInput"',
    );
    expect(usersFile.content).toContain("client.post");
    expect(usersFile.content).toContain("email:");
    expect(usersFile.content).toContain("test@example.com");
    expect(usersFile.content).toContain("expect(res.status).toBe(200)");
  });

  it("generates toMatchSchema assertion when responseSchema is set", () => {
    const outputs = generateContractTests(makeOptions());
    const usersFile = outputs.find((o) =>
      o.filePath.includes("users"),
    )!;

    expect(usersFile.content).toContain(
      'import { toMatchSchema } from "@typokit/testing"',
    );
    expect(usersFile.content).toContain(
      'toMatchSchema("PublicUser")',
    );
  });

  it("generates missing required fields tests", () => {
    const outputs = generateContractTests(makeOptions());
    const usersFile = outputs.find((o) =>
      o.filePath.includes("users"),
    )!;

    expect(usersFile.content).toContain(
      'it("rejects missing required fields"',
    );
    expect(usersFile.content).toContain("body: {}");
    expect(usersFile.content).toContain("expect(res.status).toBe(400)");
  });

  it("generates per-field missing tests for required fields", () => {
    const outputs = generateContractTests(makeOptions());
    const usersFile = outputs.find((o) =>
      o.filePath.includes("users"),
    )!;

    // CreateUserInput has required: email, displayName
    expect(usersFile.content).toContain(
      "it(\"rejects missing 'email' field\"",
    );
    expect(usersFile.content).toContain(
      "it(\"rejects missing 'displayName' field\"",
    );
  });

  it("generates invalid format tests for fields with format constraints", () => {
    const outputs = generateContractTests(makeOptions());
    const usersFile = outputs.find((o) =>
      o.filePath.includes("users"),
    )!;

    expect(usersFile.content).toContain(
      'it("rejects invalid email format"',
    );
    expect(usersFile.content).toContain("not-an-email");
  });

  it("generates simple response test for GET routes without body", () => {
    const outputs = generateContractTests(makeOptions());
    const usersFile = outputs.find((o) =>
      o.filePath.includes("users"),
    )!;

    expect(usersFile.content).toContain('describe("GET /users"');
    expect(usersFile.content).toContain(
      'it("responds with 200"',
    );
    expect(usersFile.content).toContain("client.get");
  });

  it("respects custom expectedStatus", () => {
    const outputs = generateContractTests(makeOptions());
    const postsFile = outputs.find((o) =>
      o.filePath.includes("posts"),
    )!;

    expect(postsFile.content).toContain("expect(res.status).toBe(201)");
  });

  it("generates invalid type tests for number and boolean fields", () => {
    const outputs = generateContractTests(makeOptions());
    const postsFile = outputs.find((o) =>
      o.filePath.includes("posts"),
    )!;

    // CreatePostInput has published: boolean
    expect(postsFile.content).toContain(
      'it("rejects invalid published format"',
    );
  });

  it("generates beforeAll/afterAll for client lifecycle", () => {
    const outputs = generateContractTests(makeOptions());

    for (const output of outputs) {
      expect(output.content).toContain("beforeAll(async () => {");
      expect(output.content).toContain(
        "client = await createTestClient(app);",
      );
      expect(output.content).toContain("afterAll(async () => {");
      expect(output.content).toContain("await client.close();");
    }
  });

  it("is idempotent — same input produces same output", () => {
    const opts = makeOptions();
    const first = generateContractTests(opts);
    const second = generateContractTests(opts);

    expect(first.length).toBe(second.length);
    for (let i = 0; i < first.length; i++) {
      expect(first[i].filePath).toBe(second[i].filePath);
      expect(first[i].content).toBe(second[i].content);
    }
  });

  it("handles routes with no validators gracefully", () => {
    const routes: ContractTestRoute[] = [
      {
        method: "GET",
        path: "/health",
        handlerRef: "healthCheck",
      },
    ];

    const outputs = generateContractTests(
      makeOptions({ routes }),
    );

    expect(outputs.length).toBe(1);
    expect(outputs[0].filePath).toBe(
      "__generated__/health.contract.test.ts",
    );
    expect(outputs[0].content).toContain('describe("GET /health"');
    expect(outputs[0].content).toContain('it("responds with 200"');
    // No missing fields or invalid format tests
    expect(outputs[0].content).not.toContain("rejects missing");
    expect(outputs[0].content).not.toContain("rejects invalid");
  });

  it("returns empty array for empty routes", () => {
    const outputs = generateContractTests(
      makeOptions({ routes: [] }),
    );
    expect(outputs.length).toBe(0);
  });

  it("does not import toMatchSchema when no route has responseSchema", () => {
    const routes: ContractTestRoute[] = [
      {
        method: "GET",
        path: "/health",
        handlerRef: "healthCheck",
      },
    ];

    const outputs = generateContractTests(
      makeOptions({ routes }),
    );

    expect(outputs[0].content).not.toContain("toMatchSchema");
  });
});

describe("detectTestRunner", () => {
  it("detects rstest from devDependencies", () => {
    expect(
      detectTestRunner({ devDependencies: { rstest: "^0.0.1" } }),
    ).toBe("rstest");
  });

  it("detects vitest from devDependencies", () => {
    expect(
      detectTestRunner({ devDependencies: { vitest: "^1.0.0" } }),
    ).toBe("vitest");
  });

  it("detects jest from devDependencies", () => {
    expect(
      detectTestRunner({ devDependencies: { jest: "^29.0.0" } }),
    ).toBe("jest");
  });

  it("detects jest from @jest/globals", () => {
    expect(
      detectTestRunner({
        devDependencies: { "@jest/globals": "^29.0.0" },
      }),
    ).toBe("jest");
  });

  it("detects runner from test script", () => {
    expect(
      detectTestRunner({
        scripts: { test: "rstest run --passWithNoTests" },
      }),
    ).toBe("rstest");
  });

  it("defaults to vitest when no runner detected", () => {
    expect(detectTestRunner({})).toBe("vitest");
  });

  it("prefers rstest over vitest when both present", () => {
    expect(
      detectTestRunner({
        devDependencies: { rstest: "^0.0.1", vitest: "^1.0.0" },
      }),
    ).toBe("rstest");
  });
});
