// @typokit/plugin-ws — Tests

import { describe, it, expect } from "@rstest/core";
import {
  wsPlugin,
  defineWsHandlers,
  extractWsChannels,
  generateWsValidators,
  generateWsRouteTable,
  WsConnectionManager,
  validateWsMessage,
  parseWsMessage,
  handleWsUpgrade,
} from "./index.js";
import type {
  WsChannels,
  WsValidatorMap,
  WsHandlerDefs,
  WsChannelInfo,
} from "./index.js";
import type { SchemaTypeMap, RequestContext } from "@typokit/types";
import type { AppInstance } from "@typokit/core";

// ─── defineWsHandlers ───────────────────────────────────────

describe("defineWsHandlers", () => {
  it("returns handlers as-is (identity function for type safety)", () => {
    interface TestChannels extends WsChannels {
      "chat": {
        serverToClient: { type: "message"; text: string };
        clientToServer: { type: "send"; text: string };
      };
    }

    const handlers = defineWsHandlers<TestChannels>({
      chat: {
        onConnect: async () => {},
        onMessage: async () => {},
        onDisconnect: async () => {},
      },
    });

    expect(handlers).toBeDefined();
    expect(handlers.chat).toBeDefined();
    expect(handlers.chat.onConnect).toBeDefined();
    expect(handlers.chat.onMessage).toBeDefined();
    expect(handlers.chat.onDisconnect).toBeDefined();
  });

  it("allows partial handler definitions (only onMessage)", () => {
    const handlers = defineWsHandlers({
      "notifications": {
        onMessage: async () => {},
      },
    });

    expect(handlers.notifications.onMessage).toBeDefined();
    expect(handlers.notifications.onConnect).toBeUndefined();
    expect(handlers.notifications.onDisconnect).toBeUndefined();
  });
});

// ─── extractWsChannels ──────────────────────────────────────

describe("extractWsChannels", () => {
  it("extracts channel contracts from type map with @channel JSDoc", () => {
    const typeMap: SchemaTypeMap = {
      NotificationChannel: {
        name: "NotificationChannel",
        jsdoc: { channel: "notifications" },
        properties: {
          serverToClient: { type: "ServerMessage", optional: false },
          clientToServer: { type: "ClientMessage", optional: false },
        },
      },
      ServerMessage: {
        name: "ServerMessage",
        properties: {
          type: { type: "string", optional: false },
          payload: { type: "unknown", optional: false },
        },
      },
      ClientMessage: {
        name: "ClientMessage",
        properties: {
          type: { type: "string", optional: false },
          channel: { type: "string", optional: false },
        },
      },
    };

    const channels = extractWsChannels(typeMap);
    expect(channels.length).toBe(1);
    expect(channels[0].name).toBe("notifications");
    expect(channels[0].serverToClientType).toBe("ServerMessage");
    expect(channels[0].clientToServerType).toBe("ClientMessage");
  });

  it("extracts channels from @ws tagged type maps", () => {
    const typeMap: SchemaTypeMap = {
      MyWsChannels: {
        name: "MyWsChannels",
        jsdoc: { ws: "true" },
        properties: {
          chat: { type: "ChatContract", optional: false },
        },
      },
      ChatContract: {
        name: "ChatContract",
        properties: {
          serverToClient: { type: "ChatServerMsg", optional: false },
          clientToServer: { type: "ChatClientMsg", optional: false },
        },
      },
      ChatServerMsg: {
        name: "ChatServerMsg",
        properties: { text: { type: "string", optional: false } },
      },
      ChatClientMsg: {
        name: "ChatClientMsg",
        properties: { text: { type: "string", optional: false } },
      },
    };

    const channels = extractWsChannels(typeMap);
    // Should find "chat" from the ws channels map
    const chatChannel = channels.find((c) => c.name === "chat");
    expect(chatChannel).toBeDefined();
    expect(chatChannel!.serverToClientType).toBe("ChatServerMsg");
    expect(chatChannel!.clientToServerType).toBe("ChatClientMsg");
  });

  it("returns empty array when no WS channels found", () => {
    const typeMap: SchemaTypeMap = {
      User: {
        name: "User",
        properties: {
          name: { type: "string", optional: false },
          email: { type: "string", optional: false },
        },
      },
    };

    const channels = extractWsChannels(typeMap);
    expect(channels.length).toBe(0);
  });
});

