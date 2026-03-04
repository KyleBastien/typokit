// @typokit/nx — Test executor
import type { ExecutorContext } from "@nx/devkit";
import type { TestExecutorSchema } from "./schema.js";
import { resolveProjectRoot, runTypokitCommand } from "../../utils.js";

export default async function testExecutor(
  options: TestExecutorSchema,
  context: ExecutorContext
): Promise<{ success: boolean }> {
  const projectRoot = resolveProjectRoot(options.rootDir, context);
  const subcommand = options.subcommand ?? "all";
  const command = subcommand === "all" ? "test" : `test:${subcommand}`;
  const args = [command, "--root", projectRoot];
  if (options.verbose) {
    args.push("--verbose");
  }
  if (options.runner) {
    args.push("--runner", options.runner);
  }
  return runTypokitCommand(args, projectRoot);
}
