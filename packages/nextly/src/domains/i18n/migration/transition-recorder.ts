/**
 * Building the thing that records a localization transition.
 *
 * A path that CREATES a companion needs two pieces: somewhere to put the record,
 * and the locale to put in it. Pairing them here is what stops a caller reaching
 * for `defaultLocale` from whatever config is nearest, which is how a transition
 * ends up labelled with a locale that was never in force.
 *
 * The store is available on its own, because reading, forgetting and unwinding a
 * transition need no locale at all — and have to keep working for an app that no
 * longer configures one, which is exactly the app that owes an unwind.
 *
 * @module domains/i18n/migration/transition-recorder
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { Logger } from "../../../services/shared/types";

import type { TransitionStateStore } from "./transition-state";

/**
 * Somewhere to record a transition, together with the locale to record.
 *
 * Kept as one value so the two cannot be sourced separately.
 */
export type TransitionRecorder = TransitionStateStore & {
  /** The locale the main table's existing content is in, at the moment of transition. */
  defaultLocale: string;
};

/**
 * The handle callers must supply. Narrower than what `MetaService` ultimately uses, and
 * deliberately so.
 *
 * `MetaService` extends `BaseService`, which also resolves its dialect through
 * `getCapabilities()`, so the cast below is not cosmetic — it asserts a real adapter, not just an
 * object with this one method. Widening this type to match would mean reproducing
 * `DatabaseCapabilities` (a dozen members) in every duck-typed caller, and the callers that reach
 * here are modules which deliberately avoid depending on the adapter package. The assertion is
 * sound because every caller holds a genuine adapter and is merely viewing it through a narrower
 * local interface; it is kept in this one place rather than repeated at each call site.
 */
type MetaCapableAdapter = Pick<DrizzleAdapter, "getDrizzle">;

/** Swallows everything. `MetaService` logs nothing on the paths used here. */
const SILENT_LOGGER: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

/**
 * Where transitions are recorded, without a locale attached.
 *
 * Reading a record, forgetting one, or unwinding a transition needs somewhere to read and write and
 * nothing else — and all three have to work for an entity whose localization is being turned off,
 * where asking for a default locale would be asking the wrong question and would fail outright for
 * an app that no longer configures one.
 *
 * `logger` is optional because the callers differ in what they have: the CLI carries a real logger,
 * the dev reload path writes through `console`. Neither matters to the record itself.
 */
export async function resolveTransitionStore(
  adapter: MetaCapableAdapter,
  logger: Logger = SILENT_LOGGER
): Promise<TransitionStateStore> {
  const { MetaService } = await import("../../meta/services/meta-service");
  const meta = new MetaService(adapter as DrizzleAdapter, logger);
  return {
    getEntry: key => meta.getEntry(key),
    set: (key, value) => meta.set(key, value),
    insertIfAbsent: (key, value) => meta.insertIfAbsent(key, value),
    delete: key => meta.delete(key),
  };
}

/**
 * Attach the configured default locale to a store that has already been resolved.
 *
 * Split out because the two things a provisioning pass needs are not equally available. Every pass
 * needs somewhere to read and write records; only the passes that CREATE a companion also need a
 * locale. An app that has turned localization off entirely still has transitions to unwind, and
 * requiring a locale to reach the record would hide exactly those entities.
 *
 * Undefined when no default locale is configured — an entity cannot be localized without one, so
 * there is no transition to begin, and handing back nothing is more honest than a recorder that
 * would have to invent a language.
 */
export function bindTransitionRecorder(
  store: TransitionStateStore,
  config: { localization?: { defaultLocale?: string } }
): TransitionRecorder | undefined {
  const defaultLocale = config.localization?.defaultLocale;
  if (typeof defaultLocale !== "string" || defaultLocale.length === 0) {
    return undefined;
  }
  return { defaultLocale, ...store };
}
