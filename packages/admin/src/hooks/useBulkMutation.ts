"use client";

import { useState, useCallback } from "react";

import type {
  BulkMutationResult,
  BulkMutationOptions,
  BulkMutationItemResult,
  UseBulkMutationReturn,
  UseBulkMutationConfig,
} from "../types/hooks/bulk-mutation";

/**
 * Generic hook for performing bulk mutations with parallel execution and partial failure handling
 *
 * Executes multiple mutations in parallel using `Promise.allSettled()`, allowing some to succeed
 * while others fail. Provides detailed results including success/failure counts and individual errors.
 *
 * This is the foundation for all bulk operations in Nextly (users, roles, content, media, etc.).
 *
 * ## Key Features
 * - ✅ **Parallel Execution**: Uses `Promise.allSettled()` for concurrent mutations
 * - ✅ **Partial Failure Handling**: Some items can fail while others succeed
 * - ✅ **Detailed Results**: Success/failure counts, individual errors, IDs
 * - ✅ **Loading State**: `isPending` flag for UI feedback
 * - ✅ **Type Safety**: Full TypeScript generics for any entity type
 * - ✅ **Reusable**: Single hook for Users, Roles, Content, Media, etc.
 * - ✅ **Flexible Callbacks**: Lifecycle hooks for success/error/complete
 *
 * ## Architecture Pattern
 *
 * ```
 * useBulkMutation (Generic)
 *   ↓
 * useBulkUpdateUsers (Entity-Specific)
 *   ↓
 * UserTable Component (UI)
 * ```
 *
 * ## Generic Parameters
 * - `TId` - Type of item identifier (default: string)
 * - `TData` - Type of mutation result data (default: void)
 * - `TError` - Type of error (default: Error)
 * - `TContext` - Type of additional context data passed to mutations (e.g., roleId, updates)
 *
 * ## Use Cases
 *
 * ### 1. Bulk User Operations
 * - Assign role to multiple users
 * - Delete multiple users
 * - Enable/disable multiple accounts
 *
 * ### 2. Bulk Content Operations
 * - Publish multiple posts
 * - Archive multiple posts
 * - Delete multiple posts
 *
 * ### 3. Bulk Media Operations
 * - Delete multiple files
 * - Move files to folder
 * - Update metadata
 *
 * ## Error Handling Strategy
 *
 * Uses `Promise.allSettled()` which:
 * - Never throws (all promises resolve)
 * - Returns `{ status: 'fulfilled', value }` for successes
 * - Returns `{ status: 'rejected', reason }` for failures
 * - Allows partial success (8/10 succeed, 2/10 fail)
 *
 * ## Performance Considerations
 *
 * - **Batching**: Consider batching large operations (100+ items)
 * - **Rate Limiting**: Backend should handle rate limits
 * - **Progress**: Use `onItemComplete` callback for progress tracking
 * - **Cancellation**: Not supported (consider adding AbortController in future)
 *
 * @template TId - Type of item identifier (e.g., string, number)
 * @template TData - Type of mutation result data (e.g., User, void)
 * @template TError - Type of error (e.g., Error, ApiError)
 * @template TContext - Type of context data passed to each mutation (e.g., { roleId: string })
 *
 * @param config - Configuration object with mutationFn and defaultOptions
 * @returns Bulk mutation interface with mutate function and state
 *
 * @example Basic usage - Bulk delete users
 * ```tsx
 * const { mutate, isPending } = useBulkMutation<string, void>({
 *   mutationFn: async (userId) => {
 *     await deleteUser(userId);
 *   },
 * });
 *
 * const handleBulkDelete = async () => {
 *   const result = await mutate(['user1', 'user2', 'user3'], undefined);
 *   console.log(`${result.succeeded} deleted, ${result.failed} failed`);
 * };
 * ```
 *
 * @example With context - Bulk assign role
 * ```tsx
 * const { mutate } = useBulkMutation<string, User, Error, { roleId: string }>({
 *   mutationFn: async (userId, context) => {
 *     return await updateUser(userId, { roles: [{ id: context.roleId }] });
 *   },
 * });
 *
 * await mutate(['user1', 'user2'], { roleId: 'editor' });
 * ```
 *
 * @example With callbacks
 * ```tsx
 * const { mutate } = useBulkMutation({
 *   mutationFn: deleteUser,
 *   defaultOptions: {
 *     onSuccess: (result) => {
 *       toast.success(`${result.succeeded} users deleted`);
 *     },
 *     onError: (result) => {
 *       toast.error(`${result.failed} users failed to delete`);
 *     },
 *     onComplete: (result) => {
 *       console.log('Bulk operation complete', result);
 *     },
 *   },
 * });
 * ```
 *
 * @example Progress tracking
 * ```tsx
 * const [progress, setProgress] = useState(0);
 *
 * const { mutate } = useBulkMutation({
 *   mutationFn: deleteUser,
 *   defaultOptions: {
 *     onItemComplete: (itemResult) => {
 *       setProgress(prev => prev + 1);
 *       console.log(`Item ${itemResult.id}: ${itemResult.status}`);
 *     },
 *   },
 * });
 * ```
 *
 * @see {@link BulkMutationResult} for result structure
 * @see {@link BulkMutationOptions} for callback options
 */
