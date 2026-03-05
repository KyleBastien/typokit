// @typokit/core — Tapable Hook System Implementation

import type {
  BuildContext,
  BuildResult,
  CompiledRouteTable,
  GeneratedOutput,
  SchemaTypeMap,
} from "@typokit/types";

// ─── AsyncSeriesHook Implementation ─────────────────────────

/** A tap registration entry */
export interface TapEntry<T extends unknown[]> {
  name: string;
  fn: (...args: T) => void | Promise<void>;
}

/**
 * Tapable-style async series hook.
 * Hooks execute in registration order; each receives the same args.
 */
export class AsyncSeriesHookImpl<T extends unknown[]> {
  readonly taps: TapEntry<T>[] = [];

  /** Register a named tap */
  tap(name: string, fn: (...args: T) => void | Promise<void>): void {
    this.taps.push({ name, fn });
  }

  /** Execute all taps in series, in registration order */
  async call(...args: T): Promise<void> {
    for (const entry of this.taps) {
      await entry.fn(...args);
    }
  }
}

// ─── Build Pipeline Implementation ──────────────────────────

/** Concrete build pipeline with all 6 hook phases */
export interface BuildPipelineInstance {
  hooks: {
    beforeTransform: AsyncSeriesHookImpl<[BuildContext]>;
    afterTypeParse: AsyncSeriesHookImpl<[SchemaTypeMap, BuildContext]>;
    afterValidators: AsyncSeriesHookImpl<[GeneratedOutput[], BuildContext]>;
    afterRouteTable: AsyncSeriesHookImpl<[CompiledRouteTable, BuildContext]>;
    emit: AsyncSeriesHookImpl<[GeneratedOutput[], BuildContext]>;
    done: AsyncSeriesHookImpl<[BuildResult]>;
  };
}

/**
 * Create a new build pipeline with empty hooks for all 6 phases.
 * Plugins call `onBuild(pipeline)` to tap into specific phases.
 */
export function createBuildPipeline(): BuildPipelineInstance {
  return {
    hooks: {
      beforeTransform: new AsyncSeriesHookImpl<[BuildContext]>(),
      afterTypeParse: new AsyncSeriesHookImpl<[SchemaTypeMap, BuildContext]>(),
      afterValidators: new AsyncSeriesHookImpl<
        [GeneratedOutput[], BuildContext]
      >(),
      afterRouteTable: new AsyncSeriesHookImpl<
        [CompiledRouteTable, BuildContext]
      >(),
      emit: new AsyncSeriesHookImpl<[GeneratedOutput[], BuildContext]>(),
      done: new AsyncSeriesHookImpl<[BuildResult]>(),
    },
  };
}

/** Hook phase names in execution order */
export const BUILD_HOOK_PHASES = [
  "beforeTransform",
  "afterTypeParse",
  "afterValidators",
  "afterRouteTable",
  "emit",
  "done",
] as const;

export type BuildHookPhase = (typeof BUILD_HOOK_PHASES)[number];

/** Metadata about a registered tap for introspection */
export interface TapInfo {
  hookName: string;
  tapName: string;
  order: number;
}

/**
 * Get introspection info about all registered taps in a build pipeline.
 * Used by `typokit inspect build-pipeline --json`.
 */
export function getPipelineTaps(pipeline: BuildPipelineInstance): TapInfo[] {
  const taps: TapInfo[] = [];

  for (const phase of BUILD_HOOK_PHASES) {
    const hook = pipeline.hooks[phase];
    // Use type assertion since AsyncSeriesHookImpl always has taps
    const hookImpl = hook as AsyncSeriesHookImpl<unknown[]>;
    for (let i = 0; i < hookImpl.taps.length; i++) {
      taps.push({
        hookName: phase,
        tapName: hookImpl.taps[i].name,
        order: i,
      });
    }
  }

  return taps;
}
