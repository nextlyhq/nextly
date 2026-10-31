/**
 * Nextly and Next.js Cache Components.
 *
 * Nextly builds apps with Cache Components off by default. An app can turn it
 * on: its cached reads then go through a `"use cache"` function of the app's
 * own (`runtime/cache/registered-read`), with Nextly's cache handlers in
 * `next.config`, as the caching guide describes. Under Cache Components a read
 * that finds no such function registered is said once, at that read.
 *
 * Next.js 17 turns Cache Components on everywhere and removes the option.
 *
 * @module cache-components
 */

/**
 * Whether a value says Cache Components is on: the config's own `true`, or
 * the string `"true"` Next.js inlines for it into code it bundles.
 */
export function cacheComponentsEnabled(value: unknown): boolean {
  return value === true || value === "true";
}
