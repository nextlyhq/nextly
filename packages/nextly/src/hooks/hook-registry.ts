/**
 * Database Lifecycle Hooks System - Hook Registry
 *
 * Centralized registry for managing and executing database lifecycle hooks.
 * Implements a singleton pattern with Map-based storage for efficient hook lookups.
 *
 * @module hooks/hook-registry
 * @since 1.0.0
 */

import type {
  BeforeOperationArgs,
  BeforeOperationContext,
  BeforeOperationHandler,
  HookContext,
  HookHandler,
  HookType,
} from "./types";

/**
 * Global hook registry singleton
 *
 * Manages registration and execution of database lifecycle hooks.
 * Supports collection-specific hooks and global wildcard hooks.
 *
 * **Features:**
 * - Collection-specific hooks: Register hooks for individual collections
 * - Global wildcard hooks: Register hooks for all collections using `*`
 * - Series execution: Hooks run in registration order (FIFO)
 * - Data transformation: `before*` hooks can modify data
 * - Side effects: `after*` hooks run for side effects only
 * - Performance optimization: `hasHooks()` check to skip execution
 *
 * **Usage:**
 * ```typescript
 * import { getHookRegistry } from '@revnixhq/nextly/hooks';
 *
 * const registry = getHookRegistry();
 *
 * // Register a hook
 * registry.register('beforeCreate', 'posts', async (context) => {
 *   return { ...context.data, slug: slugify(context.data.title) };
 * });
 *
 * // Execute hooks
 * const modifiedData = await registry.execute('beforeCreate', {
 *   collection: 'posts',
 *   operation: 'create',
 *   data: { title: 'My Post' },
 *   context: {}
 * });
 * ```
 *
 * @class HookRegistry
 */
export class HookRegistry {
  /**
   * Internal storage for hooks
   *
   * Key format: `${hookType}:${collection}`
   * Examples: "beforeCreate:posts", "afterUpdate:users", "beforeCreate:*"
   *
   * Wildcard key "*" matches all collections.
   */
  private hooks: Map<string, HookHandler[]> = new Map();

  /**
   * Register a hook for a specific collection and hook type
   *
   * Hooks are executed in the order they are registered (FIFO).
   * Multiple hooks can be registered for the same hook type and collection.
   *
   * @param hookType - Type of hook (beforeCreate, afterCreate, etc.)
   * @param collection - Collection name or '*' for global hooks
   * @param handler - Hook function to execute
   *
   * @example
   * ```typescript
   * const registry = getHookRegistry();
   *
   * // Collection-specific hook
   * registry.register('beforeCreate', 'users', async (context) => {
   *   context.data.password = await bcrypt.hash(context.data.password, 10);
   *   return context.data;
   * });
   *
   * // Global hook (runs for all collections)
   * registry.register('afterCreate', '*', async (context) => {
   *   console.log(`Created ${context.collection}:`, context.data.id);
   * });
   * ```
   */
  register(hookType: HookType, collection: string, handler: HookHandler): void {
    const key = this.makeKey(hookType, collection);

    if (!this.hooks.has(key)) {
      this.hooks.set(key, []);
    }

    this.hooks.get(key)!.push(handler);
  }

  /**
   * Unregister a specific hook
   *
   * Removes the exact handler function from the registry.
   * Useful for cleanup when hooks are no longer needed.
   *
   * @param hookType - Type of hook
   * @param collection - Collection name or '*'
   * @param handler - The exact handler function to remove
   *
   * @example
   * ```typescript
   * const myHook = async (context) => { ... };
   *
   * registry.register('beforeCreate', 'posts', myHook);
   * // Later...
   * registry.unregister('beforeCreate', 'posts', myHook);
   * ```
   */
  unregister(
    hookType: HookType,
    collection: string,
    handler: HookHandler
  ): void {
    const key = this.makeKey(hookType, collection);
    const handlers = this.hooks.get(key);

    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }

