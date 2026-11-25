/**
 * Which languages one text may be translated from.
 *
 * A language qualifies when what its readers see of the text is its own, is published, and has not
 * fallen behind the text it was itself made from: a translation is never made from a draft, from
 * text another language lends it, or from text already known to be old.
 *
 * Pure: what is asked of the database and of the caller's rights is answered before this is, so
 * the list a page is given and the check a save makes cannot come to disagree.
 *
 * @experimental
 *
 * @module domains/i18n/pipeline/source-eligibility
 */

import { isBlank } from "../blank-value";
import type { FieldProvenance } from "../provenance/field-status";

/** One text in one language, as the caller may know of it. */
export interface SourceText {
  /** Whether the caller may read the text in the language. */
  readable: boolean;
  /**
   * Whether readers are shown the language: its own status where languages are published apart,
   * else the document's. True where the document has no such status at all.
   */
  published: boolean;
  /** The language's own live value, with nothing filled in from another. */
  value: unknown;
  /** Where that value came from; undefined where that was never recorded. */
  provenance: Pick<FieldProvenance, "outOfDate"> | undefined;
}

/** Why a language can't be the source of a text. */
export type SourceRefusal =
  | "is-target"
  | "not-configured"
  | "not-readable"
  | "not-published"
  | "no-own-value"
  | "out-of-date";

export interface SourceQuestion {
  /** The site's languages, in its order. */
  languages: readonly string[];
  defaultLocale: string;
  /** The language the text is written in. */
  target: string;
  /** The text in one language. */
  textIn: (locale: string) => SourceText;
}

/**
 * Whether the text is old, or not known not to be. The default language is what every other is made
 * from, so its text follows none and is never old, and a site from before ages were recorded still
 * has a source. Any other language's is taken only where its record says it is up to date.
 */
function mayBeOld(
  locale: string,
  defaultLocale: string,
  provenance: SourceText["provenance"]
): boolean {
  return locale !== defaultLocale && provenance?.outOfDate !== false;
}

/** Why `locale` can't be the source of the text, or `null` where it can. */
export function sourceRefusal(
  { languages, defaultLocale, target, textIn }: SourceQuestion,
  locale: string
): SourceRefusal | null {
  if (locale === target) return "is-target";
  if (!languages.includes(locale)) return "not-configured";
  const text = textIn(locale);
  // Asked first of the language's text, so nothing else about it is told to a
  // caller who may not read it.
  if (!text.readable) return "not-readable";
  if (!text.published) return "not-published";
  if (isBlank(text.value)) return "no-own-value";
  return mayBeOld(locale, defaultLocale, text.provenance)
    ? "out-of-date"
    : null;
}

/** The languages the text may be translated from, in the site's order. */
export function qualifyingSources(question: SourceQuestion): string[] {
  return question.languages.filter(
    locale => sourceRefusal(question, locale) === null
  );
}
