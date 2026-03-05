// @typokit/nx — Dev executor
import type { ExecutorContext } from "@nx/devkit";
import type { DevExecutorSchema } from "./schema.js";
import { resolveProjectRoot, runTypokitCommand } from "../../utils.js";

export default async function devExecutor(
  options: DevExecutorSchema,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  const projectRoot = resolveProjectRoot(options.rootDir, context);
  const args = ["dev", "--root", projectRoot];
  if (options.verbose) {
    args.push("--verbose");
  }
  if (options.debugPort != null) {
    args.push("--debug-port", String(options.debugPort));
  }
  return runTypokitCommand(args, projectRoot);
}
