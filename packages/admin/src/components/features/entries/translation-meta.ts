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
 */
export function translationCounts(
  translations: Record<string, LocaleTranslationMeta> | undefined,
  localeCodes: readonly string[]
): TranslationCounts {
  let translated = 0;
  let published = 0;
  for (const code of localeCodes) {
    const meta = translations?.[code];
    if (!meta?.translated) continue;
    translated += 1;
    if (meta.status === "published") published += 1;
  }
  return { translated, published, total: localeCodes.length };
}
