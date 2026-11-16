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

import {
  getNextlyLogger,
  nextlyLoggerInstalled,
  onNextlyLoggerInstalled,
} from "./observability/logger";

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
    // The cache handlers are a separate cause, with a warning of their own
    // (`cache-handlers-not-shared`), so this line names only these options.
    `${named} ${off.length === 1 ? "is" : "are"} off in ${where}. ` +
    "Nextly supports only Cache Components and Partial Prefetching on: set " +
    "`cacheComponents: true` and `partialPrefetching: true` in next.config. " +
    `What to set, and why: ${CACHE_COMPONENTS_DOCS_URL}`
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
 * Says `message` unless every option in `options` was already said in this
 * process. Through nextly's logger, under `kind`, as its other warnings are, so
 * an app's own logger receives it and a line can be told apart by its cause.
 */
function warnOnceFor(
  options: readonly CacheComponentsOption[],
  kind: string,
  message: (fresh: CacheComponentsOption[]) => string,
  now = false
): void {
  const warned = warnedOptions();
  const fresh = options.filter(option => !warned.has(option));
  if (fresh.length === 0) return;
  for (const option of fresh) warned.add(option);
  const warning = { kind, message: message(fresh) };
  // Before an app has installed a logger of its own, the line waits for it,
  // unless `now` says this is the moment any such logger would be in place.
  if (now || nextlyLoggerInstalled()) {
    // In order: what waited is older than this.
    flushQueuedCacheComponentsWarnings();
    getNextlyLogger().warn(warning);
    return;
  }
  holdForLogger(warning);
}

/** How long a line said before any app logger waits for one, at most. */
export const QUEUED_WARNING_WAIT_MS = 10_000;

interface Warning {
  kind: string;
  message: string;
}

/**
 * Lines said while Next.js loads the config, before `instrumentation.ts` can
 * install an app's logger, and what sends them on. On `globalThis`, as
 * `WARNED` is, so every copy of this module shares them.
 */
const QUEUED = Symbol.for("nextly/cache-components-queued-warnings");

interface Queue {
  warnings: Warning[];
  timer?: ReturnType<typeof setTimeout>;
  /** Whether the logger and exit hooks are in place, once per process. */
  hooked: boolean;
}

function queue(): Queue {
  const holder = globalThis as unknown as Record<symbol, Queue>;
  holder[QUEUED] ??= { warnings: [], hooked: false };
  return holder[QUEUED];
}

/**
 * Sends the lines waiting for a logger to the one in place now: an app's, once
 * it installed one, or the default. Nothing is said twice.
 */
export function flushQueuedCacheComponentsWarnings(): void {
  const waiting = queue();
  if (waiting.timer !== undefined) clearTimeout(waiting.timer);
  waiting.timer = undefined;
  for (const warning of waiting.warnings.splice(0)) {
    getNextlyLogger().warn(warning);
  }
}

/**
 * Keeps `warning` until a logger can take it. It goes out when an app installs
 * a logger, when `register()` runs, after {@link QUEUED_WARNING_WAIT_MS}, or as
 * the process exits, whichever is first: a `next build` or a worker that only
 * loads the config never runs `instrumentation.ts`, and must still say it.
 */
function holdForLogger(warning: Warning): void {
  const waiting = queue();
  waiting.warnings.push(warning);
  if (!waiting.hooked) {
    waiting.hooked = true;
    onNextlyLoggerInstalled(flushQueuedCacheComponentsWarnings);
    if (typeof process !== "undefined" && typeof process.once === "function") {
      process.once("exit", flushQueuedCacheComponentsWarnings);
    }
  }
  if (waiting.timer === undefined) {
    waiting.timer = setTimeout(
      flushQueuedCacheComponentsWarnings,
      QUEUED_WARNING_WAIT_MS
    );
    // The wait must not keep a process alive that has nothing else to do.
    waiting.timer.unref?.();
  }
}

/**
 * Warns once per process for each option `settings` shows off. Next.js loads
 * the config and runs `register()` more than once in some processes, and the
 * developer needs the line once, not on every load.
 */
export function warnIfCacheComponentsOff(
  settings: CacheComponentsSettings,
  where: string,
  now = false
): void {
  warnOnceFor(
    cacheComponentsOptionsOff(settings),
    "cache-components-off",
    off => cacheComponentsOffWarning(off, where),
    now
  );
}

/**
 * The start-time check for the value an app's `instrumentation.ts` passes
 * `createRegister()`. A hook that passes none leaves Nextly unable to tell
 * whether Cache Components is on, which it says as such rather than calling
 * the option off.
 */
export function warnIfRegisteredWithCacheComponentsOff(value: unknown): void {
  // `register()` runs after `instrumentation.ts` has installed any logger of
  // the app's, so what waited for one goes out now, and so does this.
  flushQueuedCacheComponentsWarnings();
  if (value !== undefined) {
    warnIfCacheComponentsOff(
      { cacheComponents: value },
      "this app's build, as its instrumentation.ts passes it to createRegister()",
      true
    );
    return;
  }
  warnOnceFor(
    ["cacheComponents"],
    "cache-components-unknown",
    () =>
      "createRegister() was not passed the app's `cacheComponents` value, so Nextly cannot tell whether Cache Components is on. " +
      "Pass `{ cacheComponents: process.env.__NEXT_CACHE_COMPONENTS }` to it from instrumentation.ts. " +
      `Nextly supports only Cache Components and Partial Prefetching on: ${CACHE_COMPONENTS_DOCS_URL}`,
    true
  );
}
