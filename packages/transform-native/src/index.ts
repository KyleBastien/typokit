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

interface JsSchemaChange {
  type: string;
  entity: string;
  field?: string;
  details?: Record<string, string>;
}

interface JsMigrationDraft {
  name: string;
  sql: string;
  destructive: boolean;
  changes: JsSchemaChange[];
}

interface JsTypeValidatorInput {
  name: string;
  properties: Record<string, JsPropertyMetadata>;
}

interface JsPipelineResult {
  contentHash: string;
  types: Record<string, JsTypeMetadata>;
  compiledRoutes: string;
  openapiSpec: string;
  testStubs: string;
  validatorInputs: JsTypeValidatorInput[];
}

interface NativeBindings {
  parseAndExtractTypes(filePaths: string[]): Record<string, JsTypeMetadata>;
  compileRoutes(filePaths: string[]): string;
  generateOpenApi(routeFilePaths: string[], typeFilePaths: string[]): string;
  diffSchemas(
    oldTypes: Record<string, JsTypeMetadata>,
    newTypes: Record<string, JsTypeMetadata>,
    migrationName: string,
  ): JsMigrationDraft;
  generateTestStubs(filePaths: string[]): string;
  prepareValidatorInputs(typeFilePaths: string[]): JsTypeValidatorInput[];
  collectValidatorOutputs(results: string[][]): Record<string, string>;
  computeContentHash(filePaths: string[]): string;
  runPipeline(
    typeFilePaths: string[],
    routeFilePaths: string[],
  ): JsPipelineResult;
}

/** Options for the output pipeline */
export interface PipelineOptions {
  /** Paths to TypeScript files containing type definitions */
  typeFiles: string[];
  /** Paths to TypeScript files containing route contracts */
  routeFiles: string[];
  /** Output directory (defaults to ".typokit") */
  outputDir?: string;
  /** Optional validator callback — receives type inputs, returns [name, code] pairs */
  validatorCallback?: (
    inputs: JsTypeValidatorInput[],
  ) => Promise<[string, string][]> | [string, string][];
  /** Path to cache hash file (defaults to ".typokit/.cache-hash") */
  cacheFile?: string;
}

/** Result of a full pipeline run */
export interface PipelineOutput {
  /** Whether outputs were regenerated (false = cache hit) */
  regenerated: boolean;
  /** Content hash of source files */
  contentHash: string;
  /** Extracted type metadata */
  types: SchemaTypeMap;
  /** Files written to outputDir */
  filesWritten: string[];
}

