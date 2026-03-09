// Minimal type declarations for @db/sqlite so the package compiles
// under Node16 moduleResolution without Deno types installed.

declare module "@db/sqlite" {
  export class Database {
    constructor(
      path: string,
      options?: { readonly?: boolean; create?: boolean },
    );
    prepare<T = unknown>(sql: string): Statement<T>;
    close(): void;
  }

  export class Statement<T = unknown> {
    get(...params: unknown[]): T | undefined;
    all(...params: unknown[]): T[];
    run(...params: unknown[]): void;
  }
}
