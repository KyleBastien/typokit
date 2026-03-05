// @typokit/client-swr — SWR Hooks

import type { RouteContract } from "@typokit/types";
import type { RouteMap, TypeSafeClient } from "@typokit/client";
import type { SWRConfiguration, SWRResponse } from "swr";
import type {
  SWRMutationConfiguration,
  SWRMutationResponse,
} from "swr/mutation";
import useSWR from "swr";
import useSWRMutation from "swr/mutation";

// ─── SWR Key Builder ────────────────────────────────────────

/** Build an SWR cache key from route path, params, and query */
export function buildSWRKey(
  path: string,
  params?: Record<string, string>,
  query?: Record<string, unknown>,
): readonly unknown[] {
  const key: unknown[] = [path];
  if (params && Object.keys(params).length > 0) {
    key.push(params);
  }
  if (query && Object.keys(query).length > 0) {
    key.push(query);
  }
  return key;
}

// ─── Type-Level Utilities ───────────────────────────────────

/** Extract GET route paths from a RouteMap */
type GetPaths<TRoutes extends RouteMap> = {
  [P in keyof TRoutes]: "GET" extends keyof TRoutes[P] ? P : never;
}[keyof TRoutes] &
  string;

type MutationMethod = "POST" | "PUT" | "PATCH" | "DELETE";

/** Extract paths that have a given mutation method */
type MutationPaths<TRoutes extends RouteMap, M extends MutationMethod> = {
  [P in keyof TRoutes]: M extends keyof TRoutes[P] ? P : never;
}[keyof TRoutes] &
  string;

/** Resolve the RouteContract for a given path and method */
type ContractFor<
  TRoutes extends RouteMap,
  P extends string,
  M extends string,
> = P extends keyof TRoutes
  ? M extends keyof TRoutes[P]
    ? TRoutes[P][M] extends RouteContract
      ? TRoutes[P][M]
      : RouteContract
    : RouteContract
  : RouteContract;

// ─── Hook Option / Variable Types ───────────────────────────

/** Options for useSWRGet: route-specific params/query + SWR config */
export interface UseSWRGetOptions<C extends RouteContract> {
  params?: C["params"] extends void
    ? undefined
    : C["params"] & Record<string, string>;
  query?: C["query"] extends void ? undefined : C["query"];
  revalidateOnFocus?: boolean;
  refreshInterval?: number;
  dedupingInterval?: number;
  suspense?: boolean;
}

/** Variables passed to mutation hooks */
export interface MutationVariables<C extends RouteContract> {
  params?: C["params"] extends void
    ? undefined
    : C["params"] & Record<string, string>;
  body?: C["body"] extends void ? undefined : C["body"];
}

/** Mutation lifecycle callbacks */
interface MutationCallbacks<TData> {
  onSuccess?: (data: TData) => void;
  onError?: (error: Error) => void;
}

// ─── SWRHooks Interface ─────────────────────────────────────

/** Type-safe SWR hooks generated from a RouteMap */
export interface SWRHooks<TRoutes extends RouteMap> {
  /** useSWR wrapper for GET routes */
  useGet<P extends GetPaths<TRoutes>>(
    path: P,
    options?: UseSWRGetOptions<ContractFor<TRoutes, P, "GET">>,
  ): SWRResponse<ContractFor<TRoutes, P, "GET">["response"], Error>;

  /** useSWRMutation wrapper for POST routes */
  usePost<P extends MutationPaths<TRoutes, "POST">>(
    path: P,
    options?: MutationCallbacks<ContractFor<TRoutes, P, "POST">["response"]>,
  ): SWRMutationResponse<
    ContractFor<TRoutes, P, "POST">["response"],
    Error,
    MutationVariables<ContractFor<TRoutes, P, "POST">>
  >;

  /** useSWRMutation wrapper for PUT routes */
  usePut<P extends MutationPaths<TRoutes, "PUT">>(
    path: P,
    options?: MutationCallbacks<ContractFor<TRoutes, P, "PUT">["response"]>,
  ): SWRMutationResponse<
    ContractFor<TRoutes, P, "PUT">["response"],
    Error,
    MutationVariables<ContractFor<TRoutes, P, "PUT">>
  >;