export function useBulkMutation<
  TId = string,
  TData = void,
  TError = Error,
  TContext = void,
>(
  config: UseBulkMutationConfig<TId, TData, TError, TContext>
): UseBulkMutationReturn<TId, TData, TError, TContext> {
  const { mutationFn, defaultOptions } = config;

  // State management
  const [isPending, setIsPending] = useState(false);
  const [result, setResult] = useState<BulkMutationResult<
    TData,
    TError
  > | null>(null);

  /**
   * Execute bulk mutation with Promise.allSettled()
   *
   * Core implementation:
   * 1. Set isPending = true
   * 2. Map ids to promises, wrap each in try-catch
   * 3. Execute Promise.allSettled() for parallel execution
   * 4. Aggregate results (succeeded/failed counts, IDs)
   * 5. Call lifecycle callbacks (onItemComplete, onSuccess, onError, onComplete)
   * 6. Set isPending = false
   * 7. Return aggregated result
   *
   * @param ids - Array of item IDs to mutate
   * @param context - Additional context data for mutations (e.g., roleId, updates)
   * @param options - Per-call callback options (override defaults)
   * @returns Promise resolving to aggregated results
   */
  const mutateAsync = useCallback(
    async (
      ids: TId[],
      context: TContext,
      options?: BulkMutationOptions<TData, TError>
    ): Promise<BulkMutationResult<TData, TError>> => {
      // Merge options (per-call options override defaults)
      const mergedOptions = { ...defaultOptions, ...options };

      // Reset result state from previous mutations to prevent stale data
      setResult(null);
      setIsPending(true);

      try {
        // Execute all mutations in parallel with Promise.allSettled()
        // Promise.allSettled handles both successes and failures
        const settledResults = await Promise.allSettled(
          ids.map(async id => {
            const data = await mutationFn(id, context);
            return {
              id: String(id), // Stringify ID for consistency
              data,
            };
          })
        );

        // Transform settled results into consistent structure
        const results: BulkMutationItemResult<TData, TError>[] =
          settledResults.map((result, index) => {
            if (result.status === "fulfilled") {
              return {
                id: result.value.id,
                status: "fulfilled" as const,
                data: result.value.data,
              };
            } else {
              // Rejection: extract error and use original ID
              return {
                id: String(ids[index]),
                status: "rejected" as const,
                error: result.reason as TError,
              };
            }
          });

        // Aggregate results for summary statistics
        const succeeded = results.filter(r => r.status === "fulfilled").length;
        const failed = results.filter(r => r.status === "rejected").length;
        const succeededIds = results
          .filter(r => r.status === "fulfilled")
          .map(r => r.id);
        const failedIds = results
          .filter(r => r.status === "rejected")
          .map(r => r.id);

        const bulkResult: BulkMutationResult<TData, TError> = {
          succeeded,
          failed,
          total: ids.length,
          results,
          succeededIds,
          failedIds,
        };

        setResult(bulkResult);

        // Call lifecycle callbacks in order:

        // 1. onItemComplete - called for each individual result
        if (mergedOptions.onItemComplete) {
          results.forEach(itemResult => {
            mergedOptions.onItemComplete!(itemResult);
          });
        }

        // 2. onComplete - always called after all mutations settle
        if (mergedOptions.onComplete) {
          mergedOptions.onComplete(bulkResult);
        }

        // 3. onSuccess - only called if at least one succeeded
        if (succeeded > 0 && mergedOptions.onSuccess) {
          mergedOptions.onSuccess(bulkResult);
        }

        // 4. onError - only called if at least one failed
        if (failed > 0 && mergedOptions.onError) {
          mergedOptions.onError(bulkResult);
        }

        return bulkResult;
      } finally {
        // Always set isPending = false, even if callbacks throw
        setIsPending(false);
      }
    },
    [mutationFn, defaultOptions]
  );

  /**
   * Non-async version (for callback-style usage)
   * Alias for mutateAsync for consistency with TanStack Query
   */
  const mutate = useCallback(
    (
      ids: TId[],
      context: TContext,
      options?: BulkMutationOptions<TData, TError>
    ) => {
      return mutateAsync(ids, context, options);
    },
    [mutateAsync]
  );

  /**
   * Reset mutation state
   * Sets isPending = false, result = null
   * Useful for clearing state after bulk operation
   */
  const reset = useCallback(() => {
    setIsPending(false);
    setResult(null);
  }, []);

  return {
    mutate,
    mutateAsync,
    isPending,
    isIdle: !isPending && result === null,
    result,
    reset,
  };
}
