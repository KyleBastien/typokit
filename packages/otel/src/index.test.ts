import { describe, it, expect } from "@rstest/core";
import { StructuredLogger, StdoutSink } from "./logger.js";
import { redactFields } from "./redact.js";
import type { LogEntry, LogSink } from "./types.js";

/** Test sink that captures log entries for assertions */
class TestSink implements LogSink {
  entries: LogEntry[] = [];
  write(entry: LogEntry): void {
    this.entries.push(entry);
  }
}

describe("StructuredLogger", () => {
  it("should implement all six log levels", () => {
    const sink = new TestSink();
    const logger = new StructuredLogger({ level: "trace" }, {}, [sink]);

    logger.trace("t");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    logger.fatal("f");

    expect(sink.entries).toHaveLength(6);
    expect(sink.entries.map((e) => e.level)).toEqual([
      "trace",
      "debug",
      "info",
      "warn",
      "error",
      "fatal",
    ]);
  });

  it("should produce structured JSON entries with timestamp and message", () => {
    const sink = new TestSink();
    const logger = new StructuredLogger({ level: "trace" }, {}, [sink]);

    logger.info("hello world", { key: "value" });

    const entry = sink.entries[0];
    expect(entry.level).toBe("info");
    expect(entry.message).toBe("hello world");
    expect(entry.timestamp).toBeDefined();
    expect(entry.data).toEqual({ key: "value" });
    // Verify timestamp is ISO format
    expect(() => new Date(entry.timestamp)).not.toThrow();
  });

  it("should include request metadata in log entries", () => {
    const sink = new TestSink();
    const logger = new StructuredLogger(
      { level: "trace" },
      {
        traceId: "abc-123",
        route: "POST /users",
        phase: "handler",
        requestId: "req-456",
        serverAdapter: "native",
      },
      [sink],
    );

    logger.info("test");

    const entry = sink.entries[0];
    expect(entry.traceId).toBe("abc-123");
    expect(entry.route).toBe("POST /users");
    expect(entry.phase).toBe("handler");
    expect(entry.requestId).toBe("req-456");
    expect(entry.serverAdapter).toBe("native");
  });

  it("should omit undefined metadata fields from entries", () => {
    const sink = new TestSink();
    const logger = new StructuredLogger(
      { level: "trace" },
      { requestId: "req-1" },
      [sink],
    );

    logger.info("test");

    const entry = sink.entries[0];
    expect(entry.requestId).toBe("req-1");
    expect("traceId" in entry).toBe(false);
    expect("route" in entry).toBe(false);
    expect("phase" in entry).toBe(false);
    expect("serverAdapter" in entry).toBe(false);
  });

  it("should filter log entries below the configured level", () => {
    const sink = new TestSink();
    const logger = new StructuredLogger({ level: "warn" }, {}, [sink]);

    logger.trace("t");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    logger.fatal("f");

    expect(sink.entries).toHaveLength(3);
    expect(sink.entries.map((e) => e.level)).toEqual([
      "warn",
      "error",
      "fatal",
    ]);
  });

  it("should default to info level in production", () => {
    const proc = (
      globalThis as unknown as {
        process?: { env?: Record<string, string | undefined> };
      }
    ).process;
    const originalEnv = proc?.env?.["NODE_ENV"];
    if (proc?.env) {
      proc.env["NODE_ENV"] = "production";
    }

    try {
      const sink = new TestSink();
      // No explicit level — should default to info in production
      const logger = new StructuredLogger({}, {}, [sink]);

      logger.trace("t");
      logger.debug("d");
      logger.info("i");
      logger.warn("w");

      expect(sink.entries).toHaveLength(2);
      expect(sink.entries.map((e) => e.level)).toEqual(["info", "warn"]);
    } finally {
      if (proc?.env) {
        if (originalEnv !== undefined) {
          proc.env["NODE_ENV"] = originalEnv;
        } else {
          delete proc.env["NODE_ENV"];
        }
      }
    }
  });

  it("should default to debug level in development", () => {
    const proc = (
      globalThis as unknown as {
        process?: { env?: Record<string, string | undefined> };
      }
    ).process;
    const originalEnv = proc?.env?.["NODE_ENV"];
    if (proc?.env) {
      proc.env["NODE_ENV"] = "development";
    }

    try {
      const sink = new TestSink();
      const logger = new StructuredLogger({}, {}, [sink]);

      logger.trace("t");
      logger.debug("d");
      logger.info("i");

      expect(sink.entries).toHaveLength(2);
      expect(sink.entries.map((e) => e.level)).toEqual(["debug", "info"]);
    } finally {
      if (proc?.env) {
        if (originalEnv !== undefined) {
          proc.env["NODE_ENV"] = originalEnv;
        } else {
          delete proc.env["NODE_ENV"];
        }
      }
    }
  });

  it("should redact sensitive fields in log data", () => {
    const sink = new TestSink();
    const logger = new StructuredLogger(
      { level: "trace", redact: ["*.password", "*.token", "authorization"] },
      {},
      [sink],
    );

    logger.info("auth attempt", {
      email: "user@example.com",
      password: "secret123",
      token: "jwt-abc",
      authorization: "Bearer xyz",
    });

    const data = sink.entries[0].data as Record<string, unknown>;
    expect(data["email"]).toBe("user@example.com");
    expect(data["password"]).toBe("[REDACTED]");
    expect(data["token"]).toBe("[REDACTED]");
    expect(data["authorization"]).toBe("[REDACTED]");
  });

  it("should redact nested sensitive fields", () => {
    const sink = new TestSink();
    const logger = new StructuredLogger(
      { level: "trace", redact: ["*.password"] },
      {},
      [sink],
    );

    logger.info("nested data", {
      user: { name: "Alice", password: "secret" },
      meta: { count: 1 },
    });

    const data = sink.entries[0].data as Record<string, unknown>;
    const user = data["user"] as Record<string, unknown>;
    expect(user["name"]).toBe("Alice");
    expect(user["password"]).toBe("[REDACTED]");
    const meta = data["meta"] as Record<string, unknown>;
    expect(meta["count"]).toBe(1);
  });

  it("should create child logger with additional metadata", () => {
    const sink = new TestSink();
    const parent = new StructuredLogger(
      { level: "trace" },
      { requestId: "req-1", serverAdapter: "native" },
      [sink],
    );

    const child = parent.child({ phase: "handler", route: "GET /items" });
    child.info("from child");

    const entry = sink.entries[0];
    expect(entry.requestId).toBe("req-1");
    expect(entry.serverAdapter).toBe("native");
    expect(entry.phase).toBe("handler");
    expect(entry.route).toBe("GET /items");
  });

  it("should write to multiple sinks", () => {
    const sink1 = new TestSink();
    const sink2 = new TestSink();
    const logger = new StructuredLogger({ level: "trace" }, {}, [sink1, sink2]);

    logger.info("multi-sink");

    expect(sink1.entries).toHaveLength(1);
    expect(sink2.entries).toHaveLength(1);
    expect(sink1.entries[0].message).toBe("multi-sink");
  });

  it("should not include data field when no data is provided", () => {
    const sink = new TestSink();
    const logger = new StructuredLogger({ level: "trace" }, {}, [sink]);

    logger.info("no data");

    const entry = sink.entries[0];
    expect("data" in entry).toBe(false);
  });
});

