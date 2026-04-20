/**
 * Stored Hook Executor
 *
 * Executes pre-built hooks configured via the Admin UI.
 * Loads stored hook configurations from collection records and executes
 * matching pre-built hooks with their stored configurations.
 *
 * @module hooks/stored-hook-executor
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import { StoredHookExecutor } from '@nextly/hooks/stored-hook-executor';
 *
 * const executor = new StoredHookExecutor();
 *
 * // Execute stored hooks for a collection
 * const modifiedData = await executor.execute(
 *   'beforeCreate',
 *   collection,
 *   hookContext
 * );
 * ```
 */

import type {
  StoredHookConfig,
  StoredHookType,
} from "@nextly/schemas/dynamic-collections/types";

import type { PrebuiltHookContext } from "./prebuilt";
import { getPrebuiltHook, mapHookType } from "./prebuilt";
import type { HookType } from "./types";

/**
 * Result of stored hook execution.
 *
 * Contains the potentially modified data and metadata about the execution.
 */
export interface StoredHookExecutionResult<T = unknown> {
  /**
   * The data after all hooks have executed.
   * May be modified by before* hooks.
   */
  data: T | undefined;

  /**
   * Number of hooks that were executed.
   */
  executedCount: number;

  /**
   * IDs of hooks that were skipped (disabled or not found).
   */
  skippedHookIds: string[];
}

/**
 * Options for stored hook execution.
 */
export interface StoredHookExecutorOptions {
  /**
   * If true, logs debug information about hook execution.
   * @default false
   */
  debug?: boolean;
}

/**
 * StoredHookExecutor handles execution of pre-built hooks configured via UI.
 *
 * This executor is designed to run AFTER code-registered hooks in the
 * HookRegistry, providing a clear execution order:
 * 1. Code-registered hooks (via HookRegistry)
 * 2. Stored/UI-configured hooks (via StoredHookExecutor)
 *
 * **Features:**
 * - Loads stored hooks from collection record
 * - Maps virtual hook types (beforeChange → beforeCreate, beforeUpdate)
 * - Executes hooks in order (by `order` field)
 * - Chains data modifications for before* hooks
 * - Skips disabled hooks
 * - Provides detailed error messages on failure
 *
 * **Error Handling:**
 * - If any hook throws, execution aborts immediately
 * - Error includes hook ID for debugging
 * - Follows same pattern as HookRegistry
 *
 * @example
 * ```typescript
 * const executor = new StoredHookExecutor();
 *
 * // In CollectionEntryService.createEntry():
 * // After code hooks run via hookRegistry.execute()
 * const result = await executor.execute(
 *   'beforeCreate',
 *   collection,
 *   { ...context, data: modifiedData }
 * );
 *
 * // Use result.data for database insert
 * ```
 */
export class StoredHookExecutor {
  private options: StoredHookExecutorOptions;

  constructor(options: StoredHookExecutorOptions = {}) {
    this.options = options;
  }