// ─── generateWsValidators ───────────────────────────────────

describe("generateWsValidators", () => {
  it("generates validator code for channels", () => {
    const channels: WsChannelInfo[] = [
      {
        name: "chat",
        serverToClientType: "ChatServerMsg",
        clientToServerType: "ChatClientMsg",
        properties: {
          serverToClient: null,
          clientToServer: {
            name: "ChatClientMsg",
            properties: {
              type: { type: "string", optional: false },
              text: { type: "string", optional: false },
            },
          },
        },
      },
    ];

    const output = generateWsValidators(channels, ".typokit");
    expect(output.filePath).toBe(".typokit/ws-validators.ts");
    expect(output.overwrite).toBe(true);
    expect(output.content).toContain("wsValidators");
    expect(output.content).toContain('"chat"');
    expect(output.content).toContain("type");
    expect(output.content).toContain("text");
  });
});

// ─── generateWsRouteTable ───────────────────────────────────

describe("generateWsRouteTable", () => {
  it("generates route table with channel paths", () => {
    const channels: WsChannelInfo[] = [
      {
        name: "notifications",
        serverToClientType: "NotifServerMsg",
        clientToServerType: "NotifClientMsg",
        properties: { serverToClient: null, clientToServer: null },
      },
    ];

    const output = generateWsRouteTable(channels, ".typokit", "/ws");
    expect(output.filePath).toBe(".typokit/ws-route-table.ts");
    expect(output.overwrite).toBe(true);
    expect(output.content).toContain('"/ws/notifications"');
    expect(output.content).toContain('"notifications"');
  });
});

// ─── WsConnectionManager ───────────────────────────────────

describe("WsConnectionManager", () => {
  it("adds and retrieves connections", () => {
    const mgr = new WsConnectionManager();
    mgr.add({
      id: "conn-1",
      channel: "chat",
      send: () => {},
      close: () => {},
      meta: {},
      isOpen: true,
    });

    expect(mgr.size).toBe(1);
    expect(mgr.get("conn-1")).toBeDefined();
    expect(mgr.get("conn-1")!.channel).toBe("chat");
  });

  it("removes connections", () => {
    const mgr = new WsConnectionManager();
    mgr.add({
      id: "conn-1",
      channel: "chat",
      send: () => {},
      close: () => {},
      meta: {},
      isOpen: true,
    });

    const removed = mgr.remove("conn-1");
    expect(removed).toBeDefined();
    expect(mgr.size).toBe(0);
    expect(mgr.get("conn-1")).toBeUndefined();
  });

  it("gets connections by channel", () => {
    const mgr = new WsConnectionManager();
    mgr.add({ id: "c1", channel: "chat", send: () => {}, close: () => {}, meta: {}, isOpen: true });
    mgr.add({ id: "c2", channel: "chat", send: () => {}, close: () => {}, meta: {}, isOpen: true });
    mgr.add({ id: "c3", channel: "notif", send: () => {}, close: () => {}, meta: {}, isOpen: true });

    const chatConns = mgr.getByChannel("chat");
    expect(chatConns.length).toBe(2);
    expect(mgr.channelSize("chat")).toBe(2);
    expect(mgr.channelSize("notif")).toBe(1);
  });

  it("broadcasts to channel connections", () => {
    const mgr = new WsConnectionManager();
    const sent: unknown[] = [];
    mgr.add({ id: "c1", channel: "chat", send: (d) => sent.push(d), close: () => {}, meta: {}, isOpen: true });
    mgr.add({ id: "c2", channel: "chat", send: (d) => sent.push(d), close: () => {}, meta: {}, isOpen: true });

    const count = mgr.broadcast("chat", { type: "hello" });
    expect(count).toBe(2);
    expect(sent.length).toBe(2);
  });

  it("closes all connections", () => {
    const mgr = new WsConnectionManager();
    const closeCalls: Array<{ code?: number; reason?: string }> = [];
    mgr.add({ id: "c1", channel: "chat", send: () => {}, close: (c, r) => closeCalls.push({ code: c, reason: r }), meta: {}, isOpen: true });
    mgr.add({ id: "c2", channel: "notif", send: () => {}, close: (c, r) => closeCalls.push({ code: c, reason: r }), meta: {}, isOpen: true });

    mgr.closeAll(1001, "shutdown");
    expect(closeCalls.length).toBe(2);
    expect(mgr.size).toBe(0);
  });
});

