/**
 * Register Collection Hooks
 *
 * Utility to register hooks defined in code-first collection configurations
 * with the global HookRegistry. This bridges the gap between the declarative
 * hook definitions in `defineCollection()` and the runtime hook execution system.
 *
 * @module hooks/register-collection-hooks
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import { registerCollectionHooks } from '@revnixhq/nextly/hooks';
 * import { loadConfig } from '@revnixhq/nextly/cli/utils/config-loader';
 *
 * // During app initialization
 * const { config } = await loadConfig();
 * const result = registerCollectionHooks(config.collections);
 *
 * console.log(`Registered ${result.totalHooks} hooks for ${result.collections.length} collections`);
 * ```
 */

import type {
  CollectionConfig,
  CollectionHooks,
} from "../collections/config/define-collection";

import { getHookRegistry, type HookRegistry } from "./hook-registry";
import type { HookType, HookHandler } from "./types";

/**
 * Result of registering collection hooks
 */
export interface RegisterCollectionHooksResult {
  /**
   * Collection slugs that had hooks registered
   */
  collections: string[];

  /**
   * Total number of hooks registered
   */
  totalHooks: number;

  /**
   * Breakdown of hooks registered per collection
   */
  details: {
    collection: string;
    hooks: {
      type: string;
      count: number;
    }[];
  }[];
}

/**
 * Map collection hook types to HookRegistry hook types
 *
 * The CollectionHooks interface uses slightly different naming
 * (beforeChange/afterChange) which needs to be mapped to the
 * HookRegistry types (beforeCreate/beforeUpdate, etc.)
 */
const HOOK_TYPE_MAPPINGS: Record<keyof CollectionHooks, HookType[]> = {
  beforeOperation: ["beforeOperation"],
  beforeValidate: ["beforeCreate", "beforeUpdate"], // Validate runs before create/update
  beforeChange: ["beforeCreate", "beforeUpdate"],
  afterChange: ["afterCreate", "afterUpdate"],
  beforeRead: ["beforeRead"],
  afterRead: ["afterRead"],
  beforeDelete: ["beforeDelete"],
  afterDelete: ["afterDelete"],
};

/**
 * Register hooks from collection configurations with the global HookRegistry.
 *
 * This function takes an array of collection configurations (from `defineCollection()`)
 * and registers all their hooks with the global hook registry. This enables the hooks
 * to be executed during CRUD operations.
 *
 * **When to call:**
 * Call this function during application initialization, after loading the config
 * but before handling any requests.
 *
 * **Hook Mapping:**
 * Collection hooks use semantic names that map to specific registry hooks:
 * - `beforeChange` → `beforeCreate` and `beforeUpdate`
 * - `afterChange` → `afterCreate` and `afterUpdate`
 * - `beforeValidate` → `beforeCreate` and `beforeUpdate` (runs first)
 * - Other hooks map directly (beforeRead, afterRead, beforeDelete, afterDelete)
 *
 * @param collections - Array of collection configurations from `defineCollection()`
 * @param registry - Optional HookRegistry instance (defaults to global registry)
 * @returns Result object with registration statistics
 *
 * @example
 * ```typescript
 * import { registerCollectionHooks } from '@revnixhq/nextly/hooks';
 * import postsCollection from './collections/posts';
 * import usersCollection from './collections/users';
 *
 * const result = registerCollectionHooks([postsCollection, usersCollection]);
 *
 * console.log(`Registered hooks for: ${result.collections.join(', ')}`);
 * // Output: "Registered hooks for: posts, users"
 * ```
 *
 * @example
 * ```typescript
 * // With loaded config
 * import { registerCollectionHooks } from '@revnixhq/nextly/hooks';
 * import { loadConfig } from '@revnixhq/nextly/cli/utils/config-loader';
 *
 * async function initializeApp() {
 *   const { config } = await loadConfig();
 *
 *   // Register hooks from all collections in config
 *   const hookResult = registerCollectionHooks(config.collections);
 *
 *   console.log(`Initialized ${hookResult.totalHooks} hooks`);
 * }
 * ```
 */
export function registerCollectionHooks(
  collections: CollectionConfig[],
  registry: HookRegistry = getHookRegistry()
): RegisterCollectionHooksResult {
  const result: RegisterCollectionHooksResult = {
    collections: [],
    totalHooks: 0,
    details: [],
  };

  for (const collection of collections) {
    // Skip collections without hooks
    if (!collection.hooks) {
      continue;
    }

    const collectionDetails = {
      collection: collection.slug,
      hooks: [] as { type: string; count: number }[],
    };

    let collectionHookCount = 0;

    // Register each hook type
    for (const [hookKey, handlers] of Object.entries(collection.hooks)) {
      if (!handlers || !Array.isArray(handlers) || handlers.length === 0) {
        continue;
      }

      const hookTypes = HOOK_TYPE_MAPPINGS[hookKey as keyof CollectionHooks];
      if (!hookTypes) {
        continue;
      }

      // Register handlers for each mapped hook type
      for (const hookType of hookTypes) {
        for (const handler of handlers) {
          registry.register(hookType, collection.slug, handler as HookHandler);
          collectionHookCount++;
        }
      }

      collectionDetails.hooks.push({
        type: hookKey,
        count: handlers.length,
      });
    }

    if (collectionHookCount > 0) {
      result.collections.push(collection.slug);
      result.totalHooks += collectionHookCount;
      result.details.push(collectionDetails);
    }
  }

  return result;
}

/**
 * Clear all hooks for a specific collection.
 *
 * Useful when re-registering hooks after a config change (e.g., in watch mode).
 *
 * @param collectionSlug - The collection slug to clear hooks for
 * @param registry - Optional HookRegistry instance (defaults to global registry)
 */
export function clearCollectionHooks(
  collectionSlug: string,
  registry: HookRegistry = getHookRegistry()
): void {
  registry.clearCollection(collectionSlug);
}

/**
 * Re-register hooks for collections.
 *
 * Clears existing hooks for the given collections and registers new ones.
 * Useful for hot-reload scenarios in development mode.
 *
 * @param collections - Array of collection configurations
 * @param registry - Optional HookRegistry instance (defaults to global registry)
 * @returns Result object with registration statistics
 */
export function reregisterCollectionHooks(
  collections: CollectionConfig[],
  registry: HookRegistry = getHookRegistry()
): RegisterCollectionHooksResult {
  // Clear existing hooks for these collections
  for (const collection of collections) {
    registry.clearCollection(collection.slug);
  }

  // Register new hooks
  return registerCollectionHooks(collections, registry);
}
