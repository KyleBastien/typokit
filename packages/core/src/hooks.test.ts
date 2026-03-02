// @typokit/core — Hook System Tests

import { describe, it, expect } from "@rstest/core";
import {
  AsyncSeriesHookImpl,
  createBuildPipeline,
  getPipelineTaps,
  BUILD_HOOK_PHASES,
} from "./hooks.js";

import type { BuildContext, BuildResult, GeneratedOutput } from "@typokit/types";
import type { TypoKitPlugin } from "./plugin.js";

// ─── AsyncSeriesHookImpl Tests ──────────────────────────────

describe("AsyncSeriesHookImpl", () => {
  it("should execute taps in registration order", async () => {
    const hook = new AsyncSeriesHookImpl<[string]>();
    const order: string[] = [];

    hook.tap("first", () => { order.push("first"); });
    hook.tap("second", () => { order.push("second"); });
    hook.tap("third", () => { order.push("third"); });

    await hook.call("test");

    expect(order).toEqual(["first", "second", "third"]);
  });

  it("should pass arguments to all taps", async () => {
    const hook = new AsyncSeriesHookImpl<[number, string]>();
    const received: Array<[number, string]> = [];

    hook.tap("a", (n, s) => { received.push([n, s]); });
    hook.tap("b", (n, s) => { received.push([n, s]); });

    await hook.call(42, "hello");

    expect(received).toEqual([[42, "hello"], [42, "hello"]]);
  });

  it("should handle async taps", async () => {
    const hook = new AsyncSeriesHookImpl<[string]>();
    const order: string[] = [];

    hook.tap("sync", () => { order.push("sync"); });
    hook.tap("async", async () => {
      await new Promise<void>((resolve) => {
        const g = globalThis as unknown as { setTimeout: (fn: () => void, ms: number) => unknown };
        g.setTimeout(resolve, 10);
      });
      order.push("async");
    });
    hook.tap("after", () => { order.push("after"); });

    await hook.call("test");

    expect(order).toEqual(["sync", "async", "after"]);
  });

  it("should work with zero taps", async () => {
    const hook = new AsyncSeriesHookImpl<[string]>();
    // Should not throw
    await hook.call("test");
  });

  it("should expose taps array for introspection", () => {
    const hook = new AsyncSeriesHookImpl<[string]>();
    hook.tap("myPlugin", () => {});
    hook.tap("otherPlugin", () => {});

    expect(hook.taps.length).toBe(2);
    expect(hook.taps[0].name).toBe("myPlugin");
    expect(hook.taps[1].name).toBe("otherPlugin");
  });

  it("should allow multiple taps with the same name", async () => {
    const hook = new AsyncSeriesHookImpl<[string]>();
    const calls: number[] = [];

    hook.tap("plugin", () => { calls.push(1); });
    hook.tap("plugin", () => { calls.push(2); });

    await hook.call("test");

    expect(calls).toEqual([1, 2]);
  });

  it("should propagate errors from taps", async () => {
    const hook = new AsyncSeriesHookImpl<[string]>();

    hook.tap("good", () => {});
    hook.tap("bad", () => { throw new Error("tap failed"); });
    hook.tap("unreached", () => {});

    let caught: Error | null = null;
    try {
      await hook.call("test");
    } catch (e) {
      caught = e as Error;
    }

    expect(caught).not.toBeNull();
    expect(caught?.message).toBe("tap failed");
  });

  it("should allow taps to mutate shared context objects", async () => {
    const hook = new AsyncSeriesHookImpl<[{ items: string[] }]>();

    hook.tap("first", (ctx) => { ctx.items.push("a"); });
    hook.tap("second", (ctx) => { ctx.items.push("b"); });

    const context = { items: [] as string[] };
    await hook.call(context);

    expect(context.items).toEqual(["a", "b"]);
  });
});

// ─── createBuildPipeline Tests ──────────────────────────────