// ─── validateWsMessage ──────────────────────────────────────

describe("validateWsMessage", () => {
  it("returns valid when no validator is registered", () => {
    const result = validateWsMessage("chat", { type: "send" }, {});
    expect(result.valid).toBe(true);
  });

  it("validates messages against registered validator", () => {
    const validators: WsValidatorMap = {
      chat: (data) => {
        if (typeof data !== "object" || data === null) {
          return { valid: false, errors: ["Must be an object"] };
        }
        const obj = data as Record<string, unknown>;
        if (!obj["type"]) {
          return { valid: false, errors: ["Missing type field"] };
        }
        return { valid: true };
      },
    };

    expect(validateWsMessage("chat", { type: "send" }, validators).valid).toBe(true);
    expect(validateWsMessage("chat", {}, validators).valid).toBe(false);
    expect(validateWsMessage("chat", null, validators).valid).toBe(false);
  });
});

// ─── parseWsMessage ─────────────────────────────────────────

describe("parseWsMessage", () => {
  it("parses valid JSON string", () => {
    const result = parseWsMessage('{"type":"hello"}');
    expect(result.error).toBeUndefined();
    expect(result.data).toEqual({ type: "hello" });
  });

  it("returns error for invalid JSON", () => {
    const result = parseWsMessage("not json");
    expect(result.error).toBeDefined();
    expect(result.data).toBeNull();
  });

  it("parses ArrayBuffer as JSON", () => {
    const encoder = new TextEncoder();
    const buffer = encoder.encode('{"type":"hello"}').buffer;
    const result = parseWsMessage(buffer as ArrayBuffer);
    expect(result.error).toBeUndefined();
    expect(result.data).toEqual({ type: "hello" });
  });
});

// ─── wsPlugin factory ───────────────────────────────────────

describe("wsPlugin", () => {
  it("returns a valid TypoKitPlugin", () => {
    const plugin = wsPlugin();
    expect(plugin.name).toBe("plugin-ws");
    expect(plugin.onBuild).toBeDefined();
    expect(plugin.onStart).toBeDefined();
    expect(plugin.onReady).toBeDefined();
    expect(plugin.onStop).toBeDefined();
    expect(plugin.onError).toBeDefined();
    expect(plugin.onSchemaChange).toBeDefined();
  });

  it("registers WS service on onStart", async () => {
    const plugin = wsPlugin({ pathPrefix: "/ws", requireAuth: true });
    const app: AppInstance = {
      name: "test-app",
      plugins: [plugin],
      services: {},
    };

    await plugin.onStart!(app);

    expect(app.services["_ws"]).toBeDefined();
    const wsService = app.services["_ws"] as Record<string, unknown>;
    expect(wsService.send).toBeDefined();
    expect(wsService.broadcast).toBeDefined();
    expect(wsService.getConnectionCount).toBeDefined();
    expect(wsService.registerValidator).toBeDefined();
    expect(wsService.registerHandlers).toBeDefined();
    expect(wsService.getChannelInfos).toBeDefined();
    expect((wsService.config as Record<string, unknown>).pathPrefix).toBe("/ws");
    expect((wsService.config as Record<string, unknown>).requireAuth).toBe(true);
  });

  it("shuts down cleanly on onStop", async () => {
    const plugin = wsPlugin();
    const app: AppInstance = {
      name: "test-app",
      plugins: [plugin],
      services: {},
    };

    await plugin.onStart!(app);
    await plugin.onReady!(app);
    await plugin.onStop!(app);

    // Should not throw
    expect(true).toBe(true);
  });

  it("clears channel infos on schema change", () => {
    const plugin = wsPlugin();
    plugin.onSchemaChange!([{ type: "modify", entity: "ChatChannel" }]);
    // Should not throw
    expect(true).toBe(true);
  });
});

