/**
 * The localization a site's stored language list describes, when Settings manages the list.
 *
 * Built from the rows of `nextly_languages`: the active languages in their order, the default
 * among them, and each one's fallback list with removed languages skipped. With nothing stored
 * there is no localization at all, exactly as for a site whose configuration declares none, so
 * a site that never adds a language behaves as it did. One stored language is still a
 * localization: content translated while a second language existed stays readable.
 *
 * @module domains/i18n/config/stored-languages
 */
import type { LanguageDirection } from "../../../schemas/languages/types";

import type { ResolvedLocale, SanitizedLocalizationConfig } from "./types";

/** One stored language, as its row holds it. */
export interface StoredLanguage {
  code: string;
  label: string;
  direction: LanguageDirection;
  /** The fallback codes, in order, as the JSON list the row stores. */
  fallback: string;
  position: number;
  isDefault: boolean;
  active: boolean;
}

/** The localization the stored languages describe, or undefined when none are stored. */
export function localizationFromStoredLanguages(
  rows: readonly StoredLanguage[]
): SanitizedLocalizationConfig | undefined {
  const active = rows
    .filter(row => row.active)
    .sort((a, b) => a.position - b.position);
  const defaultRow = active.find(row => row.isDefault) ?? active[0];
  if (!defaultRow) return undefined;
  const live = new Set(active.map(row => row.code));
  return {
    defaultLocale: defaultRow.code,
    fallback: true,
    locales: active.map(
      (row): ResolvedLocale => ({
        code: row.code,
        label: row.label,
        rtl: row.direction === "rtl",
        // A removed language is skipped, so a list that named it falls through to the next.
        fallbackLocale: fallbackCodes(row.fallback).filter(code =>
          live.has(code)
        ),
      })
    ),
  };
}

/** A stored fallback list's codes; a list that is not a JSON list of strings reads as none. */
function fallbackCodes(stored: string): string[] {
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed)
      ? parsed.filter((code): code is string => typeof code === "string")
      : [];
  } catch {
    return [];
  }
}
