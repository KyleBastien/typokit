// @typokit/client-react-query — React Query Hooks

import type { RouteContract } from "@typokit/types";
import type { RouteMap, TypeSafeClient } from "@typokit/client";
import type {
  UseQueryResult,
  UseMutationOptions,
  UseMutationResult,
} from "@tanstack/react-query";
import { useQuery, useMutation } from "@tanstack/react-query";

// ─── Query Key Builder ──────────────────────────────────────

/** Build a React Query cache key from route path, params, and query */
export function buildQueryKey(
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

/** Options for useGet: route-specific params/query + React Query config */
export interface UseGetOptions<C extends RouteContract> {
  params?: C["params"] extends void
    ? undefined
    : C["params"] & Record<string, string>;
  query?: C["query"] extends void ? undefined : C["query"];
  enabled?: boolean;
  staleTime?: number;
  refetchInterval?: number | false;
}

/** Variables passed to mutation hooks */
export interface MutationVariables<C extends RouteContract> {
  params?: C["params"] extends void
    ? undefined
    : C["params"] & Record<string, string>;
  body?: C["body"] extends void ? undefined : C["body"];
}

/** Mutation lifecycle callbacks */
type MutationCallbacks<TData, TVars> = Pick<
  UseMutationOptions<TData, Error, TVars, unknown>,
  "onSuccess" | "onError" | "onSettled" | "onMutate"
>;

// ─── QueryHooks Interface ───────────────────────────────────

/** Type-safe React Query hooks generated from a RouteMap */
export interface QueryHooks<TRoutes extends RouteMap> {
  /** useQuery wrapper for GET routes */
  useGet<P extends GetPaths<TRoutes>>(
    path: P,
    options?: UseGetOptions<ContractFor<TRoutes, P, "GET">>,
  ): UseQueryResult<ContractFor<TRoutes, P, "GET">["response"], Error>;

  /** useMutation wrapper for POST routes */
  usePost<P extends MutationPaths<TRoutes, "POST">>(
    path: P,
    options?: MutationCallbacks<
      ContractFor<TRoutes, P, "POST">["response"],
      MutationVariables<ContractFor<TRoutes, P, "POST">>
    >,
  ): UseMutationResult<
    ContractFor<TRoutes, P, "POST">["response"],
    Error,
    MutationVariables<ContractFor<TRoutes, P, "POST">>
  >;

  /** useMutation wrapper for PUT routes */
  usePut<P extends MutationPaths<TRoutes, "PUT">>(
    path: P,
    options?: MutationCallbacks<
      ContractFor<TRoutes, P, "PUT">["response"],
      MutationVariables<ContractFor<TRoutes, P, "PUT">>
    >,
  ): UseMutationResult<
    ContractFor<TRoutes, P, "PUT">["response"],
    Error,
    MutationVariables<ContractFor<TRoutes, P, "PUT">>
  >;

  /** useMutation wrapper for PATCH routes */
  usePatch<P extends MutationPaths<TRoutes, "PATCH">>(
    path: P,
    options?: MutationCallbacks<
      ContractFor<TRoutes, P, "PATCH">["response"],
      MutationVariables<ContractFor<TRoutes, P, "PATCH">>
    >,
  ): UseMutationResult<
    ContractFor<TRoutes, P, "PATCH">["response"],
    Error,
    MutationVariables<ContractFor<TRoutes, P, "PATCH">>
  >;

  /** useMutation wrapper for DELETE routes */
  useDelete<P extends MutationPaths<TRoutes, "DELETE">>(
    path: P,
    options?: MutationCallbacks<
      ContractFor<TRoutes, P, "DELETE">["response"],
      MutationVariables<ContractFor<TRoutes, P, "DELETE">>
    >,
  ): UseMutationResult<
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
 * Create type-safe React Query hooks from a TypoKit client.
 *
 * @example
 * ```ts
 * const hooks = createQueryHooks<MyRoutes>(client);
 * // In a React component:
 * const { data, isLoading } = hooks.useGet("/users", { query: { page: 1 } });
 * const createUser = hooks.usePost("/users");
 * createUser.mutate({ body: { name: "Alice" } });
 * ```
 */
export function createQueryHooks<TRoutes extends RouteMap>(
  client: TypeSafeClient<TRoutes>,
): QueryHooks<TRoutes> {
  const c = client as unknown as UntypedClient;

  function makeGetHook(
    path: string,
    options?: {
      params?: Record<string, string>;
      query?: Record<string, unknown>;
      enabled?: boolean;
      staleTime?: number;
      refetchInterval?: number | false;
    },
  ): UseQueryResult<unknown, Error> {
    const queryKey = buildQueryKey(path, options?.params, options?.query);
    return useQuery({
      queryKey,
      queryFn: () =>
        c.get(path, { params: options?.params, query: options?.query }),
      enabled: options?.enabled,
      staleTime: options?.staleTime,
    });
  }

  function makeMutationHook(
    method: "post" | "put" | "patch" | "delete",
    path: string,
    options?: Record<string, unknown>,
  ): UseMutationResult<
    unknown,
    Error,
    { params?: Record<string, string>; body?: unknown }
  > {
    const { onSuccess, onError, onSettled, onMutate, ...rest } = options ?? {};
    return useMutation({
      mutationFn: (variables: {
        params?: Record<string, string>;
        body?: unknown;
      }) => c[method](path, { params: variables.params, body: variables.body }),
      onSuccess: onSuccess as undefined,
      onError: onError as undefined,
      onSettled: onSettled as undefined,
      onMutate: onMutate as undefined,
      ...rest,
    });
  }

  return {
    useGet: (path: string, options?: Record<string, unknown>) =>
      makeGetHook(path, options as Record<string, unknown>),
    usePost: (path: string, options?: Record<string, unknown>) =>
      makeMutationHook("post", path, options),
    usePut: (path: string, options?: Record<string, unknown>) =>
      makeMutationHook("put", path, options),
    usePatch: (path: string, options?: Record<string, unknown>) =>
      makeMutationHook("patch", path, options),
    useDelete: (path: string, options?: Record<string, unknown>) =>
      makeMutationHook("delete", path, options),
  } as QueryHooks<TRoutes>;
}