describe("createBuildPipeline", () => {
  it("should create a pipeline with all 6 hook phases", () => {
    const pipeline = createBuildPipeline();

    expect(pipeline.hooks.beforeTransform).toBeInstanceOf(AsyncSeriesHookImpl);
    expect(pipeline.hooks.afterTypeParse).toBeInstanceOf(AsyncSeriesHookImpl);
    expect(pipeline.hooks.afterValidators).toBeInstanceOf(AsyncSeriesHookImpl);
    expect(pipeline.hooks.afterRouteTable).toBeInstanceOf(AsyncSeriesHookImpl);
    expect(pipeline.hooks.emit).toBeInstanceOf(AsyncSeriesHookImpl);
    expect(pipeline.hooks.done).toBeInstanceOf(AsyncSeriesHookImpl);
  });

  it("should create independent hooks (not shared instances)", () => {
    const pipeline = createBuildPipeline();
    expect(pipeline.hooks.beforeTransform).not.toBe(pipeline.hooks.done);
  });

  it("should fire hooks at correct pipeline phases with typed context", async () => {
    const pipeline = createBuildPipeline();
    const phases: string[] = [];

    const buildCtx: BuildContext = {
      rootDir: "/test",
      outDir: "/test/dist",
      dev: false,
      outputs: [],
    };

    pipeline.hooks.beforeTransform.tap("test", (ctx) => {
      phases.push("beforeTransform");
      expect(ctx.rootDir).toBe("/test");
    });

    pipeline.hooks.afterTypeParse.tap("test", (types, ctx) => {
      phases.push("afterTypeParse");
      expect(types).toBeDefined();
      expect(ctx.rootDir).toBe("/test");
    });

    pipeline.hooks.afterValidators.tap("test", (outputs, ctx) => {
      phases.push("afterValidators");
      expect(Array.isArray(outputs)).toBe(true);
      expect(ctx.rootDir).toBe("/test");
    });

    pipeline.hooks.afterRouteTable.tap("test", (_table, ctx) => {
      phases.push("afterRouteTable");
      expect(ctx.rootDir).toBe("/test");
    });

    pipeline.hooks.emit.tap("test", (outputs, ctx) => {
      phases.push("emit");
      expect(Array.isArray(outputs)).toBe(true);
      expect(ctx.rootDir).toBe("/test");
    });

    const buildResult: BuildResult = {
      success: true,
      outputs: [],
      duration: 100,
      errors: [],
    };

    pipeline.hooks.done.tap("test", (result) => {
      phases.push("done");
      expect(result.success).toBe(true);
    });

    // Simulate build pipeline execution order
    await pipeline.hooks.beforeTransform.call(buildCtx);
    await pipeline.hooks.afterTypeParse.call({}, buildCtx);
    await pipeline.hooks.afterValidators.call([], buildCtx);
    await pipeline.hooks.afterRouteTable.call({
      segment: "",
      children: {},
      handlers: {},
    }, buildCtx);
    await pipeline.hooks.emit.call([], buildCtx);
    await pipeline.hooks.done.call(buildResult);

    expect(phases).toEqual([
      "beforeTransform",
      "afterTypeParse",
      "afterValidators",
      "afterRouteTable",
      "emit",
      "done",
    ]);
  });

  it("should allow multiple plugins to tap the same hook", async () => {
    const pipeline = createBuildPipeline();
    const calls: string[] = [];

    const buildCtx: BuildContext = {
      rootDir: "/test",
      outDir: "/test/dist",
      dev: false,
      outputs: [],
    };

    // Plugin A
    pipeline.hooks.beforeTransform.tap("pluginA", () => {
      calls.push("A:beforeTransform");
    });
    pipeline.hooks.emit.tap("pluginA", () => {
      calls.push("A:emit");
    });

    // Plugin B
    pipeline.hooks.beforeTransform.tap("pluginB", () => {
      calls.push("B:beforeTransform");
    });
    pipeline.hooks.emit.tap("pluginB", () => {
      calls.push("B:emit");
    });

    await pipeline.hooks.beforeTransform.call(buildCtx);
    await pipeline.hooks.emit.call([], buildCtx);

    expect(calls).toEqual([
      "A:beforeTransform",
      "B:beforeTransform",
      "A:emit",
      "B:emit",
    ]);
  });

  it("should work with TypoKitPlugin.onBuild() interface", async () => {
    const pipeline = createBuildPipeline();
    const tapped: string[] = [];

    const plugin: TypoKitPlugin = {
      name: "test-plugin",
      onBuild(p) {
        p.hooks.beforeTransform.tap("test-plugin", () => {
          tapped.push("beforeTransform");
        });
        p.hooks.done.tap("test-plugin", () => {
          tapped.push("done");
        });
      },
    };

    // Plugins register taps via onBuild
    plugin.onBuild?.(pipeline);

    const buildCtx: BuildContext = {
      rootDir: "/test",
      outDir: "/test/dist",
      dev: false,
      outputs: [],
    };

    await pipeline.hooks.beforeTransform.call(buildCtx);
    await pipeline.hooks.done.call({
      success: true,
      outputs: [],
      duration: 50,
      errors: [],
    });

    expect(tapped).toEqual(["beforeTransform", "done"]);
  });

  it("should allow emit hook to add outputs", async () => {
    const pipeline = createBuildPipeline();

    const buildCtx: BuildContext = {
      rootDir: "/test",
      outDir: "/test/dist",
      dev: false,
      outputs: [],
    };

    const emittedOutputs: GeneratedOutput[] = [];

    pipeline.hooks.emit.tap("custom-plugin", (outputs) => {
      const newOutput: GeneratedOutput = {
        filePath: "custom/output.ts",
        content: "// generated",
        overwrite: true,
      };
      outputs.push(newOutput);
      emittedOutputs.push(newOutput);
    });

    const outputs: GeneratedOutput[] = [];
    await pipeline.hooks.emit.call(outputs, buildCtx);

    expect(outputs.length).toBe(1);
    expect(outputs[0].filePath).toBe("custom/output.ts");
    expect(emittedOutputs.length).toBe(1);
  });
});

