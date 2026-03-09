// Minimal type declarations for bun:sqlite so the package compiles
// under Node16 moduleResolution without bun-types installed.

declare module "bun:sqlite" {
  export class Database {
    constructor(
      path: string,
      options?: { readonly?: boolean; create?: boolean },
    );
    prepare<T = unknown>(sql: string): Statement<T>;
    close(): void;
  }

  export class Statement<T = unknown> {
    get(...params: unknown[]): T | null;
    all(...params: unknown[]): T[];
    run(...params: unknown[]): void;
  }
}