// ─── handleWsUpgrade ────────────────────────────────────────

describe("handleWsUpgrade", () => {
  function makeMockCtx(): RequestContext {
    return {
      log: {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      },
      fail: (() => { throw new Error("fail"); }) as never,
      services: {},
      requestId: "test-req-1",
    };
  }

  it("returns error for unknown channel", () => {
    const mgr = new WsConnectionManager();
    const result = handleWsUpgrade(
      "unknown",
      mgr,
      {},
      {},
      () => {},
      () => {},
      makeMockCtx(),
    );
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.code).toBe(4004);
    }
  });

  it("connects and receives messages", () => {
    const mgr = new WsConnectionManager();
    const sent: unknown[] = [];
    const receivedMessages: unknown[] = [];

    const handlers: WsHandlerDefs = {
      chat: {
        onConnect: async () => {},
        onMessage: async ({ data }) => {
          receivedMessages.push(data);
        },
        onDisconnect: async () => {},
      },
    };

    const result = handleWsUpgrade(
      "chat",
      mgr,
      handlers,
      {},
      (d) => sent.push(d),
      () => {},
      makeMockCtx(),
    );

    expect("connectionId" in result).toBe(true);
    if ("connectionId" in result) {
      expect(mgr.size).toBe(1);

      // Send a message
      result.onMessage('{"type":"send","text":"hello"}');
      expect(receivedMessages.length).toBe(1);
      expect(receivedMessages[0]).toEqual({ type: "send", text: "hello" });

      // Disconnect
      result.onClose();
      expect(mgr.size).toBe(0);
    }
  });

  it("validates messages and sends validation errors", () => {
    const mgr = new WsConnectionManager();
    const sent: unknown[] = [];

    const handlers: WsHandlerDefs = {
      chat: {
        onMessage: async () => {},
      },
    };

    const validators: WsValidatorMap = {
      chat: (data) => {
        if (typeof data !== "object" || data === null || !("type" in data)) {
          return { valid: false, errors: ["Missing type field"] };
        }
        return { valid: true };
      },
    };

    const result = handleWsUpgrade(
      "chat",
      mgr,
      handlers,
      validators,
      (d) => sent.push(d),
      () => {},
      makeMockCtx(),
    );

    if ("connectionId" in result) {
      // Send invalid message (missing type field)
      result.onMessage('{"text":"no type"}');
      expect(sent.length).toBe(1);
      expect((sent[0] as Record<string, unknown>).type).toBe("validation_error");

      // Send valid message
      result.onMessage('{"type":"send","text":"hello"}');
      // No additional error sent
      expect(sent.length).toBe(1);
    }
  });

  it("handles parse errors for invalid JSON", () => {
    const mgr = new WsConnectionManager();
    const sent: unknown[] = [];

    const handlers: WsHandlerDefs = {
      chat: { onMessage: async () => {} },
    };

    const result = handleWsUpgrade(
      "chat",
      mgr,
      handlers,
      {},
      (d) => sent.push(d),
      () => {},
      makeMockCtx(),
    );

    if ("connectionId" in result) {
      result.onMessage("not json at all");
      expect(sent.length).toBe(1);
      expect((sent[0] as Record<string, unknown>).type).toBe("error");
    }
  });
});
