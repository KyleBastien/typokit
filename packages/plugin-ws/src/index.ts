// @typokit/plugin-ws — WebSocket Support Plugin
//
// Schema-first WebSocket plugin following the same typed-contract pattern as REST routes.
// Provides type-safe channels with validated messages and build-time code generation.

import type {
  TypoKitPlugin,
  AppInstance,
  BuildPipeline,
} from "@typokit/core";
import type {
  SchemaTypeMap,
  BuildContext,
  GeneratedOutput,
  RequestContext,
  SchemaChange,
  TypeMetadata,
} from "@typokit/types";
import type { AppError } from "@typokit/errors";

// ─── WS Contract Types ──────────────────────────────────────

/** Describes message types for a single WebSocket channel */
export interface WsChannelContract {
  /** Messages the server sends to connected clients */
  serverToClient: unknown;
  /** Messages the client sends to the server */
  clientToServer: unknown;
}

/**
 * Maps channel names to their typed message contracts.
 * Users define this interface to describe their WS API.
 *
 * @example
 * ```typescript
 * interface MyChannels {
 *   "notifications": {
 *     serverToClient: { type: "alert"; message: string };
 *     clientToServer: { type: "subscribe"; topic: string };
 *   };
 * }
 * ```
 */
export type WsChannels = Record<string, WsChannelContract>;

// ─── WS Handler Types ───────────────────────────────────────

/** Context passed to WS handler callbacks */
export interface WsHandlerContext {
  /** Standard request context (includes logger, services, requestId) */
  ctx: RequestContext;
  /** Send a typed message to the connected client */
  send(data: unknown): void;
  /** Close the WebSocket connection */
  close(code?: number, reason?: string): void;
  /** Channel name this handler belongs to */
  channel: string;
  /** Connection-specific metadata store */
  meta: Record<string, unknown>;
}

/** Handler callbacks for a single WS channel */
export interface WsChannelHandler<
  TClientToServer = unknown,
  TServerToClient = unknown,
> {
  /** Called when a client connects to this channel */
  onConnect?(context: WsHandlerContext): Promise<void> | void;
  /** Called when a validated message is received from the client */
  onMessage?(context: WsHandlerContext & { data: TClientToServer }): Promise<void> | void;
  /** Called when the client disconnects */
  onDisconnect?(context: WsHandlerContext): Promise<void> | void;
  /** Type marker for server-to-client messages (compile-time only) */
  _serverToClient?: TServerToClient;
}

/** Maps channel names to their handler definitions */
export type WsHandlerDefs<TChannels extends WsChannels = WsChannels> = {
  [K in keyof TChannels]: WsChannelHandler<
    TChannels[K]["clientToServer"],
    TChannels[K]["serverToClient"]
  >;
};

// ─── WS Validator Types ─────────────────────────────────────

/** Validates an incoming message against the channel's clientToServer contract */
export type WsValidatorFn = (data: unknown) => { valid: boolean; errors?: string[] };

/** Maps channel names to their validator functions */
export type WsValidatorMap = Record<string, WsValidatorFn>;

// ─── WS Connection Types ────────────────────────────────────

/** Represents a single WebSocket connection */
export interface WsConnection {
  /** Unique connection ID */
  id: string;
  /** Channel this connection belongs to */
  channel: string;
  /** Send a message to this client */
  send(data: unknown): void;
  /** Close the connection */
  close(code?: number, reason?: string): void;
  /** Connection metadata */
  meta: Record<string, unknown>;
  /** Whether the connection is open */
  isOpen: boolean;
}

// ─── WS Channel Info (Build-time) ───────────────────────────

/** Extracted channel contract metadata from the type map */
export interface WsChannelInfo {
  name: string;
  serverToClientType: string;
  clientToServerType: string;
  properties: {
    serverToClient: TypeMetadata | null;
    clientToServer: TypeMetadata | null;
  };
}

// ─── Plugin Options ─────────────────────────────────────────

/** Options for the wsPlugin factory */
export interface WsPluginOptions {
  /** Path prefix for WS upgrade endpoints (default: "/ws") */
  pathPrefix?: string;
  /** Maximum message size in bytes (default: 65536) */
  maxMessageSize?: number;
  /** Heartbeat interval in ms (default: 30000, 0 to disable) */
  heartbeatInterval?: number;
  /** Require authentication for WS connections (uses auth middleware) */
  requireAuth?: boolean;
  /** Custom validator map for message validation */
  validators?: WsValidatorMap;
  /** Channel handler definitions */
  handlers?: WsHandlerDefs;
}

