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

export { start as startRawNode } from "./raw-node.ts";
export { start as startRawBun } from "./raw-bun.ts";
export { start as startRawDeno } from "./raw-deno.ts";

export { start as startCompetitorExpress } from "./competitor-express.ts";
export { start as startCompetitorFastify } from "./competitor-fastify.ts";
export { start as startCompetitorHono } from "./competitor-hono.ts";
export { start as startCompetitorKoa } from "./competitor-koa.ts";
export { start as startCompetitorElysia } from "./competitor-elysia.ts";
export { start as startCompetitorTrpc } from "./competitor-trpc.ts";
export { start as startCompetitorNestjs } from "./competitor-nestjs.ts";
export { start as startCompetitorH3 } from "./competitor-h3.ts";
export { start as startCompetitorAdonis } from "./competitor-adonis.ts";

export type { BenchmarkHandle } from "./typokit-node-native.ts";
