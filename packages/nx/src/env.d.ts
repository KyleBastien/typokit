// Minimal type declarations for Node.js APIs used by @typokit/nx
// Avoids adding @types/node as a dependency

declare module "child_process" {
  export function execSync(
    command: string,
    options?: {
      cwd?: string;
      stdio?: string;
      env?: Record<string, string | undefined>;
    },
  ): unknown;
}
