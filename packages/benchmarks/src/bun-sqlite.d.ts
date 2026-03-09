// Minimal type declarations for Bun globals and bun:sqlite so the package
// compiles under Node16 moduleResolution without bun-types installed.

declare namespace Bun {
  interface ServeOptions {
    port?: number;
    fetch(req: Request): Response | Promise<Response>;
  }
  interface Server {
    port: number;
    stop(closeActiveConnections?: boolean): void;
  }
  function serve(options: ServeOptions): Server;
}

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