// Load the platform-specific native addon
async function loadNativeAddon(): Promise<NativeBindings> {
  const g = globalThis as Record<string, unknown>;
  const proc = g["process"] as { platform: string; arch: string } | undefined;
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
      `@typokit/transform-native: unsupported platform ${platform}-${arch}`,
    );
  }

  // In ESM, require() is not global. Use createRequire from 'module' built-in.
  const { createRequire } = (await import(/* @vite-ignore */ "module")) as {
    createRequire: (url: string) => (id: string) => unknown;
  };
  const req = createRequire(import.meta.url);

  // Try loading the platform-specific native addon
  try {
    return req(`../index.${triple}.node`) as NativeBindings;
  } catch {
    try {
      return req(`@typokit/transform-native-${triple}`) as NativeBindings;
    } catch {
      throw new Error(
        `@typokit/transform-native: failed to load native addon for ${triple}. ` +
          `Make sure the native addon is built.`,
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
  filePaths: string[],
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
export async function compileRoutes(filePaths: string[]): Promise<string> {
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

/**
 * Diff two schema versions and produce a migration draft.
 *
 * Compares old types against new types to detect added, removed, and
 * modified entities and fields. Generates SQL DDL stubs for the changes.
 *
 * @param oldTypes - Previous schema version
 * @param newTypes - New schema version
 * @param migrationName - Name for the migration draft
 * @returns MigrationDraft with SQL, changes, and destructive flag
 */
export async function diffSchemas(
  oldTypes: SchemaTypeMap,
  newTypes: SchemaTypeMap,
  migrationName: string,
): Promise<JsMigrationDraft> {
  const native = await getNative();
  const oldJs = schemaTypeMapToJs(oldTypes);
  const newJs = schemaTypeMapToJs(newTypes);
  return native.diffSchemas(oldJs, newJs, migrationName);
}

/**
 * Generate contract test scaffolding from route contract files.
 *
 * Parses route contracts and generates TypeScript test stubs with
 * describe/it blocks for each route.
 *
 * @param filePaths - Array of file paths containing route contract interfaces
 * @returns TypeScript test code string
 */
export async function generateTestStubs(filePaths: string[]): Promise<string> {
  const native = await getNative();
  return native.generateTestStubs(filePaths);
}

/**
 * Prepare type metadata for Typia validator generation.
 *
 * Converts parsed type metadata into a format suitable for passing
 * to the @typokit/transform-typia bridge callback.
 *
 * @param typeFilePaths - Array of file paths containing type definitions
 * @returns Array of type validator inputs
 */
export async function prepareValidatorInputs(
  typeFilePaths: string[],
): Promise<JsTypeValidatorInput[]> {
  const native = await getNative();
  return native.prepareValidatorInputs(typeFilePaths);
}

/**
 * Collect validator code results into a file path map.
 *
 * Maps type names and their generated code to output file paths
 * under .typokit/validators/.
 *
 * @param results - Array of [typeName, code] pairs
 * @returns Map of file paths to validator code
 */
export async function collectValidatorOutputs(
  results: [string, string][],
): Promise<Record<string, string>> {
  const native = await getNative();
  return native.collectValidatorOutputs(results);
}

/**
 * Compute a SHA-256 content hash of source files.
 *
 * Used for cache invalidation: if the hash matches a previous build,
 * outputs can be reused without regeneration.
 *
 * @param filePaths - Array of file paths to hash
 * @returns Hex-encoded SHA-256 hash string
 */
export async function computeContentHash(filePaths: string[]): Promise<string> {
  const native = await getNative();
  return native.computeContentHash(filePaths);
}

/**
 * Run the full output pipeline with content-hash caching.
 *
 * Orchestrates all transform steps: parse types, compile routes, generate
 * OpenAPI spec, generate test stubs, and prepare validator inputs. Writes
 * all outputs to the `.typokit/` directory structure:
 *
 * - `.typokit/routes/compiled-router.ts` — Compiled radix tree
 * - `.typokit/schemas/openapi.json` — OpenAPI 3.1.0 spec
 * - `.typokit/tests/contract.test.ts` — Contract test stubs
 * - `.typokit/validators/*.ts` — Typia validators (if callback provided)
 *
 * Content-hash caching: If the hash of all source files matches the cached
 * hash, no outputs are regenerated. Force a rebuild by deleting `.typokit/.cache-hash`.
 *
 * @param options - Pipeline configuration
 * @returns Pipeline output with metadata about what was generated
 */
export async function buildPipeline(
  options: PipelineOptions,
): Promise<PipelineOutput> {
  const { join, dirname } = (await import(/* @vite-ignore */ "path")) as {
    join: (...args: string[]) => string;
    dirname: (p: string) => string;
  };
  const nodeFs = (await import(/* @vite-ignore */ "fs")) as {
    existsSync: (p: string) => boolean;
    mkdirSync: (p: string, opts?: { recursive?: boolean }) => void;
    readFileSync: (p: string, encoding: string) => string;
    writeFileSync: (p: string, data: string, encoding?: string) => void;
  };

  const native = await getNative();
  const outputDir = options.outputDir ?? ".typokit";
  const cacheFile = options.cacheFile ?? join(outputDir, ".cache-hash");

  // 1. Compute content hash of all input files
  const allPaths = [...options.typeFiles, ...options.routeFiles];
  const contentHash = native.computeContentHash(allPaths);

  // 2. Check cache
  if (nodeFs.existsSync(cacheFile)) {
    const cachedHash = nodeFs.readFileSync(cacheFile, "utf-8").trim();
    if (cachedHash === contentHash) {
      return {
        regenerated: false,
        contentHash,
        types: {},
        filesWritten: [],
      };
    }
  }

  // 3. Run native pipeline
  const result = native.runPipeline(options.typeFiles, options.routeFiles);

  // 4. Ensure output directories exist
  const dirs = [
    join(outputDir, "routes"),
    join(outputDir, "schemas"),
    join(outputDir, "tests"),
    join(outputDir, "validators"),
    join(outputDir, "client"),
  ];
  for (const dir of dirs) {
    nodeFs.mkdirSync(dir, { recursive: true });
  }

  const filesWritten: string[] = [];

  // 5. Write compiled routes
  const routesPath = join(outputDir, "routes", "compiled-router.ts");
  nodeFs.writeFileSync(routesPath, result.compiledRoutes, "utf-8");
  filesWritten.push(routesPath);

  // 6. Write OpenAPI spec
  const openapiPath = join(outputDir, "schemas", "openapi.json");
  nodeFs.writeFileSync(openapiPath, result.openapiSpec, "utf-8");
  filesWritten.push(openapiPath);

  // 7. Write test stubs
  const testsPath = join(outputDir, "tests", "contract.test.ts");
  nodeFs.writeFileSync(testsPath, result.testStubs, "utf-8");
  filesWritten.push(testsPath);

  // 8. Generate and write validators (if callback provided)
  if (options.validatorCallback && result.validatorInputs.length > 0) {
    const validatorResults = await options.validatorCallback(
      result.validatorInputs,
    );
    const validatorOutputs = native.collectValidatorOutputs(validatorResults);
    for (const [filePath, code] of Object.entries(validatorOutputs)) {
      const fullPath = filePath.startsWith(outputDir)
        ? filePath
        : join(outputDir, filePath.replace(/^\.typokit\//, ""));
      const dir = dirname(fullPath);
      nodeFs.mkdirSync(dir, { recursive: true });
      nodeFs.writeFileSync(fullPath, code, "utf-8");
      filesWritten.push(fullPath);
    }
  }

  // 9. Write cache hash
  nodeFs.mkdirSync(dirname(cacheFile), { recursive: true });
  nodeFs.writeFileSync(cacheFile, contentHash, "utf-8");
  filesWritten.push(cacheFile);

  // 10. Convert types to SchemaTypeMap
  const types: SchemaTypeMap = {};
  for (const [name, meta] of Object.entries(result.types)) {
    types[name] = {
      name: meta.name,
      properties: {},
    };
    for (const [propName, prop] of Object.entries(meta.properties)) {
      types[name].properties[propName] = {
        type: prop.type,
        optional: prop.optional,
      };
    }
  }

  return {
    regenerated: true,
    contentHash,
    types,
    filesWritten,
  };
}

/** Convert SchemaTypeMap to JsTypeMetadata format for native binding */
function schemaTypeMapToJs(
  types: SchemaTypeMap,
): Record<string, JsTypeMetadata> {
  const result: Record<string, JsTypeMetadata> = {};
  for (const [name, meta] of Object.entries(types)) {
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
