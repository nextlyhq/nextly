/**
 * Building the thing that records a localization transition.
 *
 * Every path that can create a companion needs the same two pieces: somewhere to
 * put the record, and the locale to put in it. Neither is interesting on its own
 * and both are easy to get subtly wrong — a store without a locale invites a
 * caller to reach for `defaultLocale` from whatever config is nearest, which is
 * how a transition ends up labelled with a locale that was never in force. So
 * they are resolved together, once, here.
 *
 * Returns undefined when the app names no default locale. An entity cannot be
 * localized without one, so there is no transition to describe, and handing back
 * nothing is more honest than a recorder that would have to invent a language.
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
 * Resolve where a transition gets recorded and with which locale.
 *
 * `logger` is optional because the provisioning paths differ in what they have:
 * the CLI carries a real logger, the dev reload path writes through `console`.
 * Neither matters to the record itself.
 */
/**
 * The store alone, without a locale.
 *
 * Forgetting a transition needs somewhere to delete from and nothing else, and it has to work for
 * an entity whose localization is being turned off — where asking for a default locale would be
 * asking the wrong question, and would fail for an app that no longer configures one.
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
    delete: key => meta.delete(key),
  };
}

export async function resolveTransitionRecorder(
  config: { localization?: { defaultLocale?: string } },
  adapter: MetaCapableAdapter,
  logger: Logger = SILENT_LOGGER
): Promise<TransitionRecorder | undefined> {
  const defaultLocale = config.localization?.defaultLocale;
  if (typeof defaultLocale !== "string" || defaultLocale.length === 0) {
    return undefined;
  }
  // Imported here rather than at module scope: this module is reached from the
  // dev reload path, and the service pulls in the dialect schema tables.
  const store = await resolveTransitionStore(adapter, logger);
  return { defaultLocale, ...store };
}