describe("redactFields", () => {
  it("should return data unchanged when no patterns", () => {
    const data = { a: 1, b: "hello" };
    const result = redactFields(data, []);
    expect(result).toEqual(data);
  });

  it("should redact exact key matches", () => {
    const result = redactFields({ password: "secret", name: "Alice" }, [
      "password",
    ]);
    expect(result).toEqual({ password: "[REDACTED]", name: "Alice" });
  });

  it("should redact wildcard key matches at any depth", () => {
    const result = redactFields(
      { user: { password: "secret", name: "Alice" } },
      ["*.password"],
    );
    expect(result).toEqual({
      user: { password: "[REDACTED]", name: "Alice" },
    });
  });

  it("should redact fields inside arrays of objects", () => {
    const result = redactFields(
      {
        users: [
          { name: "A", token: "t1" },
          { name: "B", token: "t2" },
        ],
      },
      ["*.token"],
    );
    const users = result["users"] as Array<Record<string, unknown>>;
    expect(users[0]["token"]).toBe("[REDACTED]");
    expect(users[1]["token"]).toBe("[REDACTED]");
    expect(users[0]["name"]).toBe("A");
  });
});

describe("StdoutSink", () => {
  it("should be constructable", () => {
    const sink = new StdoutSink();
    expect(sink).toBeDefined();
    expect(typeof sink.write).toBe("function");
  });
});
