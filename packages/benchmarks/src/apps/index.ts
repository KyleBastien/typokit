export {
  buildRouteTable,
  buildAppResources,
  buildValidatorMap,
} from "./shared-routes.ts";
export type { BenchmarkAppResources } from "./shared-routes.ts";

export { buildAppResourcesBun } from "./shared-routes-bun.ts";

export { start as startTypokitNodeNative } from "./typokit-node-native.ts";
export { start as startTypokitNodeFastify } from "./typokit-node-fastify.ts";
export { start as startTypokitNodeHono } from "./typokit-node-hono.ts";
export { start as startTypokitNodeExpress } from "./typokit-node-express.ts";

export { start as startTypokitBunNative } from "./typokit-bun-native.ts";
export { start as startTypokitBunFastify } from "./typokit-bun-fastify.ts";
export { start as startTypokitBunHono } from "./typokit-bun-hono.ts";
export { start as startTypokitBunExpress } from "./typokit-bun-express.ts";

export { buildAppResourcesDeno } from "./shared-routes-deno.ts";

export { start as startTypokitDenoNative } from "./typokit-deno-native.ts";
export { start as startTypokitDenoFastify } from "./typokit-deno-fastify.ts";
export { start as startTypokitDenoHono } from "./typokit-deno-hono.ts";
export { start as startTypokitDenoExpress } from "./typokit-deno-express.ts";

export type { BenchmarkHandle } from "./typokit-node-native.ts";