// ─── getPipelineTaps Tests ──────────────────────────────────

describe("getPipelineTaps", () => {
  it("should return empty array for fresh pipeline", () => {
    const pipeline = createBuildPipeline();
    const taps = getPipelineTaps(pipeline);
    expect(taps).toEqual([]);
  });

  it("should return all registered taps with hook name and order", () => {
    const pipeline = createBuildPipeline();

    pipeline.hooks.beforeTransform.tap("pluginA", () => {});
    pipeline.hooks.beforeTransform.tap("pluginB", () => {});
    pipeline.hooks.emit.tap("pluginA", () => {});
    pipeline.hooks.done.tap("pluginC", () => {});

    const taps = getPipelineTaps(pipeline);

    expect(taps).toEqual([
      { hookName: "beforeTransform", tapName: "pluginA", order: 0 },
      { hookName: "beforeTransform", tapName: "pluginB", order: 1 },
      { hookName: "emit", tapName: "pluginA", order: 0 },
      { hookName: "done", tapName: "pluginC", order: 0 },
    ]);
  });

  it("should respect registration order within each hook", () => {
    const pipeline = createBuildPipeline();

    pipeline.hooks.afterTypeParse.tap("z-plugin", () => {});
    pipeline.hooks.afterTypeParse.tap("a-plugin", () => {});
    pipeline.hooks.afterTypeParse.tap("m-plugin", () => {});

    const taps = getPipelineTaps(pipeline);

    expect(taps[0].tapName).toBe("z-plugin");
    expect(taps[0].order).toBe(0);
    expect(taps[1].tapName).toBe("a-plugin");
    expect(taps[1].order).toBe(1);
    expect(taps[2].tapName).toBe("m-plugin");
    expect(taps[2].order).toBe(2);
  });
});

// ─── BUILD_HOOK_PHASES Tests ────────────────────────────────

describe("BUILD_HOOK_PHASES", () => {
  it("should list all 6 phases in execution order", () => {
    expect(BUILD_HOOK_PHASES).toEqual([
      "beforeTransform",
      "afterTypeParse",
      "afterValidators",
      "afterRouteTable",
      "emit",
      "done",
    ]);
  });

  it("should match the keys in BuildPipeline.hooks", () => {
    const pipeline = createBuildPipeline();
    for (const phase of BUILD_HOOK_PHASES) {
      expect(pipeline.hooks[phase]).toBeInstanceOf(AsyncSeriesHookImpl);
    }
  });
});
