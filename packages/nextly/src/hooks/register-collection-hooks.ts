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

import type { CollectionHooks } from "../collections/config/define-collection";

import {
  getHookRegistry,
  type HookRegistry,
  type OwnedHookSet,
} from "./hook-registry";
import type { HookContextPhase } from "./types";

/**
 * The part of a collection this module reads.
 *
 * Deliberately narrower than `CollectionConfig`: registration needs a slug and
 * a hooks block and nothing else, and demanding the whole config shuts out a
 * caller that legitimately holds only these two -- the config reload works from
 * the sanitized config the loader returns, not from `defineCollection()`
 * objects. Every `CollectionConfig` still satisfies this, so existing callers
 * are unaffected.
 */
export interface HookedCollection {
  slug: string;
  hooks?: CollectionHooks;
}

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
 *
 * A phase maps onto several registry types only where the declaration genuinely
 * covers both write paths at the same moment. `beforeChange` does not: it sits
 * on the far side of the validation gate, so it has a queue of its own.
 */
const HOOK_TYPE_MAPPINGS: Record<DataPhaseKey, HookContextPhase[]> = {
  beforeValidate: ["beforeCreate", "beforeUpdate"], // Validate runs before create/update
  // Its own phase, not the pre-validation queue. Both declarations used to
  // register onto `beforeCreate`/`beforeUpdate`, which fire before the
  // validation gate, so `beforeChange` ran ahead of the validation its contract
  // says it follows. One operation still covers create and update: the phase
  // fires on both write paths and `context.operation` says which.
  beforeChange: ["beforeChange"],
  afterChange: ["afterCreate", "afterUpdate"],
  beforeRead: ["beforeRead"],
  afterRead: ["afterRead"],
  beforeDelete: ["beforeDelete"],
  afterDelete: ["afterDelete"],
};

/**
 * The declaration keys whose handlers take a document. `beforeOperation` is
 * excluded because it takes the operation's args instead, which is why it is
 * registered through its own method rather than through this mapping.
 */
type DataPhaseKey = Exclude<keyof CollectionHooks, "beforeOperation">;

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
 * - `beforeChange` → `beforeChange` (runs after the validation gate)
 * - `afterChange` → `afterCreate` and `afterUpdate`
 * - `beforeValidate` → `beforeCreate` and `beforeUpdate` (runs before the gate)
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
  collections: HookedCollection[],
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

    // Driven by the mapping's own order, not the config object's. Two phases
    // can map onto the same queue -- `beforeValidate` and `beforeChange` both
    // become `beforeCreate`/`beforeUpdate` -- so the order they are registered
    // in IS their runtime order. Iterating the author's object would make that
    // depend on which key they happened to type first, and a collection
    // declaring `beforeChange` above `beforeValidate` would run its validation
    // transformation after the write hook that expects it. The mapping is
    // declared in the documented execution order, so following it keeps the
    // two in step.
    // `beforeOperation` runs first, and registers through its own method: its
    // handlers take the operation's args rather than a document, so they are
    // not interchangeable with the phases below.
    const beforeOperationHandlers = collection.hooks.beforeOperation;
    if (beforeOperationHandlers?.length) {
      for (const handler of beforeOperationHandlers) {
        // Claimed as the config's, which is what makes a reload entitled to
        // replace it: this registrar reads the config, so it can rebuild
        // whatever it removes. Registrations that arrive any other way cannot
        // be rebuilt and keep the registry's own default.
        registry.registerBeforeOperation(collection.slug, handler, "code");
        collectionHookCount++;
      }

      collectionDetails.hooks.push({
        type: "beforeOperation",
        count: beforeOperationHandlers.length,
      });
    }

    for (const hookKey of Object.keys(HOOK_TYPE_MAPPINGS) as DataPhaseKey[]) {
      const handlers = collection.hooks[hookKey];
      if (!handlers || !Array.isArray(handlers) || handlers.length === 0) {
        continue;
      }

      const hookTypes = HOOK_TYPE_MAPPINGS[hookKey];

      // Register handlers for each mapped hook type
      for (const hookType of hookTypes) {
        for (const handler of handlers) {
          registry.register(hookType, collection.slug, handler, "code");
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
  collections: HookedCollection[],
  registry: HookRegistry = getHookRegistry()
): RegisterCollectionHooksResult {
  const result: RegisterCollectionHooksResult = {
    collections: [],
    totalHooks: 0,
    details: [],
  };

  for (const collection of collections) {
    const { set, count, details } = collectionHookSet(collection);

    // Replaced rather than cleared-and-re-added, so the config's handlers stay
    // at the position they held. Only the config's own are touched: a plugin
    // registers directly into a collection's namespace and an imperative
    // `registerHook` call is not in the config, so neither can be rebuilt here
    // and clearing the namespace would delete them for good.
    registry.replaceCollectionOwnedBy(collection.slug, "code", set);

    if (count > 0) {
      result.collections.push(collection.slug);
      result.totalHooks += count;
      result.details.push({ collection: collection.slug, hooks: details });
    }
  }

  return result;
}

/**
 * Map one collection's declarations onto the phases the registry stores them
 * under, without touching the registry.
 *
 * Shared by the appending registration and the replacing one so the two cannot
 * disagree about which declaration becomes which phase.
 */
function collectionHookSet(collection: HookedCollection): {
  set: OwnedHookSet;
  count: number;
  details: { type: string; count: number }[];
} {
  const set: OwnedHookSet = { byPhase: [], beforeOperation: [] };
  const details: { type: string; count: number }[] = [];
  let count = 0;

  if (!collection.hooks) return { set, count, details };

  // `beforeOperation` first, and kept apart: its handlers take the operation's
  // args rather than a document, so they are not interchangeable with the rest.
  const beforeOperationHandlers = collection.hooks.beforeOperation;
  if (beforeOperationHandlers?.length) {
    set.beforeOperation.push(...beforeOperationHandlers);
    count += beforeOperationHandlers.length;
    details.push({
      type: "beforeOperation",
      count: beforeOperationHandlers.length,
    });
  }

  // Driven by the mapping's own order, not the config object's, for the reason
  // given on HOOK_TYPE_MAPPINGS: two declarations can map onto one queue, so
  // the order they are added in IS their runtime order.
  for (const hookKey of Object.keys(HOOK_TYPE_MAPPINGS) as DataPhaseKey[]) {
    const handlers = collection.hooks[hookKey];
    if (!handlers || !Array.isArray(handlers) || handlers.length === 0)
      continue;

    for (const hookType of HOOK_TYPE_MAPPINGS[hookKey]) {
      const existing = set.byPhase.find(entry => entry.hookType === hookType);
      if (existing) existing.handlers.push(...handlers);
      else set.byPhase.push({ hookType, handlers: [...handlers] });
      count += handlers.length;
    }

    details.push({ type: hookKey, count: handlers.length });
  }

  return { set, count, details };
}
