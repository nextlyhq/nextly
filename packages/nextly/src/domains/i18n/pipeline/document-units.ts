/**
 * A document's units of translation work in one language: each translatable text the caller may
 * read, as it stands, whether they may change it, the languages it may be translated from with the
 * text each holds, and the suggestion open for it.
 *
 * Pure: what it is built from was read as the caller, so it holds nothing they may not read, and
 * a language withheld from them is no source of theirs.
 *
 * @experimental
 *
 * @module domains/i18n/pipeline/document-units
 */

import { isPlainObject } from "../../../shared/lib/plain-copy";
import {
  TRANSLATION_OVERVIEW_KEY,
  type LocaleTranslationMeta,
} from "../companion-join";
import type { FieldProvenance } from "../provenance/field-status";
import { ALL_LOCALES_KEY } from "../read-in-language";

import { readTexts, type TranslatableFields } from "./document-texts";
import {
  qualifyingSources,
  sourceRefusal,
  type SourceQuestion,
  type SourceRefusal,
  type SourceText,
} from "./source-eligibility";
import type { OpenSuggestion } from "./suggestion-store";
import {
  unitField,
  unitKey,
  unitProvenancePath,
  type UnitAddress,
} from "./unit-address";
import { unitValueIn, unitWithheld } from "./unit-value";

/** A document as a read answers it. */
type DocumentRow = Readonly<Record<string, unknown>>;

/** The languages a document is translated between. */
export interface UnitLanguages {
  /** The site's languages, in its order. */
  configured: readonly string[];
  defaultLocale: string;
  /** The language the units are written in. */
  target: string;
}

/** A document, read as the caller, with what its units are judged by. */
export interface ReadDocument {
  fields: TranslatableFields;
  /** Whether the collection or Single has a Draft / Published lifecycle. */
  hasStatus: boolean;
  /** Read in the target language, its held draft where the caller may see it. */
  written: DocumentRow;
  /** Read live, with every language's own values and standing beside it. */
  live: DocumentRow;
}

/** The text of a unit in a language it may be translated from. */
export interface UnitSource {
  locale: string;
  value: unknown;
  /** The fingerprint a translation made from it names, to be told out of date by. */
  fingerprint: string;
}

/** One unit. */
export interface TranslationUnit {
  address: UnitAddress;
  /** The address as one key, which a suggestion for the unit is kept under. */
  key: string;
  /** The address as the path a save's claim about the text names it by. */
  path: string;
  value: unknown;
  canEdit: boolean;
  /** Where the language's published text came from; absent where that was never recorded. */
  origin?: FieldProvenance["origin"];
  /** Whether that text is older than its source; absent where it can't be told. */
  outOfDate?: boolean;
  /**
   * The languages it may be translated from, in the site's order, with the text each holds. Absent
   * where one was saved at each reading of it, so which there are is not known: not none.
   */
  sources?: UnitSource[];
  suggestion: OpenSuggestion | null;
}

/** A plain object's own value, or undefined. */
function own(value: unknown, key: string): unknown {
  return isPlainObject(value) && Object.hasOwn(value, key)
    ? value[key]
    : undefined;
}

/** A language's standing in the document, where the caller may read it. */
function standingOf(
  live: DocumentRow,
  locale: string
): LocaleTranslationMeta | undefined {
  const meta = own(own(live, TRANSLATION_OVERVIEW_KEY), locale);
  return isPlainObject(meta)
    ? (meta as unknown as LocaleTranslationMeta)
    : undefined;
}

/**
 * Whether readers are shown the language: the document's own status and the language's, both
 * published, as a public read asks. A language with no status of its own has the document's, and
 * a document with no such status is always shown.
 */
function shownToReaders(
  { hasStatus, live }: ReadDocument,
  locale: string,
  defaultLocale: string
): boolean {
  if (!hasStatus) return true;
  if (live.status !== "published") return false;
  const standing = standingOf(live, locale);
  // Its standing withheld, only the language the document's status is of is known.
  if (standing === undefined) return locale === defaultLocale;
  return (standing.status ?? "published") === "published";
}

/** Where a text's value in one language came from: the text's own record, else its field's. */
function provenanceOf(
  live: DocumentRow,
  locale: string,
  address: UnitAddress
): Partial<Pick<FieldProvenance, "origin" | "outOfDate">> | undefined {
  const field = own(standingOf(live, locale)?.fields, unitField(address));
  const recorded =
    own(own(field, "texts"), unitProvenancePath(address)) ?? field;
  return isPlainObject(recorded) ? recorded : undefined;
}

