/**
 * Whether one language of a document is live: whether its readers are served
 * it.
 *
 * A document keeps its lifecycle on the main row, and an entity with status
 * per language keeps one more on each translation's companion row. The two can
 * differ: a translation can be withdrawn while the main row stays published,
 * and the default language's own translation can be a draft under a live main
 * row (per-language status added to content that already existed). So the
 * answer is never one column read alone, and every place that asks it asks
 * here, with the statuses it has read.
 *
 * A status counts as live when the workflow calls it public, asked through
 * `isPublicState`, the one predicate the public read's filter is built from.
 *
 * @module domains/i18n/runtime/language-lifecycle
 */

import {
  isPublicState,
  type ContentWorkflow,
} from "../../../lib/content-states";

/** The statuses one language's answer is decided from. */
export interface LanguageStatuses {
  /** The main row's status. */
  mainStatus: unknown;
  /**
   * The language's own translation status, or null when it has none: no
   * companion row, or an entity without status per language.
   */
  ownStatus: string | null;
  /**
   * The language being asked about, or null for the part of a document with
   * no language.
   */
  locale: string | null;
  /** The configured default language, or null without localization. */
  defaultLocale: string | null;
  /** Whether the entity keeps a status per language on its companion rows. */
  perLanguageStatus: boolean;
  /** The workflow whose public states count as live; the default one if omitted. */
  workflow?: ContentWorkflow;
  /**
   * A due release publishes the document before it is written: the main row
   * then counts as live whatever it stores. A language's own status still
   * decides, as it does for the public read, which widens only the main row.
   */
  mainRevealed?: boolean;
}

/**
 * Whether the language is live.
 *
 * - No language, or an entity without status per language: the main row
 *   decides.
 * - The default language: the main row must be live, and its own translation
 *   too where it has a status.
 * - Any other language: the main row must be live, since it gates whether the
 *   document is served at all, and the language's own translation status
 *   too; one with no translation row has nothing of its own live.
 */
export function languageIsLive(statuses: LanguageStatuses): boolean {
  const isLive = (status: unknown): boolean =>
    typeof status === "string" && isPublicState(status, statuses.workflow);
  const mainLive =
    statuses.mainRevealed === true || isLive(statuses.mainStatus);
  if (statuses.locale === null || !statuses.perLanguageStatus) return mainLive;
  if (statuses.locale === statuses.defaultLocale) {
    return (
      mainLive && (statuses.ownStatus === null || isLive(statuses.ownStatus))
    );
  }
  return mainLive && isLive(statuses.ownStatus);
}
