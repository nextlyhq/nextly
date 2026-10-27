/**
 * Nextly and Next.js Cache Components.
 *
 * Nextly does not support Cache Components yet. Its runtime caches with
 * `unstable_cache` and opts out with `unstable_noStore`, the model Cache
 * Components replaces, and Cache Components refuses every `runtime` route
 * segment export, which routes such as the blog template's Open Graph images
 * carry. Nextly warns where the setting can be read, in `withNextly()` while
 * Next.js loads the config and in `createRegister()` before the server serves
 * a request, rather than refusing: an app with it on is untested, not known to
 * be broken.
 *
 * Next.js 17 turns Cache Components on everywhere and removes the option, so
 * support lands before that release.
 *
 * @module cache-components
 */

import { consoleLogger } from "./shared/types";

/** Where the reason, the fix and the plan are written up for developers. */
export const CACHE_COMPONENTS_DOCS_URL =
  "https://nextlyhq.com/docs/getting-started/installation#cache-components";

/**
 * Whether a value says Cache Components is on: the config's own `true`, or
 * the string `"true"` Next.js inlines for it into code it bundles.
 */
export function cacheComponentsEnabled(value: unknown): boolean {
  return value === true || value === "true";
}

/** The warning an app with Cache Components on gets. `where` names the place it was read. */
export function cacheComponentsWarning(where: string): string {
  return (
    `[Nextly] Cache Components isn't supported by Nextly yet, and ${where} has it on; turn it off. ` +
    "Set `cacheComponents: false` in next.config and remove `partialPrefetching`, " +
    "which Next.js accepts only with Cache Components on. " +
    `Why, and the plan to support it before Next.js 17: ${CACHE_COMPONENTS_DOCS_URL}`
  );
}

/** Warns, once per call, when `value` says Cache Components is on. */
export function warnIfCacheComponentsOn(value: unknown, where: string): void {
  if (cacheComponentsEnabled(value)) {
    consoleLogger.warn(cacheComponentsWarning(where));
  }
}
