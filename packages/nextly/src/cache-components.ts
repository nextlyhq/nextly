/**
 * Nextly and Next.js Cache Components.
 *
 * Nextly runs with Cache Components and Partial Prefetching on, and supports
 * only that state: `create-nextly-app` turns both on in every app it makes or
 * joins. Cached reads then go through a `"use cache"` function of the app's
 * own (`runtime/cache/registered-read`), with Nextly's cache handlers in
 * `next.config`, as the caching guide describes. Under Cache Components a read
 * that finds no such function registered is said once, at that read.
 *
 * An app with either option off is warned once at start, where the setting
 * can be read. `createRegister()` is told `cacheComponents` by the app's
 * `instrumentation.ts`, which Next.js compiles. `partialPrefetching` reaches
 * no code at run time, so only `withNextly()`, which receives the config
 * itself, can check it.
 *
 * Next.js 17 turns Cache Components on everywhere and removes the option.
 *
 * @module cache-components
 */

import { consoleLogger } from "./shared/types";

/** Where the settings an app needs, and why, are written up. */
const CACHE_COMPONENTS_DOCS_URL =
  "https://nextlyhq.com/docs/getting-started/installation#cache-components";

/**
 * Whether a value says Cache Components is on: the config's own `true`, or
 * the string `"true"` Next.js inlines for it into code it bundles.
 */
export function cacheComponentsEnabled(value: unknown): boolean {
  return value === true || value === "true";
}

/** The two Next.js options Nextly supports only on, in the order they are named. */
const OPTIONS = ["cacheComponents", "partialPrefetching"] as const;

type CacheComponentsOption = (typeof OPTIONS)[number];

/**
 * What a start-up check knows about the app's options. An option left out is
 * one the caller cannot see, so it is not checked; one given as `undefined`
 * is unset, and Next.js's default for both is off.
 */
export type CacheComponentsSettings = Partial<
  Record<CacheComponentsOption, unknown>
>;

/** The options `settings` gives that are not on, in a fixed order. */
export function cacheComponentsOptionsOff(
  settings: CacheComponentsSettings
): CacheComponentsOption[] {
  return OPTIONS.filter(
    option => option in settings && !cacheComponentsEnabled(settings[option])
  );
}

/** The warning for the options found off. `where` names what was read. */
export function cacheComponentsOffWarning(
  off: readonly CacheComponentsOption[],
  where: string
): string {
  const named = off.map(option => `\`${option}\``).join(" and ");
  return (
    `[Nextly] ${named} ${off.length === 1 ? "is" : "are"} off in ${where}. ` +
    "Nextly supports only Cache Components and Partial Prefetching on: set " +
    "`cacheComponents: true` and `partialPrefetching: true` in next.config, " +
    `with Nextly's cache handlers. What to set, and why: ${CACHE_COMPONENTS_DOCS_URL}`
  );
}

/**
 * The options already warned about in this process, kept on `globalThis` so
 * every copy of this module shares it.
 */
const WARNED = Symbol.for("nextly/cache-components-off-warned");

function warnedOptions(): Set<CacheComponentsOption> {
  const holder = globalThis as unknown as Record<
    symbol,
    Set<CacheComponentsOption>
  >;
  holder[WARNED] ??= new Set();
  return holder[WARNED];
}

/**
 * Warns once per process for each option `settings` shows off. Next.js loads
 * the config and runs `register()` more than once in some processes, and the
 * developer needs the line once, not on every load.
 */
export function warnIfCacheComponentsOff(
  settings: CacheComponentsSettings,
  where: string
): void {
  const warned = warnedOptions();
  const off = cacheComponentsOptionsOff(settings).filter(
    option => !warned.has(option)
  );
  if (off.length === 0) return;
  for (const option of off) warned.add(option);
  consoleLogger.warn(cacheComponentsOffWarning(off, where));
}