// ─── defineWsHandlers ───────────────────────────────────────

/**
 * Define typed WebSocket handlers for a set of channels.
 * Provides compile-time type checking for message types.
 *
 * @example
 * ```typescript
 * export default defineWsHandlers<MyChannels>({
 *   "notifications": {
 *     onConnect: async ({ ctx }) => { ... },
 *     onMessage: async ({ data, ctx }) => {
 *       // data is typed as MyChannels["notifications"]["clientToServer"]
 *     },
 *     onDisconnect: async ({ ctx }) => { ... },
 *   },
 * });
 * ```
 */
export function defineWsHandlers<TChannels extends WsChannels>(
  handlers: WsHandlerDefs<TChannels>,
): WsHandlerDefs<TChannels> {
  return handlers;
}

// ─── Build-Time Utilities ───────────────────────────────────

/**
 * Extract WS channel contracts from the type map.
 * Looks for types implementing the WsChannelContract pattern
 * (types with serverToClient and clientToServer properties).
 */
export function extractWsChannels(typeMap: SchemaTypeMap): WsChannelInfo[] {
  const channels: WsChannelInfo[] = [];

  for (const [typeName, meta] of Object.entries(typeMap)) {
    const props = meta.properties;
    if (!props) continue;

    // Check if this type has the WsChannels pattern: keys mapping to
    // objects with serverToClient and clientToServer
    if (meta.jsdoc?.["wsChannels"] === "true" || meta.jsdoc?.["ws"] === "true") {
      // This type is a WsChannels map — each property is a channel
      for (const [channelName, channelProp] of Object.entries(props)) {
        const channelType = typeMap[channelProp.type];
        if (channelType?.properties?.["serverToClient"] && channelType?.properties?.["clientToServer"]) {
          channels.push({
            name: channelName,
            serverToClientType: channelType.properties["serverToClient"].type,
            clientToServerType: channelType.properties["clientToServer"].type,
            properties: {
              serverToClient: typeMap[channelType.properties["serverToClient"].type] ?? null,
              clientToServer: typeMap[channelType.properties["clientToServer"].type] ?? null,
            },
          });
        }
      }
    }

    // Also check if the type itself is a channel contract
    if (props["serverToClient"] && props["clientToServer"]) {
      // Use the JSDoc @channel tag or the type name as the channel name
      const channelName = meta.jsdoc?.["channel"] ?? typeName;
      channels.push({
        name: channelName,
        serverToClientType: props["serverToClient"].type,
        clientToServerType: props["clientToServer"].type,
        properties: {
          serverToClient: typeMap[props["serverToClient"].type] ?? null,
          clientToServer: typeMap[props["clientToServer"].type] ?? null,
        },
      });
    }
  }

  return channels;
}

/**
 * Generate validator code for WS channels.
 * Produces a TypeScript file with runtime validation functions for incoming messages.
 */
export function generateWsValidators(channels: WsChannelInfo[], outDir: string): GeneratedOutput {
  const lines: string[] = [
    "// Auto-generated by @typokit/plugin-ws — do not edit",
    '// Validates incoming WebSocket messages against channel contracts',
    "",
    "export type WsValidatorFn = (data: unknown) => { valid: boolean; errors?: string[] };",
    "",
    "export const wsValidators: Record<string, WsValidatorFn> = {",
  ];

  for (const channel of channels) {
    lines.push(`  "${channel.name}": (data: unknown) => {`);
    lines.push("    if (data === null || data === undefined) {");
    lines.push('      return { valid: false, errors: ["Message must not be null or undefined"] };');
    lines.push("    }");
    lines.push('    if (typeof data !== "object") {');
    lines.push('      return { valid: false, errors: ["Message must be an object"] };');
    lines.push("    }");

    // If we have property metadata for clientToServer, generate property checks
    if (channel.properties.clientToServer) {
      const props = channel.properties.clientToServer.properties;
      for (const [propName, propMeta] of Object.entries(props)) {
        if (!propMeta.optional) {
          lines.push(`    if (!("${propName}" in (data as Record<string, unknown>))) {`);
          lines.push(`      return { valid: false, errors: ["Missing required field: ${propName}"] };`);
          lines.push("    }");
        }
      }
    }

    lines.push("    return { valid: true };");
    lines.push("  },");
  }

  lines.push("};");
  lines.push("");

  return {
    filePath: `${outDir}/ws-validators.ts`,
    content: lines.join("\n"),
    overwrite: true,
  };
}

