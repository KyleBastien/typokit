// @typokit/core — Plugin Interface & Build Pipeline

import type {
  BuildContext,
  BuildResult,
  CompiledRouteTable,
  CompileContext,
  GeneratedOutput,
  RequestContext,
  SchemaChange,
  SchemaTypeMap,
} from "@typokit/types";
import type { AppError } from "@typokit/errors";

// ─── Hook System ─────────────────────────────────────────────

/** Tapable-style async series hook — plugins tap in, calls run in series */
export interface AsyncSeriesHook<T extends unknown[]> {
  tap(name: string, fn: (...args: T) => void | Promise<void>): void;
  call(...args: T): Promise<void>;
}

// ─── Build Pipeline ──────────────────────────────────────────

/** Tapable build pipeline — plugins hook into build phases via onBuild() */
export interface BuildPipeline {
  hooks: {
    /** Runs before any transforms — plugins can register additional type sources */
    beforeTransform: AsyncSeriesHook<[BuildContext]>;

    /** Runs after types are parsed — plugins can inspect/modify the type map */
    afterTypeParse: AsyncSeriesHook<[SchemaTypeMap, BuildContext]>;

    /** Runs after validators are generated — plugins can add custom validators */
    afterValidators: AsyncSeriesHook<[GeneratedOutput[], BuildContext]>;

    /** Runs after the route table is compiled */
    afterRouteTable: AsyncSeriesHook<[CompiledRouteTable, BuildContext]>;

    /** Runs after all generation — plugins emit their own artifacts */
    emit: AsyncSeriesHook<[GeneratedOutput[], BuildContext]>;

    /** Runs before the default compiler step — plugins can handle compilation
     *  themselves (e.g., run cargo build instead of tsc).
     *  If a plugin sets compileCtx.handled = true, the default compiler is skipped. */
    compile: AsyncSeriesHook<[CompileContext, BuildContext]>;

    /** Runs after build completes — cleanup, reporting */
    done: AsyncSeriesHook<[BuildResult]>;
  };
}

// ─── CLI & Introspection Types ───────────────────────────────

/** A CLI subcommand exposed by a plugin */
export interface CliCommand {
  name: string;
  description: string;
  options?: Array<{ name: string; description: string; required?: boolean }>;
  run(args: Record<string, unknown>): Promise<void>;
}

/** An introspection endpoint exposed by a plugin for the debug sidecar */
export interface InspectEndpoint {
  path: string;
  description: string;
  handler(): Promise<unknown>;
}

// ─── App Instance ────────────────────────────────────────────

/** Represents the running application instance passed to plugin lifecycle hooks */
export interface AppInstance {
  /** Application name */
  name: string;
  /** Registered plugins */
  plugins: TypoKitPlugin[];
  /** Service container for dependency injection */
  services: Record<string, unknown>;
}

// ─── Plugin Interface ────────────────────────────────────────

/** Plugin contract — hooks into both build-time and runtime lifecycle events */
export interface TypoKitPlugin {
  name: string;

  /** Hook into the build pipeline — tap into specific build phases */
  onBuild?(pipeline: BuildPipeline): void;

  /** Hook into server startup — register middleware, services, resources */
  onStart?(app: AppInstance): Promise<void>;

  /** Fires after all routes are registered and the server is listening.
   *  Use for service discovery, health check readiness, warmup. */
  onReady?(app: AppInstance): Promise<void>;

  /** Observe unhandled errors — reporting, transformation (e.g. Sentry).
   *  Called after the framework's error middleware serializes the response. */
  onError?(error: AppError, ctx: RequestContext): void;

  /** Hook into server shutdown — cleanup connections, flush buffers */
  onStop?(app: AppInstance): Promise<void>;

  /** Dev mode only — fires when schema types change and the build regenerates.
   *  Use to refresh cached state (e.g. debug sidecar route map). */
  onSchemaChange?(changes: SchemaChange[]): void;

  /** Expose CLI subcommands */
  commands?(): CliCommand[];

  /** Expose introspection endpoints for the debug sidecar */
  inspect?(): InspectEndpoint[];
}