  /**
   * Execute stored hooks for a specific hook type.
   *
   * Loads enabled hooks from the collection record that match the given
   * hook type and executes them in order. Data modifications chain
   * through before* hooks.
   *
   * @template T - Type of the data being operated on
   * @param hookType - The hook type to execute (e.g., 'beforeCreate', 'afterUpdate')
   * @param storedHooks - Array of stored hook configurations from the collection
   * @param context - The hook context with current data and metadata
   * @returns Execution result with potentially modified data
   * @throws Error if any hook fails (includes hook ID in message)
   *
   * @example
   * ```typescript
   * const result = await executor.execute(
   *   'beforeCreate',
   *   collection.hooks ?? [],
   *   {
   *     collection: 'posts',
   *     operation: 'create',
   *     data: { title: 'My Post' },
   *     user: { id: 'user-123' },
   *     context: {}
   *   }
   * );
   *
   * console.log(result.data); // { title: 'My Post', slug: 'my-post' }
   * console.log(result.executedCount); // 1
   * ```
   */
  async execute<T = unknown>(
    hookType: HookType,
    storedHooks: StoredHookConfig[] | undefined | null,
    context: PrebuiltHookContext
  ): Promise<StoredHookExecutionResult<T>> {
    // Return early if no hooks configured
    if (!storedHooks || storedHooks.length === 0) {
      return {
        data: context.data as T | undefined,
        executedCount: 0,
        skippedHookIds: [],
      };
    }

    // Filter hooks that match this hook type
    const matchingHooks = this.getMatchingHooks(hookType, storedHooks);

    // Sort by order (ascending)
    const sortedHooks = [...matchingHooks].sort((a, b) => a.order - b.order);

    let currentData = context.data;
    let executedCount = 0;
    const skippedHookIds: string[] = [];

    for (const storedHook of sortedHooks) {
      // Skip disabled hooks
      if (!storedHook.enabled) {
        skippedHookIds.push(storedHook.hookId);
        if (this.options.debug) {
          console.debug(
            `[Nextly] Skipping disabled hook: ${storedHook.hookId}`
          );
        }
        continue;
      }

      // Find the pre-built hook by ID
      const prebuiltHook = getPrebuiltHook(storedHook.hookId);

      if (!prebuiltHook) {
        skippedHookIds.push(storedHook.hookId);
        if (this.options.debug) {
          console.warn(
            `[Nextly] Pre-built hook not found: ${storedHook.hookId}`
          );
        }
        continue;
      }

      try {
        // Build context for this hook execution
        const hookContext: PrebuiltHookContext = {
          ...context,
          data: currentData,
        };

        // Execute the pre-built hook with stored configuration
        const result = await prebuiltHook.execute(
          storedHook.config,
          hookContext
        );

        // For before* hooks, chain data modifications
        // After* hooks return void, so result will be undefined
        if (result !== undefined) {
          currentData = result as T;
        }

        executedCount++;

        if (this.options.debug) {
          console.debug(
            `[Nextly] Executed stored hook: ${storedHook.hookId} (${hookType})`
          );
        }
      } catch (error: unknown) {
        // Re-throw with hook ID for debugging
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Stored hook "${storedHook.hookId}" failed for ${hookType} on ${context.collection}: ${message}`
        );
      }
    }

    return {
      data: currentData as T | undefined,
      executedCount,
      skippedHookIds,
    };
  }

  /**
   * Check if there are any enabled hooks for a given hook type.
   *
   * Useful for performance optimization - skip execution if no hooks match.
   *
   * @param hookType - The hook type to check
   * @param storedHooks - Array of stored hook configurations
   * @returns True if there are enabled hooks for this type
   *
   * @example
   * ```typescript
   * if (executor.hasHooks('beforeCreate', collection.hooks)) {
   *   const result = await executor.execute('beforeCreate', collection.hooks, context);
   * }
   * ```
   */
  hasHooks(
    hookType: HookType,
    storedHooks: StoredHookConfig[] | undefined | null
  ): boolean {
    if (!storedHooks || storedHooks.length === 0) {
      return false;
    }

    const matchingHooks = this.getMatchingHooks(hookType, storedHooks);
    return matchingHooks.some(hook => hook.enabled);
  }

  /**
   * Get stored hooks that match a specific hook type.
   *
   * Handles virtual hook types (beforeChange, afterChange) by checking
   * if they map to the requested actual hook type.
   *
   * @param hookType - The actual hook type (e.g., 'beforeCreate')
   * @param storedHooks - Array of stored hook configurations
   * @returns Hooks that should run for this hook type
   */
  private getMatchingHooks(
    hookType: HookType,
    storedHooks: StoredHookConfig[]
  ): StoredHookConfig[] {
    return storedHooks.filter(hook => {
      // Direct match
      if (hook.hookType === hookType) {
        return true;
      }

      // Check virtual types (beforeChange, afterChange)
      const mappedTypes = mapHookType(hook.hookType as StoredHookType);
      return mappedTypes.includes(hookType);
    });
  }
}

/**
 * Default executor instance for convenience.
 *
 * Use this when you don't need custom options.
 *
 * @example
 * ```typescript
 * import { storedHookExecutor } from '@nextly/hooks/stored-hook-executor';
 *
 * const result = await storedHookExecutor.execute(
 *   'beforeCreate',
 *   collection.hooks,
 *   context
 * );
 * ```
 */
export const storedHookExecutor = new StoredHookExecutor();
