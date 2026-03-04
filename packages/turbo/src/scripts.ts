// @typokit/turbo — Helper scripts wrapping typokit CLI for Turborepo

/** Options for running a TypoKit task */
export interface TaskOptions {
  /** Working directory (defaults to process.cwd()) */
  cwd?: string;
  /** Additional CLI arguments */
  args?: string[];
  /** Environment variables to set */
  env?: Record<string, string>;
}

/** Get process.env safely (no @types/node) */
function getProcessEnv(): Record<string, string | undefined> {
  const g = globalThis as Record<string, unknown>;
  const proc = g["process"] as { env: Record<string, string | undefined> } | undefined;
  return proc?.env ?? {};
}

/** Get process.cwd() safely */
function getProcessCwd(): string {
  const g = globalThis as Record<string, unknown>;
  const proc = g["process"] as { cwd: () => string } | undefined;
  return proc?.cwd() ?? ".";
}

/**
 * Run a typokit CLI command as a child process.
 * Designed for use in Turborepo task scripts.
 */
export async function runTypokitTask(
  command: string,
  options?: TaskOptions
): Promise<{ success: boolean }> {
  const cp = await import(/* @vite-ignore */ "child_process") as {
    execSync: (cmd: string, opts: Record<string, unknown>) => unknown;
  };

  const cwd = options?.cwd ?? getProcessCwd();
  const extraArgs = options?.args?.join(" ") ?? "";
  const fullCommand = `npx typokit ${command}${extraArgs ? " " + extraArgs : ""}`;

  try {
    cp.execSync(fullCommand, {
      cwd,
      stdio: "inherit",
      env: {
        ...getProcessEnv(),
        FORCE_COLOR: "true",
        ...options?.env,
      },
    });
    return { success: true };
  } catch {
    return { success: false };
  }
}

/** Run `typokit build` — suitable as a Turborepo build task */
export async function runBuild(options?: TaskOptions): Promise<{ success: boolean }> {
  return runTypokitTask("build", options);
}

/** Run `typokit dev` — suitable as a Turborepo dev task */
export async function runDev(options?: TaskOptions): Promise<{ success: boolean }> {
  return runTypokitTask("dev", options);
}

/** Run `typokit test` — suitable as a Turborepo test task */
export async function runTest(options?: TaskOptions): Promise<{ success: boolean }> {
  return runTypokitTask("test", options);
}
