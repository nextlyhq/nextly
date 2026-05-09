/**
 * TanStack Query Type Exports
 *
 * This file re-exports commonly used types from TanStack Query for library consumers.
 * These types are useful when creating custom hooks or configuring queries/mutations.
 *
 * @module types/query
 */

// Re-export core TanStack Query types
export type {
  QueryClient,
  QueryClientConfig,
  DefaultOptions,
  UseQueryOptions,
  UseMutationOptions,
  UseQueryResult,
  UseMutationResult,
  QueryKey,
  QueryFunction,
  MutationFunction,
} from "@tanstack/react-query";

/**
 * Configuration used for the default QueryClient in QueryProvider
 *
 * This type represents the configuration applied to the QueryClient instance
 * in the QueryProvider component.
 *
 * @example
 * ```typescript
 * import type { QueryClientConfigType } from '@nextly/admin';
 *
 * const customConfig: QueryClientConfigType = {
 *   defaultOptions: {
 *     queries: {
 *       staleTime: 5 * 60 * 1000,
 *       gcTime: 10 * 60 * 1000,
 *       retry: 1,
 *       refetchOnWindowFocus: false,
 *     },
 *     mutations: {
 *       retry: 2,
 *     },
 *   },
 * };
 * ```
 */
export type QueryClientConfigType = {
  defaultOptions?: {
    queries?: {
      staleTime?: number;
      gcTime?: number;
      retry?: number | false;
      refetchOnWindowFocus?: boolean;
      refetchOnMount?: boolean;
      refetchOnReconnect?: boolean;
    };
    mutations?: {
      retry?: number | false;
    };
  };
};
