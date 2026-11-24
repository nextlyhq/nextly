/**
 * What a language's readers are shown for the fields it leaves empty, once it
 * is published: the first language it falls back to that is published with a
 * value, as the server resolves a read. A unique field is never filled from
 * another language.
 *
 * @module components/features/translations/page/reader-preview
 */

import type { LocaleTranslationMeta } from "@admin/components/features/entries/translation-meta";

import { languageStanding } from "./language-standing";
import type { TranslationField, ValuesPerLanguage } from "./translation-fields";

/** The site's languages and how a read of one falls back to others. */
export interface FallbackRules {
  locales: readonly { code: string; fallbackLocale: readonly string[] }[];
  defaultLocale: string;
  /** Whether reads fall back at all. */
  fallback: boolean;
}

/** One field the language leaves empty, and what its readers get instead. */
export interface EmptyField {
  name: string;
  label: string;
  /**
   * The language shown in its place; null where nothing is; undefined where
   * what another language holds can't be known, so it may be shown.
   */
  shows: string | null | undefined;
}

/** Empty as a read judges it: a value of spaces is still a value. */
function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

/**
 * The languages a read of `code` resolves through after itself: its own
 * fallbacks, depth first, then the default language and its.
 */
export function fallbackChain(code: string, rules: FallbackRules): string[] {
  if (!rules.fallback) return [];
  const byCode = new Map(rules.locales.map(locale => [locale.code, locale]));
  const chain: string[] = [];
  const visit = (next: string): void => {
    if (chain.includes(next)) return;
    chain.push(next);
    for (const fallback of byCode.get(next)?.fallbackLocale ?? []) {
      visit(fallback);
    }
  };
  visit(code);
  visit(rules.defaultLocale);
  return chain.slice(1);
}

function isUnique(field: TranslationField["field"]): boolean {
  return "unique" in field && field.unique === true;
}

/** The language shown for one empty field, as {@link EmptyField} says it. */
function shownInstead(
  row: TranslationField,
  chain: readonly string[],
  values: ValuesPerLanguage,
  translations: Readonly<Record<string, LocaleTranslationMeta>> | undefined
): string | null | undefined {
  if (isUnique(row.field)) return null;
  for (const code of chain) {
    // The document as it stands once the language is published, which
    // publishes its shared part too where that wasn't.
    const standing =
      translations?.[code] === undefined
        ? undefined
        : languageStanding(translations, code, "published").published;
    if (standing === false) continue;
    const held = values[row.name] ?? {};
    // A language the reader may not read is left out of the values, which says
    // nothing of what it holds.
    if (!Object.hasOwn(held, code)) return undefined;
    if (isBlank(held[code])) continue;
    return standing === undefined ? undefined : code;
  }
  return null;
}

/**
 * Whether the language leaves `row` empty. A checkbox or a list with no value
 * of its own is drawn as off or as an empty list, so what is stored says it.
 */
function isEmpty(
  row: TranslationField,
  shown: Readonly<Record<string, unknown>>,
  stored: Readonly<Record<string, unknown>>
): boolean {
  const value = shown[row.name];
  if (isBlank(value)) return true;
  const drawnEmpty =
    value === false || (Array.isArray(value) && value.length === 0);
  return drawnEmpty && isBlank(stored[row.name]);
}

/** Each field the language leaves empty, in the page's order. */
export function emptyFields(args: {
  rows: readonly TranslationField[];
  /** Containers holding text per language, which are not written here. */
  nested: readonly TranslationField[];
  /** The language's own values as the form shows them. */
  shown: Readonly<Record<string, unknown>>;
  /** The language's own values as they were read. */
  stored: Readonly<Record<string, unknown>>;
  /** Every language's stored values, no draft of one among them. */
  values: ValuesPerLanguage;
  translations: Readonly<Record<string, LocaleTranslationMeta>> | undefined;
  target: string;
  rules: FallbackRules;
}): EmptyField[] {
  const chain = fallbackChain(args.target, args.rules);
  return [
    ...args.rows.filter(row => isEmpty(row, args.shown, args.stored)),
    ...args.nested.filter(row => isBlank(args.stored[row.name])),
  ].map(row => ({
    name: row.name,
    label: row.label,
    shows: shownInstead(row, chain, args.values, args.translations),
  }));
}
