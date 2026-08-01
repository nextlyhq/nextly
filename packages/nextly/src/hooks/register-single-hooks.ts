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
 * `afterChange` maps to the update registry type only, and there are no delete
 * phases. `beforeValidate` and `beforeChange` sit either side of the validation
 * gate, as they do for collections.
 *
 * @module hooks/register-single-hooks
 */

import type { SingleHooks } from "../singles/config/types";

import { getHookRegistry, type HookRegistry } from "./hook-registry";
import type { HookContextPhase, HookHandler } from "./types";

/**
 * The part of a single this module reads, the twin of `HookedCollection`.
 *
 * Narrower than `SingleConfig` for the same reason: registration needs a slug
 * and a hooks block, and the config reload holds the loader's sanitized config
 * rather than `defineSingle()` objects. Every `SingleConfig` still satisfies it.
 */
export interface HookedSingle {
  slug: string;
  hooks?: SingleHooks;
}

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
export function singleHookNamespace(slug: string): string {
  return `single:${slug}`;
}

/**
 * Map Single hook phases to HookRegistry hook types. A Single is update-only, so
 * `afterChange` registers only the update variant (never create).
 */
const HOOK_TYPE_MAPPINGS: Record<keyof SingleHooks, HookContextPhase[]> = {
  beforeRead: ["beforeRead"],
  afterRead: ["afterRead"],
  // The pre-validation queue the single write path already executes, which
  // `beforeChange` used to occupy. Mapping the phase that belongs there onto it
  // is what keeps a value-supplying handler possible at all: without it a
  // single would have no hook running before the gate.
  beforeValidate: ["beforeUpdate"],
  // Its own phase rather than `beforeUpdate` -- the same correction the
  // collection registration makes, so a single and a collection agree on when
  // the declaration runs.
  beforeChange: ["beforeChange"],
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
  singles: HookedSingle[],
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

      // `afterChange` maps to `afterUpdate`, which the registry runs as a
      // side-effect phase: a handler's return is discarded there, so the
      // response stays equal to the stored Single without wrapping here.
      for (const hookType of hookTypes) {
        for (const handler of handlers) {
          // Claimed as the config's, the twin of the collection registrar: this
          // reads the config and can rebuild what a reload removes, so it is
          // the one caller entitled to that ownership.
          registry.register(
            hookType,
            singleHookNamespace(single.slug),
            handler as HookHandler,
            "code"
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
  singles: HookedSingle[],
  registry: HookRegistry = getHookRegistry()
): RegisterSingleHooksResult {
  // Only the config's own handlers are replaced. A plugin can register into a
  // single's namespace the same way it can a collection's, and those
  // registrations are not part of the config being reloaded -- clearing the
  // namespace wholesale would delete them with nothing able to put them back.
  // This is the hazard `registerSingleHooks`'s caller avoids by never clearing
  // at all, which trades a wipe for a leak; owning the handlers lets a reload
  // do neither.
  for (const single of singles) {
    registry.clearCollectionOwnedBy(singleHookNamespace(single.slug), "code");
  }
  return registerSingleHooks(singles, registry);
}
