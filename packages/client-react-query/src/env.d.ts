// Ambient type declarations for @tanstack/react-query (peer dependency)
// Consumers must install @tanstack/react-query >= 5.0.0

declare module "@tanstack/react-query" {
  export type QueryKey = readonly unknown[];

  export interface UseQueryOptions<
    TQueryFnData = unknown,
    _TError = Error,
    TData = TQueryFnData,
    TQueryKey extends QueryKey = QueryKey,
  > {
    queryKey: TQueryKey;
    queryFn: (context: { queryKey: TQueryKey }) => Promise<TQueryFnData>;
    enabled?: boolean;
    staleTime?: number;
    refetchInterval?: number | false;
    select?: (data: TQueryFnData) => TData;
  }

  export interface UseQueryResult<TData = unknown, TError = Error> {
    data: TData | undefined;
    error: TError | null;
    isLoading: boolean;
    isPending: boolean;
    isError: boolean;
    isSuccess: boolean;
    isFetching: boolean;
    refetch: () => Promise<UseQueryResult<TData, TError>>;
    status: "pending" | "error" | "success";
  }

  export interface UseMutationOptions<
    TData = unknown,
    TError = Error,
    TVariables = void,
    TContext = unknown,
  > {
    mutationFn: (variables: TVariables) => Promise<TData>;
    onSuccess?: (
      data: TData,
      variables: TVariables,
      context: TContext | undefined,
    ) => void;
    onError?: (
      error: TError,
      variables: TVariables,
      context: TContext | undefined,
    ) => void;
    onSettled?: (
      data: TData | undefined,
      error: TError | null,
      variables: TVariables,
      context: TContext | undefined,
    ) => void;
    onMutate?: (
      variables: TVariables,
    ) => TContext | Promise<TContext | undefined>;
  }

  export interface UseMutationResult<
    TData = unknown,
    TError = Error,
    TVariables = void,
  > {
    mutate: (variables: TVariables) => void;
    mutateAsync: (variables: TVariables) => Promise<TData>;
    data: TData | undefined;
    error: TError | null;
    isIdle: boolean;
    isPending: boolean;
    isError: boolean;
    isSuccess: boolean;
    reset: () => void;
    status: "idle" | "pending" | "error" | "success";
  }

  export function useQuery<
    TQueryFnData = unknown,
    TError = Error,
    TData = TQueryFnData,
    TQueryKey extends QueryKey = QueryKey,
  >(
    options: UseQueryOptions<TQueryFnData, TError, TData, TQueryKey>,
  ): UseQueryResult<TData, TError>;

  export function useMutation<
    TData = unknown,
    TError = Error,
    TVariables = void,
    TContext = unknown,
  >(
    options: UseMutationOptions<TData, TError, TVariables, TContext>,
  ): UseMutationResult<TData, TError, TVariables>;
}
