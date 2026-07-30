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
 * import { registerCollectionHooks } from 'nextly/hooks';
 * import { loadConfig } from 'nextly/cli/utils/config-loader';
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
/**
 * What this module has already registered, per registry.
 *
 * Held here rather than in the registry because the registry deliberately
 * allows the same function to be subscribed more than once: two plugins may
 * share a handler, and one unsubscribing must not silence the other. Only this
 * path can tell that a second call describes declarations it already
 * registered.
 *
 * Weakly keyed, so a registry that goes out of scope -- one per test, for
 * instance -- takes its bookkeeping with it.
 */
const registeredByRegistry = new WeakMap<
  HookRegistry,
  Map<string, Set<HookHandler>>
>();

function registrationKey(hookType: HookType, collection: string): string {
  return `${hookType}:${collection}`;
}

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
 * import { registerCollectionHooks } from 'nextly/hooks';
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
 * import { registerCollectionHooks } from 'nextly/hooks';
 * import { loadConfig } from 'nextly/cli/utils/config-loader';
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
  let registered = registeredByRegistry.get(registry);
  if (!registered) {
    registered = new Map<string, Set<HookHandler>>();
    registeredByRegistry.set(registry, registered);
  }
  const rememberRegistration = (
    hookType: HookType,
    collection: string,
    handler: HookHandler
  ): void => {
    const key = registrationKey(hookType, collection);
    let handlers = registered.get(key);
    if (!handlers) {
      handlers = new Set<HookHandler>();
      registered.set(key, handlers);
    }
    handlers.add(handler);
  };

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

    // Driven by the mapping's own order, not the config object's. Two phases
    // can map onto the same queue -- `beforeValidate` and `beforeChange` both
    // become `beforeCreate`/`beforeUpdate` -- so the order they are registered
    // in IS their runtime order. Iterating the author's object would make that
    // depend on which key they happened to type first, and a collection
    // declaring `beforeChange` above `beforeValidate` would run its validation
    // transformation after the write hook that expects it. The mapping is
    // declared in the documented execution order, so following it keeps the
    // two in step.
    for (const hookKey of Object.keys(
      HOOK_TYPE_MAPPINGS
    ) as (keyof CollectionHooks)[]) {
      const handlers = collection.hooks[hookKey];
      if (!handlers || !Array.isArray(handlers) || handlers.length === 0) {
        continue;
      }

      const hookTypes = HOOK_TYPE_MAPPINGS[hookKey];

      // Register handlers for each mapped hook type
      for (const hookType of hookTypes) {
        for (const handler of handlers) {
          // A scaffolded app registers its collections' hooks itself and then
          // boots, which registers the same config again. Appending both copies
          // runs every hook twice: a transformation applied twice, and any side
          // effect duplicated.
          //
          // Skipped here rather than in the registry, which deliberately allows
          // the same function to be subscribed more than once -- two plugins may
          // share a handler, and one unsubscribing must not silence the other.
          // This path is different: it re-registers declarations that are
          // already registered, so the second copy is redundant rather than
          // additional. Identity comparison, so two distinct functions that
          // happen to do the same thing both still register.
          const alreadyRegistered = registered
            .get(registrationKey(hookType, collection.slug))
            ?.has(handler);
          if (alreadyRegistered) continue;

          registry.register(hookType, collection.slug, handler);
          rememberRegistration(hookType, collection.slug, handler);
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
