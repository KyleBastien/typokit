// @typokit/client — Type-Safe Fetch Client

import type { HttpMethod, RouteContract } from "@typokit/types";
import { AppError, createAppError } from "@typokit/errors";

// ─── Path Parameter Extraction ──────────────────────────────

/** Extract param names from a path pattern like "/users/:id/posts/:postId" */
type ExtractParams<T extends string> =
  T extends `${string}:${infer Param}/${infer Rest}`
    ? { [K in Param | keyof ExtractParams<Rest>]: string }
    : T extends `${string}:${infer Param}`
      ? { [K in Param]: string }
      : Record<string, never>;

// ─── Route Definition Types ─────────────────────────────────

/** A single route definition binding a method + path to a contract */
export interface RouteDefinition<
  TMethod extends HttpMethod = HttpMethod,
  TContract extends RouteContract = RouteContract,
> {
  method: TMethod;
  contract: TContract;
}

/** Map of path patterns to their route definitions per method */
export type RouteMap = Record<string, Partial<Record<HttpMethod, RouteContract>>>;

// ─── Client Options ─────────────────────────────────────────

/** Interceptor function that can modify the request before it is sent */
export type RequestInterceptor = (
  request: RequestInit & { url: string },
) => (RequestInit & { url: string }) | Promise<RequestInit & { url: string }>;

/** Options for creating a client */
export interface ClientOptions {
  baseUrl: string;
  headers?: Record<string, string>;
  interceptors?: RequestInterceptor[];
}

/** Options for individual requests */
export interface RequestOptions<TQuery = void, TBody = void> {
  params?: Record<string, string>;
  query?: TQuery extends void ? never : TQuery;
  body?: TBody extends void ? never : TBody;
  headers?: Record<string, string>;
}

// ─── Client Error ───────────────────────────────────────────

/** Error thrown when an API call returns a non-OK status */
export class ClientError extends AppError {
  constructor(
    public readonly response: { status: number; body: unknown },
  ) {
    super("CLIENT_ERROR", response.status, `Request failed with status ${response.status}`);
    this.name = "ClientError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ─── Type-Level Helpers ─────────────────────────────────────

/** Extract routes of a given method from a RouteMap */
type RoutesForMethod<TRoutes extends RouteMap, M extends HttpMethod> = {
  [P in keyof TRoutes]: M extends keyof TRoutes[P] ? P : never;
}[keyof TRoutes] &
  string;

/** Get the contract type for a path + method */
type ContractFor<
  TRoutes extends RouteMap,
  P extends string,
  M extends HttpMethod,
> = P extends keyof TRoutes
  ? M extends keyof TRoutes[P]
    ? TRoutes[P][M] extends RouteContract ? TRoutes[P][M] : never
    : never
  : never;

/** Build the options type for a given contract + path */
type MethodRequestOptions<
  TContract extends RouteContract,
  _TPath extends string,
> = TContract extends RouteContract<infer TParams, infer TQuery, infer TBody, infer _TResponse>
  ? (TParams extends void
      ? TQuery extends void
        ? TBody extends void
          ? { headers?: Record<string, string> } | undefined
          : { body: TBody; headers?: Record<string, string> }
        : TBody extends void
          ? { query: TQuery; headers?: Record<string, string> }
          : { query: TQuery; body: TBody; headers?: Record<string, string> }
      : TQuery extends void
        ? TBody extends void
          ? { params: TParams & Record<string, string>; headers?: Record<string, string> }
          : { params: TParams & Record<string, string>; body: TBody; headers?: Record<string, string> }
        : TBody extends void
          ? { params: TParams & Record<string, string>; query: TQuery; headers?: Record<string, string> }
          : { params: TParams & Record<string, string>; query: TQuery; body: TBody; headers?: Record<string, string> })
  : never;

/** Extract the response type from a contract */
type ResponseFor<TContract extends RouteContract> =
  TContract extends RouteContract<infer _P, infer _Q, infer _B, infer TResponse> ? TResponse : never;

// ─── Client Interface ───────────────────────────────────────

/** Type-safe API client */
export interface TypeSafeClient<TRoutes extends RouteMap> {
  get<P extends RoutesForMethod<TRoutes, "GET">>(
    path: P,
    options?: MethodRequestOptions<ContractFor<TRoutes, P, "GET">, P>,
  ): Promise<ResponseFor<ContractFor<TRoutes, P, "GET">>>;

  post<P extends RoutesForMethod<TRoutes, "POST">>(
    path: P,
    options?: MethodRequestOptions<ContractFor<TRoutes, P, "POST">, P>,
  ): Promise<ResponseFor<ContractFor<TRoutes, P, "POST">>>;

  put<P extends RoutesForMethod<TRoutes, "PUT">>(
    path: P,
    options?: MethodRequestOptions<ContractFor<TRoutes, P, "PUT">, P>,
  ): Promise<ResponseFor<ContractFor<TRoutes, P, "PUT">>>;

  patch<P extends RoutesForMethod<TRoutes, "PATCH">>(
    path: P,
    options?: MethodRequestOptions<ContractFor<TRoutes, P, "PATCH">, P>,
  ): Promise<ResponseFor<ContractFor<TRoutes, P, "PATCH">>>;

  delete<P extends RoutesForMethod<TRoutes, "DELETE">>(
    path: P,
    options?: MethodRequestOptions<ContractFor<TRoutes, P, "DELETE">, P>,
  ): Promise<ResponseFor<ContractFor<TRoutes, P, "DELETE">>>;
}

// ─── Implementation ─────────────────────────────────────────

/** Substitute path parameters into a URL pattern */
function buildUrl(
  baseUrl: string,
  path: string,
  params?: Record<string, string>,
  query?: Record<string, unknown>,
): string {
  let resolvedPath = path;
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      resolvedPath = resolvedPath.replace(`:${key}`, encodeURIComponent(value));
    }
  }