/** A text's own live value in one language: nothing where the caller may not read it. */
function liveText(
  live: DocumentRow,
  locale: string,
  address: UnitAddress
): { readable: boolean; value: unknown } {
  const field = unitField(address);
  const values = own(own(live, ALL_LOCALES_KEY), field);
  if (!isPlainObject(values) || !Object.hasOwn(values, locale)) {
    return { readable: false, value: undefined };
  }
  const held = { [field]: values[locale] };
  if (unitWithheld(held, address)) return { readable: false, value: undefined };
  const at = unitValueIn(held, address);
  // A row the language's live value lacks has no text there; the language is
  // readable all the same.
  return { readable: true, value: at.found ? at.value : undefined };
}

/** The question of one text's sources, as this caller may know them. */
function questionOf(
  document: ReadDocument,
  { configured, defaultLocale, target }: UnitLanguages,
  address: UnitAddress
): SourceQuestion {
  return {
    languages: configured,
    defaultLocale,
    target,
    textIn: (locale): SourceText => ({
      ...liveText(document.live, locale, address),
      published: shownToReaders(document, locale, defaultLocale),
      provenance: provenanceOf(document.live, locale, address),
    }),
  };
}

/** Why `locale` can't be the source of the text at `address`, or `null` where it can. */
export function unitSourceRefusal(
  document: ReadDocument,
  languages: UnitLanguages,
  address: UnitAddress,
  locale: string
): SourceRefusal | null {
  return sourceRefusal(questionOf(document, languages, address), locale);
}

/** The addresses of the document's texts the caller may read in the target language. */
export function readableTexts(document: ReadDocument): UnitAddress[] {
  return readTexts(document.written, document.fields);
}

/** What the caller may do beside reading, and what is open. */
export interface UnitFacts {
  /** The keys of the units the caller may change. */
  editable: ReadonlySet<string>;
  /** The open suggestions the caller may read, by their unit's key. */
  suggestions: ReadonlyMap<string, OpenSuggestion>;
  /** The fingerprint of a text's value in a language. */
  fingerprintOf: (
    locale: string,
    address: UnitAddress,
    value: unknown
  ) => string;
  /**
   * Whether a text was saved by nobody as it was read: in the language named, or in any. What is
   * recorded of one that was may be of another value than the one read.
   */
  settled: (address: UnitAddress, locale?: string) => boolean;
}

/** The document's units, in the order its texts stand in. */
export function documentUnits(
  document: ReadDocument,
  languages: UnitLanguages,
  facts: UnitFacts
): TranslationUnit[] {
  return readableTexts(document).map(address => {
    const key = unitKey(address);
    const written = unitValueIn(document.written, address);
    // Its age is told by its source, so a save of either may have moved it.
    const recorded = facts.settled(address)
      ? provenanceOf(document.live, languages.target, address)
      : undefined;
    return {
      address,
      key,
      path: unitProvenancePath(address),
      value: written.found ? written.value : null,
      canEdit: facts.editable.has(key),
      ...(recorded?.origin === undefined ? {} : { origin: recorded.origin }),
      ...(recorded?.outOfDate === undefined
        ? {}
        : { outOfDate: recorded.outOfDate }),
      ...(sourcesSettled(languages, address, facts)
        ? { sources: sourcesOf(document, languages, address, facts) }
        : {}),
      suggestion: facts.suggestions.get(key) ?? null,
    };
  });
}

/** Whether no language the text may be translated from was saved as it was read. */
function sourcesSettled(
  { configured, target }: UnitLanguages,
  address: UnitAddress,
  { settled }: UnitFacts
): boolean {
  return configured.every(
    locale => locale === target || settled(address, locale)
  );
}

/** The languages the text may be translated from, with the text each holds. */
function sourcesOf(
  document: ReadDocument,
  languages: UnitLanguages,
  address: UnitAddress,
  { fingerprintOf }: UnitFacts
): UnitSource[] {
  return qualifyingSources(questionOf(document, languages, address)).map(
    locale => sourceIn(document.live, locale, address, fingerprintOf)
  );
}

function sourceIn(
  live: DocumentRow,
  locale: string,
  address: UnitAddress,
  fingerprintOf: UnitFacts["fingerprintOf"]
): UnitSource {
  const { value } = liveText(live, locale, address);
  return { locale, value, fingerprint: fingerprintOf(locale, address, value) };
}