      // Clean up empty arrays to avoid memory leaks
      if (handlers.length === 0) {
        this.hooks.delete(key);
      }
    }
  }

  /**
   * Unregister all hooks for a specific collection
   *
   * Removes all hooks associated with a collection.
   * Useful when a collection is deleted or during testing cleanup.
   *
   * @param collection - Collection name or '*' for global hooks
   *
   * @example
   * ```typescript
   * // Remove all hooks for 'posts' collection
   * registry.clearCollection('posts');
   *
   * // Remove all global hooks
   * registry.clearCollection('*');
   * ```
   */
  clearCollection(collection: string): void {
    const hookTypes: HookType[] = [
      "beforeOperation",
      "beforeCreate",
      "afterCreate",
      "beforeUpdate",
      "afterUpdate",
      "beforeDelete",
      "afterDelete",
      "beforeRead",
      "afterRead",
    ];

    for (const hookType of hookTypes) {
      const key = this.makeKey(hookType, collection);
      this.hooks.delete(key);
    }
  }

  /**
   * Clear all hooks from the registry
   *
   * Removes all registered hooks for all collections.
   * Primarily used for testing cleanup.
   *
   * @example
   * ```typescript
   * // In test cleanup
   * afterEach(() => {
   *   registry.clear();
   * });
   * ```
   */
  clear(): void {
    this.hooks.clear();
  }

  /**
   * Execute all registered hooks for a given type and collection
   *
   * Hooks run in series (one after another) in registration order.
   * Global wildcard hooks (*) execute BEFORE collection-specific hooks.
   *
   * **Execution Order:**
   * 1. Global hooks (registered with '*')
   * 2. Collection-specific hooks
   *
   * **Data Flow:**
   * - For `before*` hooks: Each hook can modify data, which is passed to the next hook
   * - For `after*` hooks: Return values are ignored (used for side effects)
   *
   * **Error Handling:**
   * - If any hook throws an error, execution stops immediately
   * - The error is propagated to the caller (usually CollectionsHandler)
   * - This will cause the database transaction to rollback
   *
   * @template T - Type of the data being operated on
   * @param hookType - Type of hook to execute
   * @param context - Hook context with operation metadata
   * @returns Modified data (for before hooks) or void
   * @throws Error if any hook fails
   *
   * @example
   * ```typescript
   * // beforeCreate hook modifies data
   * const modifiedData = await registry.execute('beforeCreate', {
   *   collection: 'posts',
   *   operation: 'create',
   *   data: { title: 'My Post' },
   *   context: {}
   * });
   *
   * // afterCreate hook runs side effects
   * await registry.execute('afterCreate', {
   *   collection: 'posts',
   *   operation: 'create',
   *   data: createdPost,
   *   context: sharedContext
   * });
   * ```
   */
  async execute<T>(
    hookType: HookType,
    context: HookContext<T>
  ): Promise<T | void> {
    // Get hooks for specific collection + global hooks
    const specificKey = this.makeKey(hookType, context.collection);
    const globalKey = this.makeKey(hookType, "*");

    const globalHandlers = this.hooks.get(globalKey) || [];
    const specificHandlers = this.hooks.get(specificKey) || [];

    // Global hooks run first, then collection-specific hooks
    const allHandlers = [...globalHandlers, ...specificHandlers];

    // If no hooks registered, return early (optimization)
    if (allHandlers.length === 0) {
      return context.data;
    }

    let data = context.data;

    // Execute hooks in series (FIFO order)
    for (const handler of allHandlers) {
      try {
        // Pass current data to hook
        const result = await handler({ ...context, data });

        // If hook returns data (including null), use it for next hook
        // If hook returns undefined, keep current data unchanged
        // This allows before* hooks to intentionally set null values
        // while after* hooks can skip returning (undefined) for side effects
        if (result !== undefined) {
          data = result;
        }
      } catch (error: unknown) {
        // Re-throw with additional context for debugging
        throw new Error(
          `Hook execution failed for ${hookType} on ${context.collection}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    return data;
  }

  /**
   * Execute beforeOperation hooks for a collection
   *
   * beforeOperation hooks run BEFORE operation-specific hooks (beforeCreate, etc.)
   * and can modify operation arguments or throw to abort the operation.
   *
   * **Execution Order:**
   * 1. Global beforeOperation hooks (registered with '*')
   * 2. Collection-specific beforeOperation hooks
   * 3. Then operation-specific hooks (beforeCreate, beforeUpdate, etc.)
   *
   * **Args Flow:**
   * - Each hook can modify args (data, id, where), which is passed to the next hook
   * - If hook returns undefined/void, args remain unchanged
   * - If hook throws, operation is aborted
   *
   * **Use Cases:**
   * - Global logging/auditing of all operations
   * - Rate limiting across all operations
   * - Global validation or normalization
   * - Modifying operation arguments before they reach specific hooks
   *
   * @template T - Type of the data being operated on
   * @param context - BeforeOperation context with operation metadata and args
   * @returns Modified args or void (if no modification)
   * @throws Error if any hook fails
   *
   * @example
   * ```typescript
   * // Global logging for all operations
   * registry.register('beforeOperation', '*', async (context) => {
   *   console.log(`[${context.operation}] ${context.collection}`, context.args);
   * });
   *
   * // Execute beforeOperation hooks
   * const modifiedArgs = await registry.executeBeforeOperation({
   *   collection: 'posts',
   *   operation: 'create',
   *   args: { data: { title: 'My Post' } },
   *   context: {}
   * });
   *
   * // Use modifiedArgs.data for the actual create operation
   * ```
   */
  async executeBeforeOperation<T>(
    context: BeforeOperationContext<T>
  ): Promise<BeforeOperationArgs<T> | void> {
    // Get hooks for specific collection + global hooks
    const specificKey = this.makeKey("beforeOperation", context.collection);
    const globalKey = this.makeKey("beforeOperation", "*");

    const globalHandlers = this.hooks.get(globalKey) || [];
    const specificHandlers = this.hooks.get(specificKey) || [];

    // Global hooks run first, then collection-specific hooks
    const allHandlers = [
      ...globalHandlers,
      ...specificHandlers,
    ] as BeforeOperationHandler<T>[];

    // If no hooks registered, return early (optimization)
    if (allHandlers.length === 0) {
      return context.args;
    }

    let args = context.args;

    // Execute hooks in series (FIFO order)
    for (const handler of allHandlers) {
      try {
        // Pass current args to hook
        const result = await handler({ ...context, args });

        // If hook returns args, use it for next hook
        // If hook returns undefined/void, keep current args unchanged
        if (result !== undefined) {
          args = result;
        }
      } catch (error: unknown) {
        // Re-throw with additional context for debugging
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Hook execution failed for beforeOperation on ${context.collection}: ${message}`
        );
      }
    }

    return args;
  }

  /**
   * Check if any hooks are registered for a given type/collection
   *
   * Performance optimization: Allows callers to skip hook execution
   * if no hooks are registered, avoiding unnecessary overhead.
   *
   * @param hookType - Type of hook to check
   * @param collection - Collection name
   * @returns True if hooks are registered (global or specific)
   *
   * @example
   * ```typescript
   * if (registry.hasHooks('beforeCreate', 'posts')) {
   *   const modifiedData = await registry.execute('beforeCreate', context);
   * }
   * ```
   */
  hasHooks(hookType: HookType, collection: string): boolean {
    const specificKey = this.makeKey(hookType, collection);
    const globalKey = this.makeKey(hookType, "*");

    const specificCount = this.hooks.get(specificKey)?.length ?? 0;
    const globalCount = this.hooks.get(globalKey)?.length ?? 0;

    return specificCount > 0 || globalCount > 0;
  }

  /**
   * Get count of registered hooks for a specific type/collection
   *
   * Useful for debugging and monitoring.
   *
   * @param hookType - Type of hook
   * @param collection - Collection name or '*'
   * @returns Number of registered hooks
   *
   * @example
   * ```typescript
   * const count = registry.getHookCount('beforeCreate', 'posts');
   * console.log(`${count} beforeCreate hooks registered for posts`);
   * ```
   */
  getHookCount(hookType: HookType, collection: string): number {
    const key = this.makeKey(hookType, collection);
    return this.hooks.get(key)?.length ?? 0;
  }

  /**
   * Get all registered hooks (for debugging/introspection)
   *
   * Returns a snapshot of all registered hooks.
   * Useful for debugging and testing.
   *
   * @returns Map of hook keys to handler arrays
   * @internal
   */
  getAll(): Map<string, HookHandler[]> {
    // Return a copy to prevent external mutation
    return new Map(this.hooks);
  }

  /**
   * Generate storage key for hook type + collection
   * @private
   */
  private makeKey(hookType: HookType, collection: string): string {
    return `${hookType}:${collection}`;
  }
}