  const url = new URL(resolvedPath, baseUrl);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        if (Array.isArray(value)) {
          for (const item of value) {
            url.searchParams.append(key, String(item));
          }
        } else {
          url.searchParams.set(key, String(value));
        }
      }
    }
  }

  return url.toString();
}

/** Apply interceptors sequentially */
async function applyInterceptors(
  request: RequestInit & { url: string },
  interceptors: RequestInterceptor[],
): Promise<RequestInit & { url: string }> {
  let current = request;
  for (const interceptor of interceptors) {
    current = await interceptor(current);
  }
  return current;
}

/** Parse response body, throwing a typed error on non-OK status */
async function handleResponse<T>(response: ResponseLike): Promise<T> {
  let body: unknown;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    body = await response.json();
  } else {
    body = await response.text();
  }

  if (!response.ok) {
    // Try to parse as ErrorResponse and throw a typed error
    if (
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof (body as Record<string, unknown>).error === "object"
    ) {
      const errBody = (body as { error: { code?: string; message?: string; details?: Record<string, unknown> } }).error;
      throw createAppError(
        response.status,
        errBody.code ?? "UNKNOWN_ERROR",
        errBody.message ?? `Request failed with status ${response.status}`,
        errBody.details,
      );
    }
    throw new ClientError({ status: response.status, body });
  }

  return body as T;
}

/**
 * Create a type-safe API client.
 *
 * @example
 * ```ts
 * type MyRoutes = {
 *   "/users": { GET: RouteContract<void, { page?: number }, void, User[]> };
 *   "/users/:id": { GET: RouteContract<{ id: string }, void, void, User> };
 * };
 * const client = createClient<MyRoutes>({ baseUrl: "http://localhost:3000" });
 * const users = await client.get("/users", { query: { page: 1 } });
 * ```
 */
export function createClient<TRoutes extends RouteMap>(
  options: ClientOptions,
): TypeSafeClient<TRoutes> {
  const { baseUrl, headers: defaultHeaders = {}, interceptors = [] } = options;

  async function request<T>(
    method: HttpMethod,
    path: string,
    opts?: {
      params?: Record<string, string>;
      query?: Record<string, unknown>;
      body?: unknown;
      headers?: Record<string, string>;
    },
  ): Promise<T> {
    const url = buildUrl(baseUrl, path, opts?.params, opts?.query);

    const requestHeaders: Record<string, string> = {
      ...defaultHeaders,
      ...(opts?.headers ?? {}),
    };

    if (opts?.body !== undefined) {
      requestHeaders["content-type"] = "application/json";
    }

    let requestInit: RequestInit & { url: string } = {
      url,
      method,
      headers: requestHeaders,
      ...(opts?.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    };

    requestInit = await applyInterceptors(requestInit, interceptors);

    const { url: finalUrl, ...fetchOpts } = requestInit;
    const response = await fetch(finalUrl, fetchOpts);

    return handleResponse<T>(response);
  }

  return {
    get: (path, opts) => request("GET", path, opts as Record<string, unknown>),
    post: (path, opts) => request("POST", path, opts as Record<string, unknown>),
    put: (path, opts) => request("PUT", path, opts as Record<string, unknown>),
    patch: (path, opts) => request("PATCH", path, opts as Record<string, unknown>),
    delete: (path, opts) => request("DELETE", path, opts as Record<string, unknown>),
  } as TypeSafeClient<TRoutes>;
}

export type { ExtractParams };

