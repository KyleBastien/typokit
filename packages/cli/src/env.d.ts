// Minimal type declarations for Node.js APIs used by @typokit/cli
// Avoids adding @types/node as a dependency

declare module "module" {
  export function createRequire(url: string | URL): (id: string) => unknown;
}

declare module "path" {
  export function join(...paths: string[]): string;
  export function dirname(p: string): string;
  export function resolve(...paths: string[]): string;
  export function relative(from: string, to: string): string;
  export function basename(p: string, ext?: string): string;
  export function extname(p: string): string;
  export function isAbsolute(p: string): boolean;
}

declare module "fs" {
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function readFileSync(path: string, encoding: string): string;
  export function writeFileSync(path: string, data: string, encoding?: string): void;
  export function readdirSync(path: string, options?: { recursive?: boolean; withFileTypes?: boolean }): string[];
  export function statSync(path: string): { isDirectory(): boolean; isFile(): boolean };
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
}

declare module "child_process" {
  interface SpawnSyncResult {
    status: number | null;
    stdout: string;
    stderr: string;
    error?: Error;
  }
  export function spawnSync(
    command: string,
    args: string[],
    options?: { cwd?: string; encoding?: string; stdio?: string | string[] }
  ): SpawnSyncResult;
}

declare module "url" {
  export function pathToFileURL(path: string): URL;
  export function fileURLToPath(url: string | URL): string;
}

interface ImportMeta {
  url: string;
}
