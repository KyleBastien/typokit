// Ambient type declarations for swr (peer dependency)
// Consumers must install swr >= 2.0.0

declare module "swr" {
  export type Key = string | readonly unknown[] | null | undefined | false;

  export interface SWRConfiguration<TData = unknown, TError = Error> {
    revalidateOnFocus?: boolean;
    revalidateOnReconnect?: boolean;
    refreshInterval?: number;
    dedupingInterval?: number;
    shouldRetryOnError?: boolean;
    errorRetryCount?: number;
    fallbackData?: TData;
    suspense?: boolean;
    onSuccess?: (data: TData) => void;
    onError?: (error: TError) => void;
  }

  export interface SWRResponse<TData = unknown, TError = Error> {
    data: TData | undefined;
    error: TError | undefined;
    isLoading: boolean;
    isValidating: boolean;
    mutate: (
      data?:
        | TData
        | Promise<TData>
        | ((current?: TData) => TData | Promise<TData>),
      opts?: boolean | { revalidate?: boolean },
    ) => Promise<TData | undefined>;
  }

  export type Fetcher<TData> = (...args: readonly unknown[]) => Promise<TData>;

  export default function useSWR<TData = unknown, TError = Error>(
    key: Key,
    fetcher: Fetcher<TData> | null,
    config?: SWRConfiguration<TData, TError>,
  ): SWRResponse<TData, TError>;
}

declare module "swr/mutation" {
  export interface SWRMutationConfiguration<
    TData = unknown,
    TError = Error,
    _TArg = never,
  > {
    onSuccess?: (data: TData) => void;
    onError?: (error: TError) => void;
  }

  export interface SWRMutationResponse<
    TData = unknown,
    TError = Error,
    TArg = never,
  > {
    trigger: (arg: TArg) => Promise<TData>;
    data: TData | undefined;
    error: TError | undefined;
    isMutating: boolean;
    reset: () => void;
  }

  export type MutationFetcher<TData, TArg = never> = (
    key: string | readonly unknown[],
    options: { arg: TArg },
  ) => Promise<TData>;

  export default function useSWRMutation<
    TData = unknown,
    TError = Error,
    TArg = never,
  >(
    key: string | readonly unknown[],
    fetcher: MutationFetcher<TData, TArg>,
    options?: SWRMutationConfiguration<TData, TError, TArg>,
  ): SWRMutationResponse<TData, TError, TArg>;
}
