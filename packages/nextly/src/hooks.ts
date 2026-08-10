/**
 * Database Lifecycle Hooks - Public API for NPM Package Consumers
 *
 * This module provides a clean, user-friendly API for registering and
 * managing database lifecycle hooks in Next.js 16 applications.
 *
 * **Usage in Next.js App:**
 * ```typescript
 * // app/db/hooks.ts
 * import { registerHook } from 'nextly';
 * import bcrypt from 'bcryptjs';
 *
 * // Hash password before creating user
 * registerHook('beforeCreate', 'users', async (context) => {
 *   if (context.data?.password) {
 *     const hashed = await bcrypt.hash(context.data.password, 10);
 *     return { ...context.data, password: hashed };
 *   }
 *   return context.data;
 * });
 *
 * // Send welcome email after user creation
 * registerHook('afterCreate', 'users', async (context) => {
 *   await sendWelcomeEmail(context.data.email);
 * });
 * ```
 *
 * @module hooks
 * @since 1.0.0
 */

import { getHookRegistry } from "@nextly/hooks/hook-registry";
import type {
  BeforeOperationHandler,
  HookContextPhase,
  HookType,
  HookHandler,
} from "@nextly/hooks/types";

/**
 * Register a database lifecycle hook
 *
 * Hooks allow you to run custom logic before/after database operations.
 * They are executed in the order they are registered (FIFO).
 *
 * **Hook Types:**
 * - `beforeCreate` - Run before creating a record (can modify data)
 * - `afterCreate` - Run after creating a record (for side effects)
 * - `beforeUpdate` - Run before updating a record (can modify data)
 * - `afterUpdate` - Run after updating a record (for side effects)
 * - `beforeDelete` - Run before deleting a record (can prevent deletion)
 * - `afterDelete` - Run after deleting a record (for cleanup)
 * - `beforeRead` - Run before reading records (can modify query)
 * - `afterRead` - Run after reading records (can transform data)
 *
 * @param hookType - Type of hook (e.g., 'beforeCreate', 'afterUpdate')
 * @param collection - Collection name or '*' for global hooks
 * @param handler - Hook function to execute
 *
 * @example
 * ```typescript
 * // Auto-generate slug from title
 * registerHook('beforeCreate', 'posts', (context) => {
 *   return {
 *     ...context.data,
 *     slug: slugify(context.data.title)
 *   };
 * });
 *
 * // Send notification after post creation
 * registerHook('afterCreate', 'posts', async (context) => {
 *   await notifySubscribers(context.data);
 * });
 *
 * // Global hook for all collections
 * registerHook('afterCreate', '*', async (context) => {
 *   console.log(`Created ${context.collection}:`, context.data.id);
 * });
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic default requires `any` for type-erased hook registry
export function registerHook<T = any>(
  hookType: HookContextPhase,
  collection: string,
  handler: HookHandler<T>
): void {
  const registry = getHookRegistry();
  // Owned by the app rather than by its config: this call site is reached once,
  // when the module holding it is evaluated, and nothing re-runs it. A config
  // reload rebuilds the config's own handlers and would have no way to put this
  // one back, so it must be left alone rather than cleared with them.
  registry.register(hookType, collection, handler, "app");
}

/**
 * Register a `beforeOperation` hook.
 *
 * Separate from {@link registerHook} because the handler is shaped differently:
 * it receives the operation's `args` -- the data, id or where clause about to
 * be used -- rather than a document, and returning a modified set replaces
 * them.
 *
 * @param collection - Collection name or '*' for global hooks
 * @param handler - Hook function to execute
 *
 * @example
 * ```typescript
 * registerBeforeOperationHook('posts', (context) => {
 *   if (context.operation === 'read') {
 *     return { ...context.args, where: { ...context.args.where, archived: false } };
 *   }
 * });
 * ```
 */
export function registerBeforeOperationHook<T = unknown>(
  collection: string,
  handler: BeforeOperationHandler<T>
): void {
  const registry = getHookRegistry();
  registry.registerBeforeOperation(collection, handler, "app");
}

