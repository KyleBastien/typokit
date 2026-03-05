// @typokit/core — App Factory (createApp)

import type {
  ServerHandle,
  Logger,
  TypoKitRequest,
  RequestContext,
  TypoKitResponse,
} from "@typokit/types";
import type { ServerAdapter } from "./adapters/server.js";
import type { TypoKitPlugin, AppInstance } from "./plugin.js";
import type { MiddlewareEntry } from "./middleware.js";
import { createErrorMiddleware } from "./error-middleware.js";

// ─── Route Group ─────────────────────────────────────────────

/** A group of route handlers registered under a common prefix */
export interface RouteGroup {
  prefix: string;
  handlers: Record<string, unknown>;
  middleware?: MiddlewareEntry[];
}

// ─── createApp Options ───────────────────────────────────────

/** Options accepted by the createApp() factory function */
export interface CreateAppOptions {
  server: ServerAdapter;
  middleware?: MiddlewareEntry[];
  routes: RouteGroup[];
  plugins?: TypoKitPlugin[];
  logging?: Partial<Logger>;
  telemetry?: Record<string, unknown>;
}

// ─── App Interface ───────────────────────────────────────────

/** The application instance returned by createApp() */
export interface TypoKitApp {
  /** Start the server on the given port */
  listen(port: number): Promise<ServerHandle>;
  /** Expose the underlying server framework instance */
  getNativeServer(): unknown;
  /** Gracefully shut down the application */
  close(): Promise<void>;
  /** The auto-registered error middleware for use by server adapters */
  errorMiddleware: (
    req: TypoKitRequest,
    ctx: RequestContext,
    next: () => Promise<TypoKitResponse>,
  ) => Promise<TypoKitResponse>;
}

// ─── createApp Factory ──────────────────────────────────────

/**
 * Create a TypoKit application from a server adapter, middleware,
 * routes, and plugins.
 */
export function createApp(options: CreateAppOptions): TypoKitApp {
  const { server, plugins = [] } = options;

  const appInstance: AppInstance = {
    name: server.name,
    plugins,
    services: {},
  };

  // Auto-register error middleware for the request pipeline
  const errorMiddleware = createErrorMiddleware();

  let serverHandle: ServerHandle | null = null;

  const app: TypoKitApp = {
    errorMiddleware,

    async listen(port: number): Promise<ServerHandle> {
      // 1. Call plugin onStart hooks
      for (const plugin of plugins) {
        if (plugin.onStart) {
          await plugin.onStart(appInstance);
        }
      }

      // 2. Delegate to server adapter
      serverHandle = await server.listen(port);

      // 3. Call plugin onReady hooks
      for (const plugin of plugins) {
        if (plugin.onReady) {
          await plugin.onReady(appInstance);
        }
      }

      return serverHandle;
    },

    getNativeServer(): unknown {
      return server.getNativeServer?.() ?? null;
    },

    async close(): Promise<void> {
      // Call plugin onStop hooks
      for (const plugin of plugins) {
        if (plugin.onStop) {
          await plugin.onStop(appInstance);
        }
      }

      if (serverHandle) {
        await serverHandle.close();
        serverHandle = null;
      }
    },
  };

  return app;
}
