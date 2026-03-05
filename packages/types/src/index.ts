// @typokit/types — Shared Type Definitions

// ─── HTTP Types ──────────────────────────────────────────────

/** HTTP methods supported by TypoKit */
export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

/** Normalized incoming request */
export interface TypoKitRequest {
  method: HttpMethod;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  query: Record<string, string | string[] | undefined>;
  params: Record<string, string>;
}

/** Normalized outgoing response */
export interface TypoKitResponse {
  status: number;
  headers: Record<string, string | string[]>;
  body: unknown;
}

// ─── Route Contract ──────────────────────────────────────────

/** Binds request and response types together for a single route */
export interface RouteContract<
  TParams = void,
  TQuery = void,
  TBody = void,
  TResponse = void,
> {
  params: TParams;
  query: TQuery;
  body: TBody;
  response: TResponse;
}

// ─── Response Types ──────────────────────────────────────────

/** Standard paginated list response */
export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

/** Standard error response (with traceId field) */
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    traceId?: string;
  };
}

// ─── Compiled Route Table (Radix Tree) ───────────────────────

/** Handler entry in the compiled route table */
export interface RouteHandler {
  ref: string;
  middleware: string[];
  /** Optional validator references for request validation */
  validators?: {
    params?: string;
    query?: string;
    body?: string;
  };
  /** Optional serializer reference for response serialization */
  serializer?: string;
}

// ─── Validation Types ─────────────────────────────────────────

/** A single field-level validation error */
export interface ValidationFieldError {
  path: string;
  expected: string;
  actual: unknown;
}

/** Result returned by a validator function */
export interface ValidationResult {
  success: boolean;
  data?: unknown;
  errors?: ValidationFieldError[];
}

/** A validator function that validates input and returns a result */
export type ValidatorFn = (input: unknown) => ValidationResult;

/** Maps validator references to their runtime validator functions */
export type ValidatorMap = Record<string, ValidatorFn>;

// ─── Serialization Types ──────────────────────────────────────

/** A serializer function that converts a value to a JSON string (e.g., fast-json-stringify compiled schema) */
export type SerializerFn = (input: unknown) => string;

/** Maps serializer references to their runtime serializer functions */
export type SerializerMap = Record<string, SerializerFn>;

/** A node in the compiled radix tree */
export interface CompiledRoute {
  segment: string;
  children?: Record<string, CompiledRoute>;
  paramChild?: CompiledRoute & { paramName: string };
  wildcardChild?: CompiledRoute & { paramName: string };
  handlers?: Partial<Record<HttpMethod, RouteHandler>>;
}

/** The compiled route table — a radix tree root node */
export type CompiledRouteTable = CompiledRoute;

// ─── Handler & Middleware Types ──────────────────────────────

/** Maps handler refs (e.g. "users#list") to handler functions */
export type HandlerMap = Record<
  string,
  (
    req: TypoKitRequest,
    ctx: RequestContext,
  ) => Promise<TypoKitResponse> | TypoKitResponse
>;

/** A single middleware function in the chain */
export type MiddlewareFn = (
  req: TypoKitRequest,
  ctx: RequestContext,
  next: () => Promise<TypoKitResponse>,
) => Promise<TypoKitResponse>;

/** Ordered middleware chain */
export interface MiddlewareChain {
  /** Named middleware entries in execution order */
  entries: Array<{ name: string; handler: MiddlewareFn }>;
}

// ─── Logger Interface ────────────────────────────────────────

/** Structured logger available on RequestContext */
export interface Logger {
  trace(message: string, data?: Record<string, unknown>): void;
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  fatal(message: string, data?: Record<string, unknown>): void;
}

// ─── Request Context ─────────────────────────────────────────

/** Context object passed to every handler and middleware */
export interface RequestContext {
  /** Structured logger with automatic trace correlation */
  log: Logger;
  /** Throw a structured error (syntactic sugar for AppError) */
  fail(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ): never;
  /** Service container for dependency injection */
  services: Record<string, unknown>;
  /** Request ID for tracing */
  requestId: string;
}

// ─── Schema & Code Generation Types ─────────────────────────

/** Metadata about a single extracted type */
export interface TypeMetadata {
  name: string;
  properties: Record<
    string,
    { type: string; optional: boolean; jsdoc?: Record<string, string> }
  >;
  /** Interface-level JSDoc tags (e.g. @table) */
  jsdoc?: Record<string, string>;
}

/** Maps type names to their extracted metadata */
export type SchemaTypeMap = Record<string, TypeMetadata>;

/** A generated output file */
export interface GeneratedOutput {
  filePath: string;
  content: string;
  overwrite: boolean;
}

// ─── Schema Diffing & Migrations ─────────────────────────────

/** Describes a single change detected during schema diffing */
export interface SchemaChange {
  type: "add" | "remove" | "modify";
  entity: string;
  field?: string;
  details?: Record<string, unknown>;
}

/** A draft migration produced by schema diffing */
export interface MigrationDraft {
  name: string;
  sql: string;
  destructive: boolean;
  changes: SchemaChange[];
}

// ─── Server Handle ───────────────────────────────────────────

/** Handle returned by server.listen() for graceful shutdown */
export interface ServerHandle {
  close(): Promise<void>;
}

// ─── Build Types ─────────────────────────────────────────────

/** Context available during the build pipeline */
export interface BuildContext {
  /** Root directory of the project */
  rootDir: string;
  /** Output directory for generated files */
  outDir: string;
  /** Whether this is a development build */
  dev: boolean;
  /** Collected generated outputs */
  outputs: GeneratedOutput[];
}

/** Result of a completed build */
export interface BuildResult {
  /** Whether the build succeeded */
  success: boolean;
  /** Generated output files */
  outputs: GeneratedOutput[];
  /** Duration in milliseconds */
  duration: number;
  /** Errors encountered during build */
  errors: string[];
}