  /** useSWRMutation wrapper for PATCH routes */
  usePatch<P extends MutationPaths<TRoutes, "PATCH">>(
    path: P,
    options?: MutationCallbacks<ContractFor<TRoutes, P, "PATCH">["response"]>,
  ): SWRMutationResponse<
    ContractFor<TRoutes, P, "PATCH">["response"],
    Error,
    MutationVariables<ContractFor<TRoutes, P, "PATCH">>
  >;

  /** useSWRMutation wrapper for DELETE routes */
  useDelete<P extends MutationPaths<TRoutes, "DELETE">>(
    path: P,
    options?: MutationCallbacks<ContractFor<TRoutes, P, "DELETE">["response"]>,
  ): SWRMutationResponse<
    ContractFor<TRoutes, P, "DELETE">["response"],
    Error,
    MutationVariables<ContractFor<TRoutes, P, "DELETE">>
  >;
}

// ─── Untyped client for internal use ────────────────────────

interface UntypedClient {
  get(path: string, options?: unknown): Promise<unknown>;
  post(path: string, options?: unknown): Promise<unknown>;
  put(path: string, options?: unknown): Promise<unknown>;
  patch(path: string, options?: unknown): Promise<unknown>;
  delete(path: string, options?: unknown): Promise<unknown>;
}

// ─── Factory ────────────────────────────────────────────────

/**
 * Create type-safe SWR hooks from a TypoKit client.
 *
 * @example
 * ```ts
 * const hooks = createSWRHooks<MyRoutes>(client);
 * // In a React component:
 * const { data, isLoading } = hooks.useGet("/users", { query: { page: 1 } });
 * const { trigger: createUser } = hooks.usePost("/users");
 * createUser({ body: { name: "Alice" } });
 * ```
 */
export function createSWRHooks<TRoutes extends RouteMap>(
  client: TypeSafeClient<TRoutes>,
): SWRHooks<TRoutes> {
  const c = client as unknown as UntypedClient;

  function makeGetHook(
    path: string,
    options?: {
      params?: Record<string, string>;
      query?: Record<string, unknown>;
      revalidateOnFocus?: boolean;
      refreshInterval?: number;
      dedupingInterval?: number;
      suspense?: boolean;
    },
  ): SWRResponse<unknown, Error> {
    const key = buildSWRKey(path, options?.params, options?.query);
    const config: SWRConfiguration<unknown, Error> = {};
    if (options?.revalidateOnFocus !== undefined)
      config.revalidateOnFocus = options.revalidateOnFocus;
    if (options?.refreshInterval !== undefined)
      config.refreshInterval = options.refreshInterval;
    if (options?.dedupingInterval !== undefined)
      config.dedupingInterval = options.dedupingInterval;
    if (options?.suspense !== undefined) config.suspense = options.suspense;

    return useSWR(
      key,
      () => c.get(path, { params: options?.params, query: options?.query }),
      config,
    );
  }

  function makeMutationHook(
    method: "post" | "put" | "patch" | "delete",
    path: string,
    options?: {
      onSuccess?: (data: unknown) => void;
      onError?: (error: Error) => void;
    },
  ): SWRMutationResponse<
    unknown,
    Error,
    { params?: Record<string, string>; body?: unknown }
  > {
    const key = buildSWRKey(path);
    const config: SWRMutationConfiguration<
      unknown,
      Error,
      { params?: Record<string, string>; body?: unknown }
    > = {};
    if (options?.onSuccess) config.onSuccess = options.onSuccess;
    if (options?.onError) config.onError = options.onError;

    return useSWRMutation(
      key,
      (
        _key: string | readonly unknown[],
        { arg }: { arg: { params?: Record<string, string>; body?: unknown } },
      ) => c[method](path, { params: arg.params, body: arg.body }),
      config,
    );
  }

  return {
    useGet: (path: string, options?: Record<string, unknown>) =>
      makeGetHook(path, options as Record<string, unknown>),
    usePost: (path: string, options?: Record<string, unknown>) =>
      makeMutationHook("post", path, options as Record<string, unknown>),
    usePut: (path: string, options?: Record<string, unknown>) =>
      makeMutationHook("put", path, options as Record<string, unknown>),
    usePatch: (path: string, options?: Record<string, unknown>) =>
      makeMutationHook("patch", path, options as Record<string, unknown>),
    useDelete: (path: string, options?: Record<string, unknown>) =>
      makeMutationHook("delete", path, options as Record<string, unknown>),
  } as SWRHooks<TRoutes>;
}
