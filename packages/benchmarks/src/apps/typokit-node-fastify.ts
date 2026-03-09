// TypoKit benchmark app — Node.js + Fastify server adapter

import type { AddressInfo } from "node:net";
import { fastifyServer } from "@typokit/server-fastify";
import { buildRouteTable, buildAppResources } from "./shared-routes.ts";

export interface BenchmarkHandle {
  port: number;
  close: () => Promise<void>;
}

/** Start the TypoKit benchmark app with the Fastify server adapter */
export async function start(dbPath?: string): Promise<BenchmarkHandle> {
  const adapter = fastifyServer({ logger: false });
  const resources = buildAppResources(dbPath);
  const routeTable = buildRouteTable();

  adapter.registerRoutes(
    routeTable,
    resources.handlerMap,
    resources.middlewareChain,
    resources.validatorMap,
  );

  const handle = await adapter.listen(0);

  // Fastify exposes the native server via getNativeServer().server
  const fastify = adapter.getNativeServer() as {
    server: { address(): AddressInfo };
  };
  const addr = fastify.server.address();

  return {
    port: addr.port,
    async close() {
      await handle.close();
      resources.close();
    },
  };
}
