// Minimal type declarations for Deno globals and @db/sqlite so the package
// compiles under Node16 moduleResolution without Deno types installed.

declare namespace Deno {
  interface ServeOptions {
    port?: number;
    onListen?: (addr: { port: number; hostname: string }) => void;
  }
  interface HttpServer {
    addr: { port: number; hostname: string };
    shutdown(): Promise<void>;
  }
  function serve(
    options: ServeOptions,
    handler: (req: Request) => Response | Promise<Response>,
  ): HttpServer;
}

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