/**
 * Unregister a specific database lifecycle hook
 *
 * Removes the exact handler function from the registry.
 * Useful for cleanup or dynamically enabling/disabling hooks.
 *
 * @param hookType - Type of hook
 * @param collection - Collection name or '*'
 * @param handler - The exact handler function to remove
 *
 * @example
 * ```typescript
 * const myHook = async (context) => {
 *   // Hook logic
 * };
 *
 * registerHook('beforeCreate', 'posts', myHook);
 *
 * // Later, remove the hook
 * unregisterHook('beforeCreate', 'posts', myHook);
 * ```
 */
export function unregisterHook(
  hookType: HookContextPhase,
  collection: string,
  handler: HookHandler
): void {
  const registry = getHookRegistry();
  // Scoped to what `registerHook` registered. Passing the same owner is what
  // makes the pair symmetric: without it, unregistering a function a plugin
  // also registered could take the plugin's entry instead of the app's.
  registry.unregister(hookType, collection, handler, "app");
}

/**
 * Unregister a `beforeOperation` hook, the counterpart to
 * {@link registerBeforeOperationHook}.
 *
 * @param collection - Collection name or '*'
 * @param handler - The exact handler function to remove
 */
export function unregisterBeforeOperationHook<T = unknown>(
  collection: string,
  handler: BeforeOperationHandler<T>
): void {
  const registry = getHookRegistry();
  registry.unregisterBeforeOperation(collection, handler, "app");
}

/**
 * Clear all hooks for a specific collection
 *
 * Removes all registered hooks associated with a collection.
 * Useful for testing cleanup or when a collection is deleted.
 *
 * @param collection - Collection name or '*' for global hooks
 *
 * @example
 * ```typescript
 * // Remove all hooks for 'posts' collection
 * clearCollectionHooks('posts');
 *
 * // Remove all global hooks
 * clearCollectionHooks('*');
 * ```
 */
export function clearCollectionHooks(collection: string): void {
  const registry = getHookRegistry();
  registry.clearCollection(collection);
}

/**
 * Clear all registered hooks
 *
 * Removes all hooks for all collections.
 * Primarily used for testing cleanup.
 *
 * @example
 * ```typescript
 * // In test cleanup
 * afterEach(() => {
 *   clearAllHooks();
 * });
 * ```
 */
export function clearAllHooks(): void {
  const registry = getHookRegistry();
  registry.clear();
}

/**
 * Check if hooks are registered for a collection/hook type
 *
 * Returns true if any hooks (global or collection-specific) are registered.
 * Useful for conditional logic or debugging.
 *
 * @param hookType - Type of hook to check
 * @param collection - Collection name
 * @returns True if hooks are registered
 *
 * @example
 * ```typescript
 * if (hasHooks('beforeCreate', 'users')) {
 *   console.log('User creation hooks are active');
 * }
 * ```
 */
export function hasHooks(hookType: HookType, collection: string): boolean {
  const registry = getHookRegistry();
  return registry.hasHooks(hookType, collection);
}

/**
 * Get count of registered hooks
 *
 * Returns the number of hooks registered for a specific type/collection.
 * Useful for debugging and monitoring.
 *
 * @param hookType - Type of hook
 * @param collection - Collection name or '*'
 * @returns Number of registered hooks
 *
 * @example
 * ```typescript
 * const count = getHookCount('beforeCreate', 'posts');
 * console.log(`${count} beforeCreate hooks for posts`);
 * ```
 */
export function getHookCount(hookType: HookType, collection: string): number {
  const registry = getHookRegistry();
  return registry.getHookCount(hookType, collection);
}

// Re-export types for consumer convenience. The `BeforeOperation*` trio travels
// together: a consumer typing a standalone handler needs the context it
// receives and the args it returns, not just the handler signature.
export type {
  BeforeOperationArgs,
  BeforeOperationContext,
  BeforeOperationHandler,
  HookContextPhase,
  HookType,
  HookHandler,
  HookContext,
} from "@nextly/hooks/types";