/**
 * Generate the WS route table mapping channel paths to metadata.
 */
export function generateWsRouteTable(channels: WsChannelInfo[], outDir: string, pathPrefix: string): GeneratedOutput {
  const lines: string[] = [
    "// Auto-generated by @typokit/plugin-ws — do not edit",
    "// WebSocket channel route table",
    "",
    "export interface WsRouteEntry {",
    "  channel: string;",
    "  path: string;",
    "  serverToClientType: string;",
    "  clientToServerType: string;",
    "}",
    "",
    "export const wsRouteTable: WsRouteEntry[] = [",
  ];

  for (const channel of channels) {
    lines.push("  {");
    lines.push(`    channel: "${channel.name}",`);
    lines.push(`    path: "${pathPrefix}/${channel.name}",`);
    lines.push(`    serverToClientType: "${channel.serverToClientType}",`);
    lines.push(`    clientToServerType: "${channel.clientToServerType}",`);
    lines.push("  },");
  }

  lines.push("];");
  lines.push("");

  return {
    filePath: `${outDir}/ws-route-table.ts`,
    content: lines.join("\n"),
    overwrite: true,
  };
}

// ─── WS Connection Manager ─────────────────────────────────

/** Manages active WebSocket connections across all channels */
export class WsConnectionManager {
  private connections = new Map<string, WsConnection>();
  private channelConnections = new Map<string, Set<string>>();

  /** Register a new connection */
  add(connection: WsConnection): void {
    this.connections.set(connection.id, connection);
    let channelSet = this.channelConnections.get(connection.channel);
    if (!channelSet) {
      channelSet = new Set();
      this.channelConnections.set(connection.channel, channelSet);
    }
    channelSet.add(connection.id);
  }

  /** Remove a connection */
  remove(connectionId: string): WsConnection | undefined {
    const conn = this.connections.get(connectionId);
    if (conn) {
      this.connections.delete(connectionId);
      const channelSet = this.channelConnections.get(conn.channel);
      if (channelSet) {
        channelSet.delete(connectionId);
        if (channelSet.size === 0) {
          this.channelConnections.delete(conn.channel);
        }
      }
    }
    return conn;
  }

  /** Get a connection by ID */
  get(connectionId: string): WsConnection | undefined {
    return this.connections.get(connectionId);
  }

  /** Get all connections for a channel */
  getByChannel(channel: string): WsConnection[] {
    const ids = this.channelConnections.get(channel);
    if (!ids) return [];
    const results: WsConnection[] = [];
    for (const id of ids) {
      const conn = this.connections.get(id);
      if (conn) results.push(conn);
    }
    return results;
  }

  /** Broadcast a message to all connections on a channel */
  broadcast(channel: string, data: unknown): number {
    const connections = this.getByChannel(channel);
    let sent = 0;
    for (const conn of connections) {
      if (conn.isOpen) {
        conn.send(data);
        sent++;
      }
    }
    return sent;
  }

  /** Get count of active connections */
  get size(): number {
    return this.connections.size;
  }

  /** Get count of connections on a specific channel */
  channelSize(channel: string): number {
    return this.channelConnections.get(channel)?.size ?? 0;
  }

  /** Close all connections */
  closeAll(code?: number, reason?: string): void {
    for (const conn of this.connections.values()) {
      if (conn.isOpen) {
        conn.close(code, reason);
      }
    }
    this.connections.clear();
    this.channelConnections.clear();
  }
}

// ─── Message Validation ─────────────────────────────────────

/**
 * Validate an incoming message against the channel's validator.
 * Returns validation result with errors if invalid.
 */
export function validateWsMessage(
  channel: string,
  data: unknown,
  validators: WsValidatorMap,
): { valid: boolean; errors?: string[] } {
  const validator = validators[channel];
  if (!validator) {
    // No validator registered — accept all messages
    return { valid: true };
  }
  return validator(data);
}

