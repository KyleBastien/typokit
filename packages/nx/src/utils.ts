// @typokit/nx — Shared utilities for executors and generators
import type { ExecutorContext } from "@nx/devkit";

/** Resolve the project root directory from executor options and context */
export function resolveProjectRoot(
  rootDir: string | undefined,
  context: ExecutorContext
): string {
  if (rootDir) {
    return rootDir;
  }
  const projectName = context.projectName;
  if (projectName && context.projectsConfigurations?.projects?.[projectName]) {
    const project = context.projectsConfigurations.projects[projectName];
    return joinPaths(context.root, project.root);
  }
  return context.root;
}

/** Run a typokit CLI command as a child process */
export async function runTypokitCommand(
  args: string[],
  cwd: string
): Promise<{ success: boolean }> {
  const cp = await import(/* @vite-ignore */ "child_process") as {
    execSync: (cmd: string, opts: Record<string, unknown>) => unknown;
  };

  const command = `npx typokit ${args.join(" ")}`;
  try {
    cp.execSync(command, {
      cwd,
      stdio: "inherit",
      env: { ...(getProcessEnv()), FORCE_COLOR: "true" },
    });
    return { success: true };
  } catch {
    return { success: false };
  }
}

/** Join path segments (avoids importing path at top level for no-@types/node compat) */
function joinPaths(...segments: string[]): string {
  return segments
    .join("/")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
}

/** Get process.env safely */
function getProcessEnv(): Record<string, string | undefined> {
  const g = globalThis as Record<string, unknown>;
  const proc = g["process"] as { env: Record<string, string | undefined> } | undefined;
  return proc?.env ?? {};
}
