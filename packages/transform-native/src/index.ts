// @typokit/transform-native — Rust-native AST transform (napi-rs)
import type { SchemaTypeMap } from "@typokit/types";

interface JsPropertyMetadata {
  type: string;
  optional: boolean;
}

interface JsTypeMetadata {
  name: string;
  properties: Record<string, JsPropertyMetadata>;
}

interface NativeBindings {
  parseAndExtractTypes(
    filePaths: string[]
  ): Record<string, JsTypeMetadata>;
  compileRoutes(filePaths: string[]): string;
  generateOpenApi(
    routeFilePaths: string[],
    typeFilePaths: string[]
  ): string;
}

// Load the platform-specific native addon
async function loadNativeAddon(): Promise<NativeBindings> {
  const g = globalThis as Record<string, unknown>;
  const proc = g["process"] as
    | { platform: string; arch: string }
    | undefined;
  const platform = proc?.platform ?? "unknown";
  const arch = proc?.arch ?? "unknown";

  const triples: Record<string, Record<string, string>> = {
    win32: { x64: "win32-x64-msvc" },
    darwin: { x64: "darwin-x64", arm64: "darwin-arm64" },
    linux: { x64: "linux-x64-gnu", arm64: "linux-arm64-gnu" },
  };

  const triple = triples[platform]?.[arch];
  if (!triple) {
    throw new Error(
      `@typokit/transform-native: unsupported platform ${platform}-${arch}`
    );
  }

  // In ESM, require() is not global. Use createRequire from 'module' built-in.
  const { createRequire } = await import(/* @vite-ignore */ "module") as {
    createRequire: (url: string) => (id: string) => unknown;
  };
  const req = createRequire(import.meta.url);

  // Try loading the platform-specific native addon
  try {
    return req(`../index.${triple}.node`) as NativeBindings;
  } catch {
    try {
      return req(
        `@typokit/transform-native-${triple}`
      ) as NativeBindings;
    } catch {
      throw new Error(
        `@typokit/transform-native: failed to load native addon for ${triple}. ` +
          `Make sure the native addon is built.`
      );
    }
  }
}

let _native: NativeBindings | undefined;
let _loading: Promise<NativeBindings> | undefined;

async function getNative(): Promise<NativeBindings> {
  if (_native) return _native;
  if (!_loading) {
    _loading = loadNativeAddon().then((n) => {
      _native = n;
      return n;
    });
  }
  return _loading;
}

/**
 * Parse TypeScript source files and extract type metadata.
 *
 * Uses the Rust-native SWC parser for high-performance AST parsing and
 * type extraction. Extracts interface definitions including JSDoc tags
 * (@table, @id, @generated, @format, @unique, @minLength, @maxLength,
 * @default, @onUpdate).
 *
 * @param filePaths - Array of file paths to parse
 * @returns SchemaTypeMap mapping type names to their metadata
 */
export async function parseAndExtractTypes(
  filePaths: string[]
): Promise<SchemaTypeMap> {
  const native = await getNative();
  const raw = native.parseAndExtractTypes(filePaths);

  // Convert JsTypeMetadata to TypeMetadata (compatible shape)
  const result: SchemaTypeMap = {};
  for (const [name, meta] of Object.entries(raw)) {
    result[name] = {
      name: meta.name,
      properties: {},
    };
    for (const [propName, prop] of Object.entries(meta.properties)) {
      result[name].properties[propName] = {
        type: prop.type,
        optional: prop.optional,
      };
    }
  }
  return result;
}

/**
 * Compile route contracts from TypeScript files into a radix tree.
 *
 * Parses interfaces with route contract keys (e.g., "GET /users") and
 * builds a compiled radix tree serialized as TypeScript source code.
 *
 * @param filePaths - Array of file paths containing route contract interfaces
 * @returns TypeScript source code for the compiled route table
 */
export async function compileRoutes(
  filePaths: string[]
): Promise<string> {
  const native = await getNative();
  return native.compileRoutes(filePaths);
}

/**
 * Generate an OpenAPI 3.1.0 specification from route contracts and type definitions.
 *
 * @param routeFilePaths - Array of file paths containing route contract interfaces
 * @param typeFilePaths - Array of file paths containing type definitions
 * @returns OpenAPI 3.1.0 specification as a JSON string
 */
export async function generateOpenApi(
  routeFilePaths: string[],
  typeFilePaths: string[],
): Promise<string> {
  const native = await getNative();
  return native.generateOpenApi(routeFilePaths, typeFilePaths);
}