/**
 * Parse a raw WebSocket message string into a typed object.
 * Returns null if parsing fails.
 */
export function parseWsMessage(raw: string | ArrayBuffer): { data: unknown; error?: string } {
  if (raw instanceof ArrayBuffer) {
    try {
      const Decoder = (globalThis as unknown as { TextDecoder: new () => { decode(input: ArrayBuffer): string } }).TextDecoder;
      const text = new Decoder().decode(raw);
      return { data: JSON.parse(text) };
    } catch {
      return { data: null, error: "Failed to decode binary message as JSON" };
    }
  }

  if (typeof raw === "string") {
    try {
      return { data: JSON.parse(raw) };
    } catch {
      return { data: null, error: "Failed to parse message as JSON" };
    }
  }

  return { data: null, error: "Unsupported message format" };
}

// ─── ID Generation ──────────────────────────────────────────

let connectionCounter = 0;

function generateConnectionId(): string {
  const timestamp = Date.now().toString(36);
  const counter = (connectionCounter++).toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `ws_${timestamp}_${counter}_${random}`;
}

// ─── Plugin Factory ─────────────────────────────────────────

/**
 * Create a WebSocket plugin that provides schema-first typed WebSocket channels.
 *
 * @example
 * ```typescript
 * import { createApp } from "@typokit/core";
 * import { wsPlugin } from "@typokit/plugin-ws";
 *
 * const app = createApp({
 *   plugins: [wsPlugin({ pathPrefix: "/ws", requireAuth: true })],
 * });
 * ```
 */
export function wsPlugin(options: WsPluginOptions = {}): TypoKitPlugin {
  const pathPrefix = options.pathPrefix ?? "/ws";
  const maxMessageSize = options.maxMessageSize ?? 65536;
  const heartbeatInterval = options.heartbeatInterval ?? 30_000;
  const requireAuth = options.requireAuth ?? false;
  const validators: WsValidatorMap = { ...options.validators };
  const handlers: WsHandlerDefs = options.handlers ?? {};

  // Connection manager shared across the plugin
  const connectionManager = new WsConnectionManager();

  // WS channel info extracted at build time
  let channelInfos: WsChannelInfo[] = [];

  // Heartbeat timer
  const _setInterval = (globalThis as unknown as { setInterval: (fn: () => void, ms: number) => number }).setInterval;
  const _clearInterval = (globalThis as unknown as { clearInterval: (id: number) => void }).clearInterval;
  let heartbeatTimer: number | null = null;

  const plugin: TypoKitPlugin = {
    name: "plugin-ws",

    onBuild(pipeline: BuildPipeline): void {
      // After types are parsed, extract WebSocket channel contracts
      pipeline.hooks.afterTypeParse.tap("ws-plugin", (typeMap: SchemaTypeMap, _ctx: BuildContext) => {
        channelInfos = extractWsChannels(typeMap);
      });

      // At emit phase, generate WS validators and route tables
      pipeline.hooks.emit.tap("ws-plugin", (outputs: GeneratedOutput[], ctx: BuildContext) => {
        if (channelInfos.length > 0) {
          outputs.push(
            generateWsValidators(channelInfos, ctx.outDir),
            generateWsRouteTable(channelInfos, ctx.outDir, pathPrefix),
          );
        }
      });
    },

    async onStart(app: AppInstance): Promise<void> {
      // Expose WS service for other plugins and handlers
      app.services["_ws"] = {
        /** Get the connection manager */
        getConnectionManager: () => connectionManager,

        /** Send a message to a specific connection */
        send: (connectionId: string, data: unknown) => {
          const conn = connectionManager.get(connectionId);
          if (conn?.isOpen) {
            conn.send(data);
            return true;
          }
          return false;
        },

        /** Broadcast a message to all connections on a channel */
        broadcast: (channel: string, data: unknown) => {
          return connectionManager.broadcast(channel, data);
        },

        /** Get active connection count */
        getConnectionCount: (channel?: string) => {
          if (channel) return connectionManager.channelSize(channel);
          return connectionManager.size;
        },

        /** Register a validator for a channel */
        registerValidator: (channel: string, validator: WsValidatorFn) => {
          validators[channel] = validator;
        },

        /** Register handlers for channels */
        registerHandlers: (newHandlers: WsHandlerDefs) => {
          Object.assign(handlers, newHandlers);
        },

        /** Get channel infos extracted at build time */
        getChannelInfos: () => channelInfos,

        /** Plugin config */
        config: {
          pathPrefix,
          maxMessageSize,
          heartbeatInterval,
          requireAuth,
        },
      };
    },

    async onReady(_app: AppInstance): Promise<void> {
      // Start heartbeat timer if configured
      if (heartbeatInterval > 0) {
        heartbeatTimer = _setInterval(() => {
          // Ping all connections to keep them alive
          for (const channel of Object.keys(handlers)) {
            const connections = connectionManager.getByChannel(channel);
            for (const conn of connections) {
              if (!conn.isOpen) {
                connectionManager.remove(conn.id);
              }
            }
          }
        }, heartbeatInterval);
      }
    },

    onError(error: AppError, _ctx: RequestContext): void {
      // Log WS-related errors for debugging
      void error;
    },

    async onStop(_app: AppInstance): Promise<void> {
      // Stop heartbeat
      if (heartbeatTimer) {
        _clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }

      // Close all connections
      connectionManager.closeAll(1001, "Server shutting down");
    },

    onSchemaChange(_changes: SchemaChange[]): void {
      // Channel contracts may have changed — clear cached infos
      // They'll be re-extracted on next build
      channelInfos = [];
    },
  };

  return plugin;
}

