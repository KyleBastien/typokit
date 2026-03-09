// TypoKit benchmark app — Node.js + Express server adapter

import type { AddressInfo } from "node:net";
import type { ServerHandle } from "@typokit/types";
import { expressServer } from "@typokit/server-express";
import { buildRouteTable, buildAppResources } from "./shared-routes.ts";

export interface BenchmarkHandle {
  port: number;
  close: () => Promise<void>;
}

/** Start the TypoKit benchmark app with the Express server adapter */
export async function start(dbPath?: string): Promise<BenchmarkHandle> {
  const adapter = expressServer();
  const resources = buildAppResources(dbPath);
  const routeTable = buildRouteTable();

  adapter.registerRoutes(
    routeTable,
    resources.handlerMap,
    resources.middlewareChain,
    resources.validatorMap,
  );

  const handle = await adapter.listen(0);

  // Express adapter exposes _server on the handle
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
