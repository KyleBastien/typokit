// @typokit/turbo — Unit tests
import { describe, it, expect } from "@rstest/core";
import {
  createTurboConfig,
  defaultPipeline,
} from "./pipeline.js";
import type { TurboConfig, TurboTaskConfig } from "./pipeline.js";
import { getTurboJsonTemplate, getSetupInstructions } from "./setup.js";

// ---------- defaultPipeline ----------

describe("defaultPipeline", () => {
  it("defines build task with correct outputs", () => {
    const build = defaultPipeline["build"] as TurboTaskConfig;
    expect(build.dependsOn).toEqual(["^build"]);
    expect(build.outputs).toContain("dist/**");
    expect(build.outputs).toContain(".typokit/**");
  });

  it("defines dev task as non-cacheable and persistent", () => {
    const dev = defaultPipeline["dev"] as TurboTaskConfig;
    expect(dev.cache).toBe(false);
    expect(dev.persistent).toBe(true);
  });

  it("defines test task depending on build", () => {
    const test = defaultPipeline["test"] as TurboTaskConfig;
    expect(test.dependsOn).toEqual(["build"]);
  });

  it("includes typecheck and lint tasks", () => {
    expect(defaultPipeline["typecheck"]).toBeDefined();
    expect(defaultPipeline["lint"]).toBeDefined();
  });
});

// ---------- createTurboConfig ----------

describe("createTurboConfig", () => {
  it("returns config with schema and default tasks", () => {
    const config: TurboConfig = createTurboConfig();
    expect(config.$schema).toBe("https://turbo.build/schema.json");
    expect(config.tasks["build"]).toBeDefined();
    expect(config.tasks["dev"]).toBeDefined();
    expect(config.tasks["test"]).toBeDefined();
  });

  it("merges task overrides", () => {
    const config = createTurboConfig({
      tasks: { "build": { env: ["DATABASE_URL"] } },
    });
    const build = config.tasks["build"] as TurboTaskConfig;
    expect(build.env).toEqual(["DATABASE_URL"]);
    // Original fields preserved
    expect(build.dependsOn).toEqual(["^build"]);
  });

  it("adds new tasks via overrides", () => {
    const config = createTurboConfig({
      tasks: { "deploy": { dependsOn: ["build", "test"] } },
    });
    expect(config.tasks["deploy"]).toBeDefined();
    expect((config.tasks["deploy"] as TurboTaskConfig).dependsOn).toEqual(["build", "test"]);
  });

  it("includes globalDependencies when provided", () => {
    const config = createTurboConfig({
      globalDependencies: [".env"],
    });
    expect(config.globalDependencies).toEqual([".env"]);
  });

  it("includes globalEnv when provided", () => {
    const config = createTurboConfig({
      globalEnv: ["NODE_ENV"],
    });
    expect(config.globalEnv).toEqual(["NODE_ENV"]);
  });

  it("omits globalDependencies/globalEnv when not provided", () => {
    const config = createTurboConfig();
    expect(config.globalDependencies).toBeUndefined();
    expect(config.globalEnv).toBeUndefined();
  });
});

// ---------- getTurboJsonTemplate ----------

describe("getTurboJsonTemplate", () => {
  it("returns valid JSON string", () => {
    const template = getTurboJsonTemplate();
    const parsed = JSON.parse(template) as TurboConfig;
    expect(parsed.$schema).toBe("https://turbo.build/schema.json");
    expect(parsed.tasks).toBeDefined();
  });

  it("ends with newline", () => {
    const template = getTurboJsonTemplate();
    expect(template.endsWith("\n")).toBe(true);
  });

  it("accepts overrides", () => {
    const template = getTurboJsonTemplate({
      tasks: { "custom": { cache: false } },
    });
    const parsed = JSON.parse(template) as TurboConfig;
    expect(parsed.tasks["custom"]).toBeDefined();
  });
});

// ---------- getSetupInstructions ----------

describe("getSetupInstructions", () => {
  it("returns non-empty string", () => {
    const instructions = getSetupInstructions();
    expect(instructions.length).toBeGreaterThan(0);
  });

  it("includes key setup steps", () => {
    const instructions = getSetupInstructions();
    expect(instructions).toContain("turbo.json");
    expect(instructions).toContain("typokit build");
    expect(instructions).toContain("@typokit/turbo");
  });

  it("mentions .typokit/ output directory", () => {
    const instructions = getSetupInstructions();
    expect(instructions).toContain(".typokit/");
  });
});

// ---------- Helper script exports ----------

describe("@typokit/turbo script exports", () => {
  it("exports runBuild function", async () => {
    const mod = await import("./scripts.js");
    expect(typeof mod.runBuild).toBe("function");
  });

  it("exports runDev function", async () => {
    const mod = await import("./scripts.js");
    expect(typeof mod.runDev).toBe("function");
  });

  it("exports runTest function", async () => {
    const mod = await import("./scripts.js");
    expect(typeof mod.runTest).toBe("function");
  });

  it("exports runTypokitTask function", async () => {
    const mod = await import("./scripts.js");
    expect(typeof mod.runTypokitTask).toBe("function");
  });
});

// ---------- Main index exports ----------

describe("@typokit/turbo exports", () => {
  it("exports pipeline configuration", async () => {
    const mod = await import("./index.js");
    expect(typeof mod.createTurboConfig).toBe("function");
    expect(mod.defaultPipeline).toBeDefined();
  });

  it("exports helper scripts", async () => {
    const mod = await import("./index.js");
    expect(typeof mod.runBuild).toBe("function");
    expect(typeof mod.runDev).toBe("function");
    expect(typeof mod.runTest).toBe("function");
    expect(typeof mod.runTypokitTask).toBe("function");
  });

  it("exports setup utilities", async () => {
    const mod = await import("./index.js");
    expect(typeof mod.getTurboJsonTemplate).toBe("function");
    expect(typeof mod.getSetupInstructions).toBe("function");
  });
});