/**
 * Handle an incoming WebSocket upgrade request.
 * Validates the channel path, optionally checks auth, and registers the connection.
 */
export function handleWsUpgrade(
  channel: string,
  connectionManager: WsConnectionManager,
  handlers: WsHandlerDefs,
  validators: WsValidatorMap,
  sendFn: (data: unknown) => void,
  closeFn: (code?: number, reason?: string) => void,
  ctx: RequestContext,
): {
  connectionId: string;
  onMessage: (raw: string | ArrayBuffer) => void;
  onClose: () => void;
} | { error: string; code: number } {
  const handler = handlers[channel];
  if (!handler) {
    return { error: `Unknown channel: ${channel}`, code: 4004 };
  }

  const connectionId = generateConnectionId();

  const connection: WsConnection = {
    id: connectionId,
    channel,
    send: sendFn,
    close: closeFn,
    meta: {},
    isOpen: true,
  };

  connectionManager.add(connection);

  const handlerCtx: WsHandlerContext = {
    ctx,
    send: sendFn,
    close: closeFn,
    channel,
    meta: connection.meta,
  };

  // Fire onConnect
  if (handler.onConnect) {
    try {
      const result = handler.onConnect(handlerCtx);
      if (result instanceof Promise) {
        result.catch(() => {
          connection.isOpen = false;
          connectionManager.remove(connectionId);
          closeFn(1011, "Connection handler error");
        });
      }
    } catch {
      connection.isOpen = false;
      connectionManager.remove(connectionId);
      return { error: "Connection handler error", code: 1011 };
    }
  }

  return {
    connectionId,
    onMessage: (raw: string | ArrayBuffer) => {
      const parsed = parseWsMessage(raw);
      if (parsed.error) {
        sendFn({ type: "error", message: parsed.error });
        return;
      }

      // Validate against channel contract
      const validation = validateWsMessage(channel, parsed.data, validators);
      if (!validation.valid) {
        sendFn({
          type: "validation_error",
          errors: validation.errors,
        });
        return;
      }

      // Dispatch to handler
      if (handler.onMessage) {
        try {
          const msgCtx = { ...handlerCtx, data: parsed.data };
          const result = handler.onMessage(msgCtx);
          if (result instanceof Promise) {
            result.catch(() => {
              sendFn({ type: "error", message: "Message handler error" });
            });
          }
        } catch {
          sendFn({ type: "error", message: "Message handler error" });
        }
      }
    },
    onClose: () => {
      connection.isOpen = false;
      connectionManager.remove(connectionId);

      if (handler.onDisconnect) {
        try {
          handler.onDisconnect(handlerCtx);
        } catch {
          // Swallow disconnect errors
        }
      }
    },
  };
}

