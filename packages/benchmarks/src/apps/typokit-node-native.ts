// TypoKit benchmark app — Node.js + native server adapter
// Uses @typokit/server-native with zero external HTTP dependencies.

import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { nativeServer } from "@typokit/server-native";
import { buildRouteTable, buildAppResources } from "./shared-routes.ts";

export interface BenchmarkHandle {
  port: number;
  close: () => Promise<void>;
}

/** Start the TypoKit benchmark app with the native server adapter */
export async function start(dbPath?: string): Promise<BenchmarkHandle> {
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

  return {
    port: addr.port,
    async close() {
      await handle.close();
      resources.close();
    },
  };
}
