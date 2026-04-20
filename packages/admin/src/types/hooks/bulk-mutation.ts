/**
 * Bulk Mutation Types
 *
 * TypeScript types for the generic bulk mutation system. These types enable type-safe
 * bulk operations across any entity type (Users, Roles, Content, Media, etc.).
 *
 * ## Architecture
 * - Generic types support any entity via TypeScript generics
 * - Detailed result tracking with success/failure counts
 * - Individual item results for granular error handling
 * - Flexible callback system for lifecycle hooks
 *
 * @module types/hooks/bulk-mutation
 */

/**
 * Result of a single mutation in a bulk operation
 *
 * Represents the outcome of one mutation within a bulk operation.
 * Can be either successful (fulfilled) or failed (rejected).
 *
 * @template TData - Type of the mutation result data
 * @template TError - Type of error (default: Error)
 *
 * @example
 * ```typescript
 * const itemResult: BulkMutationItemResult<User, Error> = {
 *   id: 'user123',
 *   status: 'fulfilled',
 *   data: { id: 'user123', name: 'John Doe', ... }
 * };
 * ```
 */
export interface BulkMutationItemResult<TData = unknown, TError = Error> {
  /** Unique identifier of the item (stringified) */
  id: string;
  /** Mutation status from Promise.allSettled() */
  status: "fulfilled" | "rejected";
  /** Result data if mutation succeeded */
  data?: TData;
  /** Error if mutation failed */
  error?: TError;
}

/**
 * Aggregated results of a bulk mutation operation
 *
 * Contains summary statistics and detailed results for all mutations in a bulk operation.
 * Useful for displaying toast notifications ("8 users updated, 2 failed") and error handling.
 *
 * @template TData - Type of the mutation result data
 * @template TError - Type of error (default: Error)
 *
 * @example
 * ```typescript
 * const result: BulkMutationResult<User, Error> = {
 *   succeeded: 8,
 *   failed: 2,
 *   total: 10,
 *   results: [...],
 *   succeededIds: ['user1', 'user2', ...],
 *   failedIds: ['user9', 'user10']
 * };
 *
 * toast.success(`${result.succeeded} users updated successfully`);
 * if (result.failed > 0) {
 *   toast.error(`${result.failed} users failed to update`);
 * }
 * ```
 */
export interface BulkMutationResult<TData = unknown, TError = Error> {
  /** Number of successful mutations */
  succeeded: number;
  /** Number of failed mutations */
  failed: number;
  /** Total number of mutations attempted */
  total: number;
  /** Individual results for each item (for detailed error handling) */
  results: BulkMutationItemResult<TData, TError>[];
  /** IDs of successfully mutated items */
  succeededIds: string[];
  /** IDs of failed items (for retry logic) */
  failedIds: string[];
}

/**
 * Options for configuring bulk mutation behavior
 *
 * Callback hooks for different stages of the bulk mutation lifecycle.
 * All callbacks are optional.
 *
 * @template TData - Type of the mutation result data
 * @template TError - Type of error (default: Error)
 *
 * @example
 * ```typescript
 * const options: BulkMutationOptions<User, Error> = {
 *   onComplete: (result) => {
 *     console.log(`Bulk operation complete: ${result.succeeded}/${result.total}`);
 *   },
 *   onSuccess: (result) => {
 *     toast.success(`${result.succeeded} users updated`);
 *   },
 *   onError: (result) => {
 *     toast.error(`${result.failed} users failed`);
 *   },
 * };
 * ```
 */
export interface BulkMutationOptions<TData = unknown, TError = Error> {
  /**
   * Callback when all mutations complete (regardless of success/failure)
   * Called after all individual mutations settle
   */
  onComplete?: (result: BulkMutationResult<TData, TError>) => void;

  /**
   * Callback when at least one mutation succeeds
   * Only called if result.succeeded > 0
   */
  onSuccess?: (result: BulkMutationResult<TData, TError>) => void;

  /**
   * Callback when at least one mutation fails
   * Only called if result.failed > 0
   */
  onError?: (result: BulkMutationResult<TData, TError>) => void;

  /**
   * Callback for each individual mutation result
   * Called once per item, useful for granular tracking
   */
  onItemComplete?: (result: BulkMutationItemResult<TData, TError>) => void;
}

/**
 * Return type of useBulkMutation hook
 *
 * Provides the mutate function and state management for bulk operations.
 *
 * @template TId - Type of item identifier (default: string)
 * @template TData - Type of mutation result data
 * @template TError - Type of error (default: Error)
 * @template TContext - Type of additional context data passed to mutations
 *
 * @example
 * ```typescript
 * const {
 *   mutate,
 *   mutateAsync,
 *   isPending,
 *   result
 * }: UseBulkMutationReturn<string, User, Error, { roleId: string }> = useBulkMutation({
 *   mutationFn: async (userId, context) => {
 *     return await assignRole(userId, context.roleId);
 *   }
 * });
 * ```
 */
export interface UseBulkMutationReturn<
  TId = string,
  TData = unknown,
  TError = Error,
  TContext = void,
> {
  /**
   * Execute bulk mutation (promise-based)
   *
   * @param ids - Array of item IDs to mutate
   * @param context - Additional data to pass to each mutation
   * @param options - Callback options for lifecycle hooks
   * @returns Promise resolving to aggregated results
   */
  mutate: (
    ids: TId[],
    context: TContext,
    options?: BulkMutationOptions<TData, TError>
  ) => Promise<BulkMutationResult<TData, TError>>;

  /**
   * Execute bulk mutation (async/await)
   * Alias for mutate() for consistency with TanStack Query
   */
  mutateAsync: (
    ids: TId[],
    context: TContext,
    options?: BulkMutationOptions<TData, TError>
  ) => Promise<BulkMutationResult<TData, TError>>;

  /** Whether any mutations are currently in progress */
  isPending: boolean;

  /** Whether mutations are idle (not started) */
  isIdle: boolean;

  /** Latest bulk mutation result (null if no mutations run yet) */
  result: BulkMutationResult<TData, TError> | null;

  /** Reset mutation state (clear result, set to idle) */
  reset: () => void;
}

/**
 * Configuration for useBulkMutation hook
 *
 * @template TId - Type of item identifier
 * @template TData - Type of mutation result data
 * @template TError - Type of error
 * @template TContext - Type of additional context data
 */
export interface UseBulkMutationConfig<
  TId = string,
  TData = unknown,
  TError = Error,
  TContext = void,
> {
  /**
   * Function to execute for each item
   *
   * @param id - Item identifier
   * @param context - Additional context data (e.g., roleId for bulk assign role)
   * @returns Promise resolving to mutation result
   *
   * @example
   * ```typescript
   * mutationFn: async (userId, context) => {
   *   return await updateUser(userId, { roleId: context.roleId });
   * }
   * ```
   */
  mutationFn: (id: TId, context: TContext) => Promise<TData>;

  /**
   * Default options applied to all mutations
   * Can be overridden per mutate() call
   */
  defaultOptions?: BulkMutationOptions<TData, TError>;
}
