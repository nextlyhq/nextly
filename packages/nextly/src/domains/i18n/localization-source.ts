/**
 * What a service is handed to know the site's languages: the configured block itself, or the
 * language registry, which answers with the list as it is now.
 *
 * A service keeps the source and reads `localizationNow(source)` where it used to read its
 * stored block, so a language added in Settings reaches services built before it was added,
 * without building them again. A plain block still works, which is what tests and code-only
 * callers hand over.
 *
 * @module domains/i18n/localization-source
 */
import type { SanitizedLocalizationConfig } from "./config/types";

/** Something that knows the site's languages as they are now. */
export interface LiveLocalization {
  current(): SanitizedLocalizationConfig | undefined;
  /**
   * The languages kept, inactive, with their content after they were removed: none where the
   * source cannot say.
   */
  retained?(): readonly string[];
}

export type LocalizationSource =
  | SanitizedLocalizationConfig
  | LiveLocalization
  | undefined;

/** Whether a source answers with the languages as they are now, rather than being them. */
export function isLiveLocalization(
  source: LocalizationSource
): source is LiveLocalization {
  return source !== undefined && "current" in source;
}

/** The languages a source describes now. */
export function localizationNow(
  source: LocalizationSource
): SanitizedLocalizationConfig | undefined {
  return isLiveLocalization(source) ? source.current() : source;
}

/**
 * Every language whose content the database keeps: the active ones, then any removed in Settings
 * and kept inactive. For a reader that has to see every translation stored, whichever languages a
 * request may use today.
 */
export function storedLanguageCodes(source: LocalizationSource): string[] {
  const active = localizationNow(source)?.locales.map(l => l.code) ?? [];
  const retained = isLiveLocalization(source)
    ? (source.retained?.() ?? [])
    : [];
  return [...new Set([...active, ...retained])];
}
