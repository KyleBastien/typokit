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
import type { Worker } from "node:cluster";
import { createErrorMiddleware } from "./error-middleware.js";

// ─── Route Group ─────────────────────────────────────────────

/** A group of route handlers registered under a common prefix */
export interface RouteGroup {
  prefix: string;
  handlers: Record<string, unknown>;
  middleware?: MiddlewareEntry[];
}

// ─── Cluster Config ──────────────────────────────────────────

/** Configuration for Node.js cluster mode */
export interface ClusterConfig {
  /** Number of worker processes. Defaults to os.availableParallelism() or os.cpus().length. */
  workers?: number;
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
  /**
   * Enable cluster mode to fork worker processes across CPU cores.
   * Pass `true` for auto-detected worker count, or `{ workers: N }` for explicit count.
   * Requires `node:cluster` (Node.js 16+ or compatible runtime).
   */
  cluster?: true | ClusterConfig;
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

// ─── Cluster Helpers ─────────────────────────────────────────

const CLUSTER_SHUTDOWN_TIMEOUT = 5_000;

function shutdownClusterWorkers(workers: Worker[]): Promise<void> {
  return new Promise<void>((resolve) => {
    const alive = workers.filter((w) => !w.isDead());
    if (alive.length === 0) {
      resolve();
      return;
    }

    let exitedCount = 0;
    const killTimer = setTimeout(() => {
      for (const w of alive) {
        if (!w.isDead()) w.process.kill("SIGKILL");
      }
    }, CLUSTER_SHUTDOWN_TIMEOUT);

    for (const w of alive) {
      w.on("exit", () => {
        exitedCount++;
        if (exitedCount >= alive.length) {
          clearTimeout(killTimer);
          resolve();
        }
      });
      w.disconnect();
    }
  });
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
  let isClusterPrimary = false;

  const app: TypoKitApp = {
    errorMiddleware,

    async listen(port: number): Promise<ServerHandle> {
      // ── Cluster mode ─────────────────────────────────────
      if (options.cluster) {
        const { isPrimary, fork } = await import("node:cluster");

        if (isPrimary) {
          isClusterPrimary = true;
          const { availableParallelism, cpus } = await import("node:os");
          const workerCount =
            typeof options.cluster === "object" && options.cluster.workers
              ? options.cluster.workers
              : typeof availableParallelism === "function"
                ? availableParallelism()
                : cpus().length;

          const handle = await new Promise<ServerHandle>((resolve) => {
            let readyCount = 0;
            const workers: Worker[] = [];

            for (let i = 0; i < workerCount; i++) {
              const worker = fork();
              workers.push(worker);
              worker.on("listening", () => {
                readyCount++;
                if (readyCount === workerCount) {
                  resolve({
                    close: () => shutdownClusterWorkers(workers),
                  });
                }
              });
            }
          });

          serverHandle = handle;
          return handle;
        }
        // Worker: fall through to normal listen
      }

      // ── Normal (single-process) mode ─────────────────────

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
      // Cluster primary skips plugin lifecycle (not serving requests)
      if (!isClusterPrimary) {
        for (const plugin of plugins) {
          if (plugin.onStop) {
            await plugin.onStop(appInstance);
          }
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
