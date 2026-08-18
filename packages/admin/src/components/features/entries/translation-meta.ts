/**
 * translation-meta — the `_translations` map and what can be read off it.
 *
 * The backend attaches this map per document when a read asks for
 * `?translation-status=1`. Several surfaces interpret it — the header's
 * language control, the language panel, the list's completeness badge — and
 * each needs the same two things: the shape of an entry, and how many
 * languages are translated.
 *
 * Both live here rather than beside any one of those surfaces, so retiring a
 * surface cannot take the shared derivation with it, and two callers cannot
 * count "how many languages are translated" separately and drift.
 *
 * @module components/features/entries/translation-meta
 */

/** Per-locale translation state, mirroring the backend `_translations` map. */
export interface LocaleTranslationMeta {
  translated: boolean;
  status?: string;
}

export interface TranslationCounts {
  /** Languages carrying a translation, whatever its publish state. */
  translated: number;
  /** Of those, how many are published. */
  published: number;
  /** Languages configured for the app. */
  total: number;
}

/**
 * How far along the document's translations are.
 *
 * Counted against the CONFIGURED locales rather than the map's own keys: the
 * map can still carry a language that was removed from the config, and
 * counting it would report progress against a denominator that excludes it.
 *
 * The default language is EXCLUDED from both sides. It is the source the
 * translations are made from, not one of them — counting it inflates every
 * document by one and reports progress on a document where nothing has been
 * translated at all. `defaultLocale` is required rather than optional so a
 * caller cannot omit it and silently get the inflated answer.
 */
export function translationCounts(
  translations: Record<string, LocaleTranslationMeta> | undefined,
  localeCodes: readonly string[],
  defaultLocale: string
): TranslationCounts {
  let translated = 0;
  let published = 0;
  let total = 0;
  for (const code of localeCodes) {
    if (code === defaultLocale) continue;
    total += 1;
    const meta = translations?.[code];
    if (!meta?.translated) continue;
    translated += 1;
    if (meta.status === "published") published += 1;
  }
  return { translated, published, total };
}

/** The languages still awaiting a translation, by label, for a "what is missing" hint. */
export function untranslatedLocales(
  translations: Record<string, LocaleTranslationMeta> | undefined,
  locales: readonly { code: string; label: string }[],
  defaultLocale: string
): string[] {
  return locales
    .filter(
      l => l.code !== defaultLocale && !translations?.[l.code]?.translated
    )
    .map(l => l.label);
}

/** The state a language is in for one document. */
export type LanguageState = "missing" | "draft" | "translated" | "published";

/**
 * Resolve a locale's state from its translation meta.
 *
 * Lives here rather than beside any one control because four surfaces now read
 * it — the header's language control, the editor's language panel, its menu,
 * and the list's per-language dots — and a second spelling of this rule would
 * let two of them describe the same language differently.
 */
export function languageState(
  meta: LocaleTranslationMeta | undefined
): LanguageState {
  if (!meta || !meta.translated) return "missing";
  if (meta.status === "published") return "published";
  if (meta.status === "draft") return "draft";
  return "translated";
}

export const LANGUAGE_STATE_LABEL: Record<LanguageState, string> = {
  missing: "not translated",
  draft: "draft",
  translated: "translated",
  published: "published",
};
