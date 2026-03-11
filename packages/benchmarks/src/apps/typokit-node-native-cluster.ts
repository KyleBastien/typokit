// TypoKit benchmark app — Node.js + native server adapter + cluster mode
// Demonstrates multi-core throughput using Node.js cluster module.

import cluster from "node:cluster";
import type { Worker } from "node:cluster";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { nativeServer } from "@typokit/server-native";
import { buildRouteTable, buildAppResources } from "./shared-routes.ts";

export interface BenchmarkHandle {
  port: number;
  close: () => Promise<void>;
}

const WORKER_COUNT = parseInt(
  process.env["CLUSTER_WORKERS"] ?? "4",
  10,
);

/** Start the TypoKit cluster benchmark app with N workers */
export async function start(dbPath?: string): Promise<BenchmarkHandle> {
  if (cluster.isPrimary) {
    return startPrimary();
  }
  return startWorker(dbPath);
}

function startPrimary(): Promise<BenchmarkHandle> {
  return new Promise<BenchmarkHandle>((resolve) => {
    let readyCount = 0;
    let resolvedPort = 0;
    const workers: Worker[] = [];

    for (let i = 0; i < WORKER_COUNT; i++) {
      const worker = cluster.fork();
      workers.push(worker);

      worker.on("listening", (address: { port: number }) => {
        if (resolvedPort === 0) resolvedPort = address.port;
        readyCount++;
        if (readyCount === WORKER_COUNT) {
          resolve({
            port: resolvedPort,
            close: () => shutdownWorkers(workers),
          });
        }
      });
    }
  });
}

async function startWorker(dbPath?: string): Promise<BenchmarkHandle> {
  const adapter = nativeServer();
  const resources = buildAppResources(dbPath);
  const routeTable = buildRouteTable();

  adapter.registerRoutes(
    routeTable,
    resources.handlerMap,
    resources.middlewareChain,
    resources.validatorMap,
  );

  const handle = await adapter.listen(0);

  const server = adapter.getNativeServer!() as Server;
  const addr = server.address() as AddressInfo;

  // Graceful shutdown when primary disconnects this worker
  cluster.worker?.on("disconnect", () => {
    server.close(() => {
      process.exit(0);
    });
  });

  return {
    port: addr.port,
    async close() {
      await handle.close();
      resources.close();
    },
  };
}

function shutdownWorkers(workers: Worker[]): Promise<void> {
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
    }, 5_000);

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
