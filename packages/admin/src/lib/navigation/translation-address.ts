/**
 * Where one document is translated into one language, and what becomes of an
 * address that names a language on the document's editor.
 *
 * The editor edits the site's default language alone; every other language of
 * a document is written on its translation page. The page keeps its target in
 * the same `?locale=` the editor read, because the reader's capabilities and
 * the requests the page makes are judged in the language that key names.
 *
 * Pure, so every form of address is decided here without a router.
 *
 * @module lib/navigation/translation-address
 */

import { buildRoute, ROUTES } from "@admin/constants/routes";
import {
  LOCALE_PARAM,
  SOURCE_PARAM,
  TRANSLATE_PARAM,
} from "@admin/constants/search-params";

/** The document a translation page translates: an entry by its id, or a Single. */
export type TranslatedDocument =
  | { kind: "collection"; slug: string; id: string }
  | { kind: "single"; slug: string };

/** Which languages the page pairs. No source means the default language. */
export interface TranslationPair {
  target: string;
  source?: string;
}

/** The site's languages, as far as an address needs them. */
export interface AddressLanguages {
  locales: readonly { code: string }[];
  defaultLocale: string;
}

/** The address of `document`'s translation page for one pair of languages. */
export function translationAddress(
  document: TranslatedDocument,
  { target, source }: TranslationPair
): string {
  const path =
    document.kind === "collection"
      ? buildRoute(ROUTES.TRANSLATION_ENTRY, {
          slug: document.slug,
          id: document.id,
        })
      : buildRoute(ROUTES.TRANSLATION_SINGLE, { slug: document.slug });
  const query = new URLSearchParams({ [LOCALE_PARAM]: target });
  if (source !== undefined) query.set(SOURCE_PARAM, source);
  return `${path}?${query.toString()}`;
}

/**
 * The source an address asks for, where it is one the page can use: a
 * language the site has, other than the target. Anything else reads as
 * absent, which is the default language, as does the default itself, so one
 * pair has one address.
 */
export function sourceFromAddress(
  requested: string | null,
  target: string,
  { locales, defaultLocale }: AddressLanguages
): string | undefined {
  if (requested === null || requested === target) return undefined;
  if (requested === defaultLocale) return undefined;
  return locales.some(locale => locale.code === requested)
    ? requested
    : undefined;
}

/** Where an editor address naming a language goes. */
export type LanguageAddressMove =
  | { to: "editor" }
  | { to: "translation"; pair: TranslationPair };

/**
 * Where an editor address that names a language goes, the first rule that
 * matches winning:
 *
 * 1. the default language, with or without a source: the editor;
 * 2. another language with a source: its translation page, from that source;
 * 3. another language alone: its translation page, from the default language.
 *
 * `undefined` leaves the address as it is: it names no language, or one the
 * site does not have, which the editor reads as no language at all. A source
 * the site does not have, or the target itself, is no source (rule 3). A
 * repeated key counts by its first value, as the editor reads it.
 */
export function languageAddressMove(
  query: URLSearchParams,
  languages: AddressLanguages
): LanguageAddressMove | undefined {
  const target = query.get(LOCALE_PARAM);
  if (
    target === null ||
    !languages.locales.some(locale => locale.code === target)
  ) {
    return undefined;
  }
  if (target === languages.defaultLocale) return { to: "editor" };
  const source = sourceFromAddress(
    query.get(TRANSLATE_PARAM),
    target,
    languages
  );
  return {
    to: "translation",
    pair: source === undefined ? { target } : { target, source },
  };
}
