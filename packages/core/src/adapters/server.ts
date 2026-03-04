import type {
  CompiledRouteTable,
  HandlerMap,
  MiddlewareChain,
  SerializerMap,
  ServerHandle,
  TypoKitRequest,
  TypoKitResponse,
  ValidatorMap,
} from "@typokit/types";

export interface ServerAdapter {
  /** Adapter name for logging and diagnostics */
  name: string;

  /**
   * Register TypoKit's compiled routes into the server framework.
   * The adapter translates the route table into framework-native registrations.
   * Each route handler receives a normalized TypoKitRequest and must return
   * a TypoKitResponse.
   */
  registerRoutes(
    routeTable: CompiledRouteTable,
    handlerMap: HandlerMap,
    middlewareChain: MiddlewareChain,
    validatorMap?: ValidatorMap,
    serializerMap?: SerializerMap,
  ): void;

  /**
   * Start the server. Returns a handle for shutdown.
   */
  listen(port: number): Promise<ServerHandle>;

  /**
   * Normalize the framework's native request into TypoKit's standard format.
   * This is where Fastify's `req`, Hono's `c`, or raw `http.IncomingMessage`
   * get normalized into a consistent shape for TypoKit's validation/handler
   * pipeline.
   */
  normalizeRequest(raw: unknown): TypoKitRequest;

  /**
   * Write TypoKit's response back through the framework's native response
   * mechanism.
   */
  writeResponse(raw: unknown, response: TypoKitResponse): void;

  /**
   * Optional: expose the underlying framework instance for escape hatches.
   * e.g., the raw Fastify instance so users can register Fastify-native plugins.
   * Returns `unknown` — consumers cast to the specific framework type.
   */
  getNativeServer?(): unknown;
}
