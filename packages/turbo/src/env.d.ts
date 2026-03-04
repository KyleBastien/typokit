// Environment type declarations for @typokit/turbo (no @types/node)
declare module "child_process" {
  export function execSync(
    command: string,
    options?: Record<string, unknown>
  ): unknown;
}