/**
 * Global singleton instance of HookRegistry
 *
 * Immediately initialized to prevent race conditions in concurrent environments.
 * This ensures true singleton behavior without lazy initialization checks.
 */
// Use globalThis to survive ESM module duplication in Next.js/Turbopack.
// Without this, each re-evaluation creates a new registry, causing hooks
// registered during registerServices() to be lost.
const globalForHooks = globalThis as unknown as {
  __nextly_hookRegistry?: HookRegistry;
};

if (!globalForHooks.__nextly_hookRegistry) {
  globalForHooks.__nextly_hookRegistry = new HookRegistry();
}

const globalRegistry: HookRegistry = globalForHooks.__nextly_hookRegistry;

/**
 * Get the global hook registry singleton
 *
 * Always use this function to access the registry to ensure
 * a single instance is shared across the application.
 *
 * @returns Global HookRegistry instance
 *
 * @example
 * ```typescript
 * import { getHookRegistry } from '@revnixhq/nextly/hooks';
 *
 * const registry = getHookRegistry();
 * registry.register('beforeCreate', 'posts', myHook);
 * ```
 */
export function getHookRegistry(): HookRegistry {
  return globalRegistry;
}

/**
 * Reset the global hook registry (for testing only)
 *
 * Clears all registered hooks from the global registry.
 * Should only be used in test cleanup.
 *
 * @internal
 * @example
 * ```typescript
 * // In test cleanup
 * afterEach(() => {
 *   resetHookRegistry();
 * });
 * ```
 */
export function resetHookRegistry(): void {
  globalRegistry.clear();
}
