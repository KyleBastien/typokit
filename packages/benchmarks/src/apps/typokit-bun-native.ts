// TypoKit benchmark app — Bun + native server adapter
// Uses @typokit/server-native on Bun runtime. The native adapter auto-detects
// Bun and delegates to @typokit/platform-bun's Bun.serve() path for
// near-native Bun performance (no node:http compat layer).

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

  // getNativeServer() returns BunServer on Bun (has .port) or http.Server on Node (has .address())
  const nativeServerRef = adapter.getNativeServer!();
  let port: number;
  if (
    nativeServerRef !== null &&
    typeof nativeServerRef === "object" &&
    "port" in (nativeServerRef as Record<string, unknown>)
  ) {
    // Bun path: BunServer has a .port property
    port = (nativeServerRef as { port: number }).port;
  } else {
    // Node path: http.Server has .address()
    const addr = (nativeServerRef as Server).address() as AddressInfo;
    port = addr.port;
  }

  return {
    port,
    async close() {
      await handle.close();
      resources.close();
    },
  };
}
