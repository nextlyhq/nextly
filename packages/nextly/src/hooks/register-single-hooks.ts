/**
 * Register Single Hooks
 *
 * Bridges the declarative `hooks` block of a code-first `defineSingle()` config
 * to the runtime HookRegistry, the twin of {@link registerCollectionHooks} for
 * Singles. Without this the four documented Single hook phases never run: the
 * single services look hooks up under the `single:<slug>` namespace and always
 * find nothing registered.
 *
 * A Single has no create or delete path (it is auto-created and update-only), so
 * `beforeChange`/`afterChange` map to the update registry types only, and there
 * are no validate/delete phases.
 *
 * @module hooks/register-single-hooks
 */

import type { SingleConfig, SingleHooks } from "../singles/config/types";

import { getHookRegistry, type HookRegistry } from "./hook-registry";
import type { HookType, HookHandler } from "./types";

/** Result of registering single hooks. */
export interface RegisterSingleHooksResult {
  /** Single slugs that had hooks registered. */
  singles: string[];
  /** Total number of hooks registered. */
  totalHooks: number;
  /** Breakdown of hooks registered per single. */
  details: {
    single: string;
    hooks: { type: string; count: number }[];
  }[];
}

/**
 * The registry "collection" key a Single's hooks register under. Must match
 * `getSingleHookCollection` in the single query/mutation services, which look
 * hooks up under this same `single:<slug>` namespace. Inlined here rather than
 * imported to keep the hooks module free of a dependency on the singles domain.
 */
function singleHookNamespace(slug: string): string {
  return `single:${slug}`;
}

/**
 * Map Single hook phases to HookRegistry hook types. A Single is update-only, so
 * `beforeChange`/`afterChange` register only the update variants (never create).
 */
const HOOK_TYPE_MAPPINGS: Record<keyof SingleHooks, HookType[]> = {
  beforeRead: ["beforeRead"],
  afterRead: ["afterRead"],
  beforeChange: ["beforeUpdate"],
  afterChange: ["afterUpdate"],
};

/**
 * Register hooks declared on code-first Single configs with the global
 * HookRegistry, so the single read/update paths execute them. Call during app
 * initialization, mirroring {@link registerCollectionHooks}.
 *
 * @param singles - Single configurations from `defineSingle()`
 * @param registry - Optional HookRegistry (defaults to the global registry)
 * @returns Registration statistics
 */
export function registerSingleHooks(
  singles: SingleConfig[],
  registry: HookRegistry = getHookRegistry()
): RegisterSingleHooksResult {
  const result: RegisterSingleHooksResult = {
    singles: [],
    totalHooks: 0,
    details: [],
  };

  for (const single of singles) {
    if (!single.hooks) {
      continue;
    }

    const singleDetails = {
      single: single.slug,
      hooks: [] as { type: string; count: number }[],
    };
    let singleHookCount = 0;

    for (const [hookKey, handlers] of Object.entries(single.hooks)) {
      if (!handlers || !Array.isArray(handlers) || handlers.length === 0) {
        continue;
      }

      const hookTypes = HOOK_TYPE_MAPPINGS[hookKey as keyof SingleHooks];
      if (!hookTypes) {
        continue;
      }

      for (const hookType of hookTypes) {
        for (const handler of handlers) {
          registry.register(
            hookType,
            singleHookNamespace(single.slug),
            handler as HookHandler
          );
          singleHookCount++;
        }
      }

      singleDetails.hooks.push({ type: hookKey, count: handlers.length });
    }

    if (singleHookCount > 0) {
      result.singles.push(single.slug);
      result.totalHooks += singleHookCount;
      result.details.push(singleDetails);
    }
  }

  return result;
}

/**
 * Clear all hooks registered for a Single. The registry keys Single hooks under
 * the `single:<slug>` namespace, so clearing uses that same key.
 *
 * @param slug - The single slug to clear hooks for
 * @param registry - Optional HookRegistry (defaults to the global registry)
 */
export function clearSingleHooks(
  slug: string,
  registry: HookRegistry = getHookRegistry()
): void {
  registry.clearCollection(singleHookNamespace(slug));
}

/**
 * Re-register hooks for Singles: clear the existing ones, then register again.
 * Useful for hot-reload in development.
 *
 * @param singles - Single configurations
 * @param registry - Optional HookRegistry (defaults to the global registry)
 * @returns Registration statistics
 */
export function reregisterSingleHooks(
  singles: SingleConfig[],
  registry: HookRegistry = getHookRegistry()
): RegisterSingleHooksResult {
  for (const single of singles) {
    registry.clearCollection(singleHookNamespace(single.slug));
  }
  return registerSingleHooks(singles, registry);
}
