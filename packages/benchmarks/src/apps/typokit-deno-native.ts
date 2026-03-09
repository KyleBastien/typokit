// TypoKit benchmark app — Deno + native server adapter
// Uses @typokit/server-native on Deno runtime with @db/sqlite for DB.

import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { nativeServer } from "@typokit/server-native";
import { getPlatformInfo } from "@typokit/platform-deno";
import {
  buildRouteTable,
  buildAppResourcesDeno,
} from "./shared-routes-deno.ts";

export interface BenchmarkHandle {
  port: number;
  close: () => Promise<void>;
}

/** Start the TypoKit Deno benchmark app with the native server adapter */
export async function start(dbPath?: string): Promise<BenchmarkHandle> {
  const _platform = getPlatformInfo();
  const adapter = nativeServer();
  const resources = buildAppResourcesDeno(dbPath);
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
