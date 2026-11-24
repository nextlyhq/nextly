/**
 * Which translations a publish leaves out of date, read from the document's translation overview
 * (`_translations`): after a publish, the fields that are out of date now and were not before
 * (the notice after a one-click publish), and before one, the fields a publish would leave out
 * of date (the choice of what goes live). Free of React, so both are tested without rendering.
 *
 * A translated field is out of date when the live value of the language it was made from no
 * longer has the fingerprint it was made from; the server works that out per field and reports
 * it in the overview, so publishing a source language is what moves it. A language whose values
 * have no recorded origin is judged by its language-level `stale` instead, and named without a
 * count.
 *
 * @experimental Until publishing per language is complete.
 *
 * @module components/features/entries/publish-parts/out-of-date
 */

import { LOCALE_PARAM, TRANSLATE_PARAM } from "@admin/constants/search-params";

import type { LanguageLabel } from "../publishAllOutcomes";

/** Where one translated value came from, and whether its source moved since, as the overview says. */
export interface FieldOrigin {
  origin?: string;
  /** The language it was made from; absent for a value written originally. */
  sourceLocale?: string;
  /** Absent where it cannot be told. */
  outOfDate?: boolean;
}

/** One language's part of the overview that these questions read. */
export interface OverviewLanguage {
  /** The language-level answer, for a language whose values have no recorded origin. */
  stale?: boolean;
  /** Whether a saved change waits to be published in it. */
  pendingChange?: boolean;
  /** Each field's origin, by field name; absent where none is recorded. */
  fields?: Readonly<Record<string, FieldOrigin>>;
}

/** The document's translation overview, by language code. */
export type TranslationOverview = Readonly<
  Record<string, OverviewLanguage | undefined>
>;

/** A language and how many of its fields are out of date; null where it is not counted by field. */
export interface OutOfDateCount {
  locale: string;
  fields: number | null;
}

/** Whether the overview records an origin for any of `language`'s fields. */
function hasRecordedOrigins(language: OverviewLanguage | undefined): boolean {
  return (
    language?.fields !== undefined && Object.keys(language.fields).length > 0
  );
}

/**
 * The fields out of date after a publish of `published` that were not before it, language by
 * language in the site's order, counting only fields made from a published language. A language
 * with no recorded origins counts when its language-level answer turned stale.
 */
export function newlyOutOfDate(args: {
  languages: readonly string[];
  published: readonly string[];
  before: TranslationOverview | undefined;
  after: TranslationOverview | undefined;
}): OutOfDateCount[] {
  const sources = new Set(args.published);
  const counts: OutOfDateCount[] = [];
  for (const locale of args.languages) {
    const after = args.after?.[locale];
    const before = args.before?.[locale];
    if (!hasRecordedOrigins(after)) {
      if (after?.stale === true && before?.stale !== true) {
        counts.push({ locale, fields: null });
      }
      continue;
    }
    const fields = Object.entries(after?.fields ?? {}).filter(
      ([name, origin]) =>
        origin.outOfDate === true &&
        origin.sourceLocale !== undefined &&
        sources.has(origin.sourceLocale) &&
        before?.fields?.[name]?.outOfDate !== true
    ).length;
    if (fields > 0) counts.push({ locale, fields });
  }
  return counts;
}

/**
 * The fields a publish would leave out of date, language by language in the site's order: those
 * made from a language whose published value of that field the publish changes (`edited`, by
 * source language), and not out of date already.
 */
export function predictOutOfDate(args: {
  languages: readonly string[];
  overview: TranslationOverview | undefined;
  /** For each language being published, the translated fields its publish changes. */
  edited: ReadonlyMap<string, ReadonlySet<string>>;
}): OutOfDateCount[] {
  const counts: OutOfDateCount[] = [];
  for (const locale of args.languages) {
    const fields = Object.entries(args.overview?.[locale]?.fields ?? {}).filter(
      ([name, origin]) =>
        origin.outOfDate !== true &&
        origin.sourceLocale !== undefined &&
        args.edited.get(origin.sourceLocale)?.has(name) === true
    ).length;
    if (fields > 0) counts.push({ locale, fields });
  }
  return counts;
}

/** The counts as words: "2 Spanish fields and the French translation". */
function outOfDateWords(
  counts: readonly OutOfDateCount[],
  labelOf: LanguageLabel
): string {
  const parts = counts.map(({ locale, fields }) =>
    fields === null
      ? `the ${labelOf(locale)} translation`
      : `${fields} ${labelOf(locale)} field${fields === 1 ? "" : "s"}`
  );
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** Whether the counts read as one thing ("is") or several ("are"). */
function isOne(counts: readonly OutOfDateCount[]): boolean {
  return (
    counts.length === 1 && (counts[0].fields === null || counts[0].fields === 1)
  );
}

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The editor's address for translating `target` from `source`. The translation mode's address
 * today; the translation page takes the same address over once it exists.
 */
export function translateAddress(
  editorPath: string,
  target: string,
  source: string
): string {
  const search = new URLSearchParams({
    [LOCALE_PARAM]: target,
    [TRANSLATE_PARAM]: source,
  });
  return `${editorPath}?${search.toString()}`;
}

/** What the notice after a publish says, and where each language is translated. */
export interface OutOfDateNoticeContent {
  text: string;
  languages: { locale: string; label: string; href: string }[];
}

/**
 * The notice after a publish that left translations out of date, or null when it left none. Each
 * language links to translating it from `source`, the language just published.
 */
export function outOfDateNotice(args: {
  counts: readonly OutOfDateCount[];
  labelOf: LanguageLabel;
  editorPath: string;
  source: string;
}): OutOfDateNoticeContent | null {
  if (args.counts.length === 0) return null;
  const words = sentenceCase(outOfDateWords(args.counts, args.labelOf));
  return {
    text: `Published. ${words} ${isOne(args.counts) ? "is" : "are"} now out of date.`,
    languages: args.counts.map(({ locale }) => ({
      locale,
      label: args.labelOf(locale),
      href: translateAddress(args.editorPath, locale, args.source),
    })),
  };
}

/** The line the choice of what goes live gives for what its publish would leave out of date. */
export function outOfDateForecast(
  counts: readonly OutOfDateCount[],
  labelOf: LanguageLabel
): string | null {
  if (counts.length === 0) return null;
  return `After this, ${outOfDateWords(counts, labelOf)} will be out of date.`;
}
