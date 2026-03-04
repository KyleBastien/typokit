// @typokit/core — Handler System

import type { RouteContract, RequestContext } from "@typokit/types";

/**
 * Input received by each handler function.
 * Types are inferred from the corresponding RouteContract.
 */
export type HandlerInput<TContract extends RouteContract<unknown, unknown, unknown, unknown>> = {
  params: TContract["params"];
  query: TContract["query"];
  body: TContract["body"];
  ctx: RequestContext;
};

/**
 * A handler function that receives typed input and returns the contract's response type.
 */
export type HandlerFn<TContract extends RouteContract<unknown, unknown, unknown, unknown>> =
  (input: HandlerInput<TContract>) => Promise<TContract["response"]> | TContract["response"];

/**
 * Maps each route key in TRoutes to a handler function whose input/output
 * types are inferred from the corresponding RouteContract.
 */
export type HandlerDefs<TRoutes extends Record<string, RouteContract<unknown, unknown, unknown, unknown>>> = {
  [K in keyof TRoutes]: HandlerFn<TRoutes[K]>;
};

/**
 * Define typed handler implementations for a set of route contracts.
 * The type system enforces that every route key has a handler and that
 * each handler's signature matches its contract.
 *
 * @example
 * ```typescript
 * export default defineHandlers<UsersRoutes>({
 *   "GET /users": async ({ query, ctx }) => {
 *     return userService.list(query, ctx);
 *   },
 *   "POST /users": async ({ body, ctx }) => {
 *     return userService.create(body, ctx);
 *   },
 * });
 * ```
 */
export function defineHandlers<
  TRoutes extends Record<string, RouteContract<unknown, unknown, unknown, unknown>>,
>(handlers: HandlerDefs<TRoutes>): HandlerDefs<TRoutes> {
  return handlers;
}
