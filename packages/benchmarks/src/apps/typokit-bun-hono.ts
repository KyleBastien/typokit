// TypoKit benchmark app — Bun + Hono server adapter

import type { AddressInfo } from "node:net";
import type { ServerHandle } from "@typokit/types";
import { honoServer } from "@typokit/server-hono";
import { buildRouteTable, buildAppResourcesBun } from "./shared-routes-bun.ts";

export interface BenchmarkHandle {
  port: number;
  close: () => Promise<void>;
}

/** Start the TypoKit Bun benchmark app with the Hono server adapter */
export async function start(dbPath?: string): Promise<BenchmarkHandle> {
  const adapter = honoServer();
  const resources = buildAppResourcesBun(dbPath);
  const routeTable = buildRouteTable();

  adapter.registerRoutes(
    routeTable,
    resources.handlerMap,
    resources.middlewareChain,
    resources.validatorMap,
  );

  const handle = await adapter.listen(0);

  // Hono adapter exposes _server on the handle
  const server = (
    handle as ServerHandle & { _server: { address(): AddressInfo } }
  )._server;
  const addr = server.address();

  return {
    port: addr.port,
    async close() {
      await handle.close();
      resources.close();
    },
  };
}
