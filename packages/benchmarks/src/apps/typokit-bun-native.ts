// TypoKit benchmark app — Bun + native server adapter
// Uses @typokit/server-native on Bun runtime with bun:sqlite for DB.

import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { nativeServer } from "@typokit/server-native";
import { getPlatformInfo } from "@typokit/platform-bun";
import { buildRouteTable, buildAppResourcesBun } from "./shared-routes-bun.ts";

export interface BenchmarkHandle {
  port: number;
  close: () => Promise<void>;
}

/** Start the TypoKit Bun benchmark app with the native server adapter */
export async function start(dbPath?: string): Promise<BenchmarkHandle> {
  const _platform = getPlatformInfo();
  const adapter = nativeServer();
  const resources = buildAppResourcesBun(dbPath);
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
