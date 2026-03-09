export {
  buildRouteTable,
  buildAppResources,
  buildValidatorMap,
} from "./shared-routes.ts";
export type { BenchmarkAppResources } from "./shared-routes.ts";

export { start as startTypokitNodeNative } from "./typokit-node-native.ts";
export { start as startTypokitNodeFastify } from "./typokit-node-fastify.ts";
export { start as startTypokitNodeHono } from "./typokit-node-hono.ts";
export { start as startTypokitNodeExpress } from "./typokit-node-express.ts";

export type { BenchmarkHandle } from "./typokit-node-native.ts";
