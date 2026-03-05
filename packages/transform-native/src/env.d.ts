// Minimal type declarations for Node.js APIs used by transform-native
// Avoids adding @types/node as a dependency

declare module "module" {
  export function createRequire(url: string | URL): (id: string) => unknown;
}

declare module "path" {
  export function join(...paths: string[]): string;
  export function dirname(p: string): string;
}

declare module "fs" {
  export function existsSync(path: string): boolean;
  export function mkdirSync(
    path: string,
    options?: { recursive?: boolean },
  ): void;
  export function readFileSync(path: string, encoding: string): string;
  export function writeFileSync(
    path: string,
    data: string,
    encoding?: string,
  ): void;
  export function unlinkSync(path: string): void;
  export function rmSync(
    path: string,
    options?: { recursive?: boolean; force?: boolean },
  ): void;
  export function readdirSync(path: string): string[];
  export function statSync(path: string): { isDirectory(): boolean };
}

declare module "os" {
  export function tmpdir(): string;
}

interface ImportMeta {
  url: string;
}
