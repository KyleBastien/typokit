// @typokit/nx — Nx Executor & Generator Plugin

// Executors
export { default as buildExecutor } from "./executors/build/executor.js";
export { default as devExecutor } from "./executors/dev/executor.js";
export { default as testExecutor } from "./executors/test/executor.js";

// Generators
export { default as initGenerator } from "./generators/init/generator.js";
export { default as routeGenerator } from "./generators/route/generator.js";

// Utilities
export { resolveProjectRoot, runTypokitCommand } from "./utils.js";

// Types
export type { BuildExecutorSchema } from "./executors/build/schema.js";
export type { DevExecutorSchema } from "./executors/dev/schema.js";
export type { TestExecutorSchema } from "./executors/test/schema.js";
export type { InitGeneratorSchema } from "./generators/init/schema.js";
export type { RouteGeneratorSchema } from "./generators/route/schema.js";
