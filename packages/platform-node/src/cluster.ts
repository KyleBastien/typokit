// @typokit/platform-node — Cluster Mode
//
// Uses node:cluster to fork workers across all available CPU cores.
// Workers share the same port via the cluster module's built-in load balancing.

import cluster from "node:cluster";
import { availableParallelism, cpus } from "node:os";
import { createServer } from "./index.js";
import type { NodeRequestHandler, NodeServerOptions } from "./index.js";
import type { ServerHandle } from "@typokit/types";

// ─── Cluster Options ─────────────────────────────────────────

export interface ClusterServerOptions extends NodeServerOptions {
  /** Number of worker processes to fork. Defaults to os.availableParallelism() or os.cpus().length. */
  workers?: number;
  /** Timeout in ms to wait for workers to gracefully shut down before force-killing (default: 5000) */
  shutdownTimeout?: number;
}

// ─── Cluster Server Result ───────────────────────────────────

export interface ClusterServer {
  /** Start listening on the given port. Returns a handle for graceful shutdown. */
  listen(port: number): Promise<ServerHandle>;
  /** Whether this process is the primary (true) or a worker (false) */
  isPrimary: boolean;
  /** Number of worker processes (only meaningful on primary) */
  workerCount: number;
}

// ─── Helpers ─────────────────────────────────────────────────

/** Get the default number of workers using os.availableParallelism() with cpus().length fallback */
export function getDefaultWorkerCount(): number {
  if (typeof availableParallelism === "function") {
    return availableParallelism();
  }
  return cpus().length;
}

// ─── createClusterServer ─────────────────────────────────────

/**
 * Create a clustered Node.js HTTP server that forks worker processes
 * to utilize all available CPU cores.
 *
 * The same script must run on both primary and worker processes (standard
 * Node.js cluster pattern). On the primary, `listen()` forks workers and
 * waits for them all to bind the port. On each worker, `listen()` creates
 * a standard HTTP server whose port is shared via the cluster module's
 * built-in round-robin load balancing.
 *
 * Usage:
 * ```ts
 * const srv = createClusterServer(async (req) => ({
 *   status: 200,
 *   headers: {},
 *   body: { ok: true },
 * }));
 * const handle = await srv.listen(3000);
 * // ... later
 * await handle.close(); // Gracefully shuts down all workers
 * ```
 */
export function createClusterServer(
  handler: NodeRequestHandler,
  options: ClusterServerOptions = {},
): ClusterServer {
  const workerCount = options.workers ?? getDefaultWorkerCount();
  const shutdownTimeout = options.shutdownTimeout ?? 5_000;

  if (cluster.isPrimary) {
    return {
      isPrimary: true,
      workerCount,
      listen(port: number): Promise<ServerHandle> {
        return new Promise((resolve) => {
          let readyCount = 0;

          for (let i = 0; i < workerCount; i++) {
            const worker = cluster.fork({ TYPOKIT_PORT: String(port) });
            worker.on("listening", () => {
              readyCount++;
              if (readyCount === workerCount) {
                resolve({
                  close: () => shutdownAllWorkers(shutdownTimeout),
                });
              }
            });
          }
        });
      },
    };
  }

  // Worker process — create a real HTTP server with graceful shutdown wiring
  const inner = createServer(handler, options);

  // Listen for disconnect from the primary (triggered during graceful shutdown).
  // Close the server so in-flight requests drain before the process exits.
  if (cluster.worker) {
    cluster.worker.on("disconnect", () => {
      inner.server.close(() => {
        process.exit(0);
      });
    });
  }

  // Also handle SIGTERM for external process managers (systemd, Docker, etc.)
  process.on("SIGTERM", () => {
    inner.server.close(() => {
      process.exit(0);
    });
  });

  return {
    isPrimary: false,
    workerCount,
    listen(port: number): Promise<ServerHandle> {
      return inner.listen(port);
    },
  };
}

// ─── Graceful Shutdown ───────────────────────────────────────

/**
 * Disconnect all workers (stops new connections) and wait for them to exit.
 * Workers handle in-flight request draining via the 'disconnect' event.
 * If a worker doesn't exit within the timeout, it is force-killed.
 */
function shutdownAllWorkers(timeout: number): Promise<void> {
  return new Promise((resolve) => {
    const workers = Object.values(cluster.workers ?? {}).filter(
      (w): w is NonNullable<typeof w> => w != null && !w.isDead(),
    );

    if (workers.length === 0) {
      resolve();
      return;
    }

    let exitedCount = 0;
    const total = workers.length;

    const killTimer = setTimeout(() => {
      for (const w of workers) {
        if (!w.isDead()) {
          w.process.kill("SIGKILL");
        }
      }
    }, timeout);

    for (const worker of workers) {
      worker.on("exit", () => {
        exitedCount++;
        if (exitedCount >= total) {
          clearTimeout(killTimer);
          resolve();
        }
      });
      // disconnect() stops new connections and triggers 'disconnect' on the worker,
      // which initiates server.close() to drain in-flight requests
      worker.disconnect();
    }
  });
}
