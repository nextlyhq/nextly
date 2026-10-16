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
 * @module domains/i18n/runtime/language-lifecycle
 */

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
}

/**
 * Whether the language is live.
 *
 * - No language, or an entity without status per language: the main row
 *   decides.
 * - The default language: the main row must be live, and its own translation
 *   too where it has a status.
 * - Any other language: its own translation status decides; one with no
 *   translation row has nothing of its own live.
 */
export function languageIsLive(statuses: LanguageStatuses): boolean {
  const mainLive = statuses.mainStatus === "published";
  if (statuses.locale === null || !statuses.perLanguageStatus) return mainLive;
  if (statuses.locale === statuses.defaultLocale) {
    return (
      mainLive &&
      (statuses.ownStatus === null || statuses.ownStatus === "published")
    );
  }
  return statuses.ownStatus === "published";
}
