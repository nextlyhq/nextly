/**
 * What Settings › Languages says about a language, and the order a move asks
 * for, decided apart from the components that draw them.
 *
 * @module components/features/settings/languages/language-settings-model
 */

import type { LanguageDirection, LanguageView } from "@admin/types/languages";

/** A language's writing direction, in words. */
export function directionLabel(direction: LanguageDirection): string {
  return direction === "rtl" ? "Right to left" : "Left to right";
}

/** The name of the language `code` names, or the code when the site has no such language. */
export function languageName(
  languages: readonly LanguageView[],
  code: string
): string {
  return languages.find(language => language.code === code)?.label ?? code;
}

/** A fallback list in words: "None", "English" or "Spanish, then English". */
export function fallbackPhrase(
  languages: readonly LanguageView[],
  fallback: readonly string[]
): string {
  if (fallback.length === 0) return "None";
  return fallback.map(code => languageName(languages, code)).join(", then ");
}

/** A count of stored items, in words. */
export function itemsPhrase(count: number): string {
  return `${count} ${count === 1 ? "item" : "items"}`;
}

/**
 * How many items `code` holds, by the server's counts, which leave out a
 * language holding none. Undefined until the counts are read.
 */
export function contentCount(
  counts: Readonly<Record<string, number>> | undefined,
  code: string
): number | undefined {
  return counts === undefined ? undefined : (counts[code] ?? 0);
}

/** The languages in use, in the site's order. */
export function activeLanguages(
  languages: readonly LanguageView[]
): LanguageView[] {
  return languages
    .filter(language => language.active)
    .sort((a, b) => a.position - b.position);
}

/** The removed languages, kept with their content. */
export function removedLanguages(
  languages: readonly LanguageView[]
): LanguageView[] {
  return languages.filter(language => !language.active);
}

/**
 * Every active language's code, in order, with `code` moved one place by
 * `step` (-1 up, +1 down): a reorder names every active language. Undefined
 * when it cannot move that way.
 */
export function movedOrder(
  active: readonly LanguageView[],
  code: string,
  step: -1 | 1
): string[] | undefined {
  const codes = active.map(language => language.code);
  const from = codes.indexOf(code);
  const to = from + step;
  if (from < 0 || to < 0 || to >= codes.length) return undefined;
  codes.splice(from, 1);
  codes.splice(to, 0, code);
  return codes;
}
