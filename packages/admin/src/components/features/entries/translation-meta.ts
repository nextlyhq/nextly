/**
 * translation-meta — the `_translations` map and what can be read off it.
 *
 * The backend attaches this map per document when a read asks for
 * `?translation-status=1`. Several surfaces interpret it — the header's
 * history, the Languages menu, the list's chips — and
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
  /**
   * Whether this language holds a saved change nobody has published.
   *
   * Separate from `status` because it answers a different question: `status`
   * says what the language IS, this says whether something is waiting. Absent
   * rather than false when there is nothing pending, matching the wire shape.
   */
  pendingChange?: boolean;
  /**
   * Whether the SOURCE language was written after this one was.
   *
   * A THIRD independent fact, alongside `status` and `pendingChange`, and kept apart from both
   * for the reason `pendingChange` already gives: a stale translation is still translated, and
   * still published if it was published. Rendering it as a state of its own would take a live
   * language out of "Published" on every screen that shows one, understating what the site
   * serves.
   *
   * Absent rather than false when nothing is known — a translation written before the timestamp
   * existed is UNKNOWN, which is not the same as up to date.
   */
  stale?: boolean;
}

export interface TranslationCounts {
  /** Languages carrying a translation, whatever its publish state. */
  translated: number;
  /** Of those, how many are published. */
  published: number;
  /**
   * Languages that CAN be translated — every configured locale except the
   * default, which is the source rather than a translation of itself. Not the
   * number of languages configured, and not the number of rows a panel draws:
   * a document with three languages has two translations, and a caller reading
   * this as "how many languages exist" is off by one in the reassuring
   * direction.
   */
  total: number;
}

/**
 * How far along the document's translations are.
 *
 * Counted against the CONFIGURED locales rather than the map's own keys: the
 * map can still carry a language that was removed from the config, and
 * counting it would report progress against a denominator that excludes it.
 *
 * Every configured language is counted, the default included: it is one of
 * the languages a reader can be shown, and its status is as real as any
 * other's. Every surface reading this count says the same of a document.
 */
export function translationCounts(
  translations: Record<string, LocaleTranslationMeta> | undefined,
  localeCodes: readonly string[]
): TranslationCounts {
  let translated = 0;
  let published = 0;
  let total = 0;
  for (const code of localeCodes) {
    total += 1;
    const meta = translations?.[code];
    if (!meta?.translated) continue;
    translated += 1;
    if (meta.status === "published") published += 1;
  }
  return { translated, published, total };
}

/**
 * The languages with no content of their own yet, by label, for a "what is
 * missing" hint: over every configured language, as {@link translationCounts}
 * counts them, so the hint and the count beside it always agree.
 */
export function untranslatedLocales(
  translations: Record<string, LocaleTranslationMeta> | undefined,
  locales: readonly { code: string; label: string }[]
): string[] {
  return locales
    .filter(l => !translations?.[l.code]?.translated)
    .map(l => l.label);
}

/** The state a language is in for one document. */
/**
 * Every state a language can be in, ordered as a language moves through them —
 * and the single source both the type and every legend derive from.
 *
 * A tuple rather than a union so the ORDER is part of the vocabulary and a list
 * of the states cannot be maintained by hand somewhere else. A hand-kept list
 * typed `readonly LanguageState[]` only proves the entries it contains are
 * valid; it says nothing about the ones it forgot, so a new state would ship a
 * dot that the legend explaining the dots cannot explain — and any test
 * asserting a hard-coded length stays green while it happens.
 */
export const LANGUAGE_STATES = [
  "published",
  "translated",
  "draft",
  "missing",
] as const;

export type LanguageState = (typeof LANGUAGE_STATES)[number];

export const LANGUAGE_STATE_LABEL: Record<LanguageState, string> = {
  missing: "not translated",
  draft: "draft",
  translated: "translated",
  published: "published",
};

/**
 * Whether ONE field carries a translation.
 *
 * Blank-is-empty, matching what copy-from-language already treats as "present"
 * and what the backend treats as untranslated — a field holding only whitespace
 * has not been translated, and reporting it done would inflate every count that
 * uses this.
 *
 * Deliberately structural rather than a comparison against the source: a
 * translation that legitimately matches its source (a product name, a URL) is
 * still a translation, and flagging it as outstanding would send a translator
 * back to work that is finished.
 */
export function isFieldTranslated(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * How far along ONE language's fields are, for the pair on screen.
 *
 * The document-level {@link translationCounts} answers "how many LANGUAGES",
 * read off the backend's `_translations` map. This answers "how many FIELDS",
 * read off the form's live values — so it moves as the translator types, which
 * the stored map cannot do. Two different questions, deliberately not one
 * function with a mode flag.
 */
export function fieldTranslationCounts(
  fieldNames: readonly string[],
  values: Record<string, unknown> | undefined
): { translated: number; total: number } {
  let translated = 0;
  for (const name of fieldNames) {
    if (isFieldTranslated(values?.[name])) translated += 1;
  }
  return { translated, total: fieldNames.length };
}
