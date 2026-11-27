/**
 * Which languages a field can be translated from: those whose own value for
 * the field is published and known to be up to date, never the language being
 * written. Text nobody has published, or whose own source moved on, is not a
 * text to translate from.
 *
 * Pure, and one field at a time, because one document can have Spanish ready in
 * its title and behind in its body.
 *
 * @module components/features/translations/page/source-eligibility
 */

import { languageChipFacts } from "@admin/components/features/entries/EntryList/language-chips";
import {
  isFieldTranslated,
  type LocaleTranslationMeta,
} from "@admin/components/features/entries/translation-meta";

import type { ValuesPerLanguage } from "./translation-fields";

/** What is known of the document's languages. */
export interface SourceFacts {
  /** The site's languages, in its own order. */
  locales: readonly { code: string }[];
  defaultLocale: string;
  /** The language being written. */
  target: string;
  values: ValuesPerLanguage;
  /**
   * Each language's standing, or undefined where the reader may not read it.
   * Then only the default language is offered, by the document's own status.
   */
  translations: Readonly<Record<string, LocaleTranslationMeta>> | undefined;
  /** Whether the document has a draft and a published state at all. */
  hasStatus: boolean;
  /** The document's own status: the default language's. */
  status: string | undefined;
}

/** Whether what `code` stores is what its readers are served. */
function isPublished(code: string, facts: SourceFacts): boolean {
  const status = facts.hasStatus ? facts.status : undefined;
  const meta = facts.translations?.[code];
  // The list's chips judge a language live by the same rule the server serves
  // it by: the document's own status and the language's, both published.
  if (meta !== undefined) return languageChipFacts(meta, status).live;
  // With no draft state, everything stored is public.
  return (
    !facts.hasStatus || (code === facts.defaultLocale && status === "published")
  );
}

/**
 * Whether the value of `field` in `code` is known to be up to date with what it
 * was made from. The default language's is the source itself. Any other has to
 * be recorded so: one whose age was never recorded may be behind, and is not a
 * text to translate from.
 */
function isUpToDate(field: string, code: string, facts: SourceFacts): boolean {
  if (code === facts.defaultLocale) return true;
  return facts.translations?.[code]?.fields?.[field]?.outOfDate === false;
}

/** The languages `field` can be translated from, in the site's order. */
export function eligibleSources(field: string, facts: SourceFacts): string[] {
  const values = facts.values[field];
  if (values === undefined) return [];
  return facts.locales
    .map(locale => locale.code)
    .filter(
      code =>
        code !== facts.target &&
        isFieldTranslated(values[code]) &&
        isPublished(code, facts) &&
        isUpToDate(field, code, facts)
    );
}

/**
 * The source a field shows: the one asked for, else the default language, else
 * the first there is. Undefined where the field has none, and is written as
 * original content.
 */
export function shownSource(
  eligible: readonly string[],
  asked: string | undefined,
  defaultLocale: string
): string | undefined {
  if (asked !== undefined && eligible.includes(asked)) return asked;
  return eligible.includes(defaultLocale) ? defaultLocale : eligible[0];
}
