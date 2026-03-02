// @typokit/testing — Test Factories
//
// Type-safe test factories that produce valid/invalid fixture data
// from TypeMetadata. Deterministic when seeded.

import type { TypeMetadata } from "@typokit/types";

// ─── Seeded PRNG (mulberry32) ─────────────────────────────────

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Types ────────────────────────────────────────────────────

/** Options for creating a factory */
export interface FactoryOptions {
  /** Seed for deterministic random generation */
  seed?: number;
}

/** A test factory that produces typed instances */
export interface Factory<T> {
  /** Build a single valid instance with optional field overrides */
  build(overrides?: Partial<T>): T;
  /** Build multiple valid instances */
  buildMany(count: number, overrides?: Partial<T>): T[];
  /** Build an instance with a specific field set to an invalid value */
  buildInvalid(field: keyof T & string): T;
}

// ─── Random Data Generators ───────────────────────────────────

function randomString(rand: () => number, length: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(rand() * chars.length)];
  }
  return result;
}

function randomEmail(rand: () => number): string {
  return `${randomString(rand, 8)}@${randomString(rand, 5)}.com`;
}

function randomUrl(rand: () => number): string {
  return `https://${randomString(rand, 8)}.com/${randomString(rand, 4)}`;
}

function randomUuid(rand: () => number): string {
  const hex = "0123456789abcdef";
  const segments = [8, 4, 4, 4, 12];
  return segments
    .map((len) => {
      let s = "";
      for (let i = 0; i < len; i++) {
        s += hex[Math.floor(rand() * 16)];
      }
      return s;
    })
    .join("-");
}

function randomInt(rand: () => number, min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}

function randomDate(rand: () => number): string {
  const year = randomInt(rand, 2020, 2030);
  const month = String(randomInt(rand, 1, 12)).padStart(2, "0");
  const day = String(randomInt(rand, 1, 28)).padStart(2, "0");
  return `${year}-${month}-${day}T00:00:00.000Z`;
}

// ─── Value Generator ──────────────────────────────────────────

function generateValue(
  type: string,
  jsdoc: Record<string, string> | undefined,
  rand: () => number,
): unknown {
  const format = jsdoc?.["format"];
  const minLengthStr = jsdoc?.["minLength"];
  const maxLengthStr = jsdoc?.["maxLength"];
  const minStr = jsdoc?.["minimum"];
  const maxStr = jsdoc?.["maximum"];

  // Check for JSDoc format constraints first
  if (format === "email") return randomEmail(rand);
  if (format === "url" || format === "uri") return randomUrl(rand);
  if (format === "uuid") return randomUuid(rand);
  if (format === "date" || format === "date-time") return randomDate(rand);

  // String union types like '"a" | "b" | "c"'
  if (type.includes('" | "') || type.includes("' | '")) {
    const values = type
      .split("|")
      .map((v) => v.trim().replace(/^["']|["']$/g, ""));
    return values[Math.floor(rand() * values.length)];
  }

  // Handle base types
  const baseType = type.replace(/\[\]$/, "");
  const isArray = type.endsWith("[]");

  const gen = (): unknown => {
    switch (baseType) {
      case "string": {
        const minLen = minLengthStr ? parseInt(minLengthStr, 10) : 5;
        const maxLen = maxLengthStr ? parseInt(maxLengthStr, 10) : 20;
        const len = randomInt(rand, minLen, maxLen);
        return randomString(rand, len);
      }
      case "number": {
        const min = minStr ? parseInt(minStr, 10) : 1;
        const max = maxStr ? parseInt(maxStr, 10) : 1000;
        return randomInt(rand, min, max);
      }
      case "boolean":
        return rand() > 0.5;
      case "Date":
        return randomDate(rand);
      default:
        return randomString(rand, 10);
    }
  };

  if (isArray) {
    const count = randomInt(rand, 1, 3);
    return Array.from({ length: count }, gen);
  }

  return gen();
}

// ─── Invalid Value Generator ──────────────────────────────────

function generateInvalidValue(
  type: string,
  jsdoc: Record<string, string> | undefined,
): unknown {
  const format = jsdoc?.["format"];
  const minLengthStr = jsdoc?.["minLength"];
  const maxStr = jsdoc?.["maximum"];
  const minStr = jsdoc?.["minimum"];

  if (format === "email") return "not-an-email";
  if (format === "url" || format === "uri") return "not a url";
  if (format === "uuid") return "not-a-uuid";
  if (format === "date" || format === "date-time") return "not-a-date";

  if (type.includes('" | "') || type.includes("' | '")) {
    return "__invalid_enum_value__";
  }

  const baseType = type.replace(/\[\]$/, "");

  switch (baseType) {
    case "string": {
      if (minLengthStr) {
        const minLen = parseInt(minLengthStr, 10);
        return minLen > 1 ? "x" : "";
      }
      return "";
    }
    case "number": {
      if (maxStr) return parseInt(maxStr, 10) + 100;
      if (minStr) return parseInt(minStr, 10) - 100;
      return null;
    }
    case "boolean":
      return "not-a-boolean";
    default:
      return null;
  }
}

// ─── createFactory ────────────────────────────────────────────

/**
 * Create a type-safe test factory from TypeMetadata.
 *
 * ```ts
 * const userFactory = createFactory<User>(userMetadata, { seed: 42 });
 * const user = userFactory.build();
 * const admin = userFactory.build({ role: "admin" });
 * const invalid = userFactory.buildInvalid("email");
 * ```
 */
export function createFactory<T>(
  metadata: TypeMetadata,
  options: FactoryOptions = {},
): Factory<T> {
  const seed = options.seed ?? 12345;

  function buildOne(
    rand: () => number,
    overrides?: Partial<T>,
  ): T {
    const result: Record<string, unknown> = {};

    for (const [key, prop] of Object.entries(metadata.properties)) {
      if (prop.optional && rand() > 0.7) {
        continue; // skip some optional fields
      }
      result[key] = generateValue(prop.type, prop.jsdoc, rand);
    }

    if (overrides) {
      Object.assign(result, overrides);
    }

    return result as T;
  }

  return {
    build(overrides?: Partial<T>): T {
      const rand = mulberry32(seed);
      return buildOne(rand, overrides);
    },

    buildMany(count: number, overrides?: Partial<T>): T[] {
      const rand = mulberry32(seed);
      const results: T[] = [];
      for (let i = 0; i < count; i++) {
        results.push(buildOne(rand, overrides));
      }
      return results;
    },

    buildInvalid(field: keyof T & string): T {
      const rand = mulberry32(seed);
      const instance = buildOne(rand);
      const prop = metadata.properties[field];
      if (prop) {
        (instance as Record<string, unknown>)[field] = generateInvalidValue(
          prop.type,
          prop.jsdoc,
        );
      }
      return instance;
    },
  };
}
