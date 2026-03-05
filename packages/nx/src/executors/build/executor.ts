// @typokit/nx — Build executor
import type { ExecutorContext } from "@nx/devkit";
import type { BuildExecutorSchema } from "./schema.js";
import { resolveProjectRoot, runTypokitCommand } from "../../utils.js";

export default async function buildExecutor(
  options: BuildExecutorSchema,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  const projectRoot = resolveProjectRoot(options.rootDir, context);
  const args = ["build", "--root", projectRoot];
  if (options.verbose) {
    args.push("--verbose");
  }
  return runTypokitCommand(args, projectRoot);
}
