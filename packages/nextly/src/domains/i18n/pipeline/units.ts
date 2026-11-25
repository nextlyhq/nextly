/**
 * A document's units of translation work, read as the caller, and the check that a save's named
 * source is one the text may be translated from. Both ask one reading of the document, so what a
 * page offers and what a save refuses cannot come to disagree.
 *
 * @experimental
 *
 * @module domains/i18n/pipeline/units
 */

import { isDeepStrictEqual } from "node:util";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import { getService } from "../../../di";
import { NextlyError } from "../../../errors";
import { DOCUMENT_PROVENANCE_KEY } from "../../../lib/system-columns";
import { TRANSLATION_PROVENANCE_TABLE } from "../../../schemas/translation-provenance";
import type { Logger } from "../../../shared/types";
import type { SanitizedLocalizationConfig } from "../config/types";
import { appLocalization } from "../configured-locales";
import type { ProvenanceClaims } from "../provenance/provenance-claims";
import { translationProvenancePresent } from "../provenance/record-provenance";
import { valueFingerprint } from "../provenance/value-fingerprint";
import { withComponentShapesOf } from "../runtime/component-shapes";

import {
  documentIdOf,
  editablePaths,
  readDocumentIn,
  type DocumentCaller,
  type FieldPath,
  type TranslatedDocument,
} from "./document-access";
import type { TranslatableFields } from "./document-texts";
import {
  documentUnits,
  readableTexts,
  unitSourceRefusal,
  type ReadDocument,
  type TranslationUnit,
  type UnitLanguages,
} from "./document-units";
import type { SourceRefusal } from "./source-eligibility";
import {
  readSettled,
  registeredEntity,
  translationLanguage,
  translationTableOf,
} from "./source-review";
import {
  translationSuggestionsPresent,
  type SuggestedDocument,
} from "./suggestion-rows";
import { openSuggestions, type OpenSuggestion } from "./suggestion-store";
import {
  fieldUnit,
  unitField,
  unitKey,
  unitProvenancePath,
  type UnitAddress,
} from "./unit-address";
import { unitValueIn, unitWithheld, withUnitValue } from "./unit-value";

/** One document, read as the caller, in the language its units are written in. */
export interface UnitsReading {
  adapter: DrizzleAdapter;
  logger: Logger;
  localization: SanitizedLocalizationConfig;
  languages: UnitLanguages;
  /** The document as its rows elsewhere name it. */
  stored: SuggestedDocument;
  /** The table its own row is in. */
  mainTable: string;
  document: ReadDocument;
}

/** The refusal of a document the caller is told nothing of. */
export function documentNotFound(
  document: TranslatedDocument,
  locale: string
): NextlyError {
  return NextlyError.notFound({
    logContext: {
      reason: "translated-document-not-found",
      kind: document.kind,
      slug: document.slug,
      locale,
    },
  });
}

/** The fields an entity translates, each container's shape read with its components' fields. */
async function translatableFields(
  adapter: DrizzleAdapter,
  record: NonNullable<Awaited<ReturnType<typeof registeredEntity>>>
): Promise<TranslatableFields | undefined> {
  const companion = await withComponentShapesOf(
    await translationTableOf(adapter, record)
  );
  if (!companion) return undefined;
  const refs = companion.localizedFields;
  return {
    names: refs.map(ref => ref.name),
    shapes: new Map(
      refs.flatMap(ref =>
        ref.sharedStructure ? [[ref.name, ref.sharedStructure] as const] : []
      )
    ),
  };
}

/**
 * The document in the language named, as the caller may know it. Read before anything else is asked
 * of it: one they may not read answers not found, whether or not it is translated.
 */
export async function readUnits(
  document: TranslatedDocument,
  caller: DocumentCaller,
  locale: string
): Promise<UnitsReading> {
  const localization = appLocalization();
  const target = translationLanguage(localization, locale);
  const written = await readDocumentIn(document, caller, target, {
    draft: true,
  });
  const live = await readDocumentIn(document, caller, target, {
    everyLanguage: true,
  });
  const record = await registeredEntity(document);
  const entryId = await documentIdOf(document);
  if (!localization || !record || !written || !live || entryId === null) {
    throw documentNotFound(document, target);
  }
  const adapter = getService("adapter");
  const fields = await translatableFields(adapter, record);
  if (fields === undefined) {
    throw NextlyError.validation({
      errors: [
        {
          path: "document",
          code: "NOT_TRANSLATED",
          message: "This document is not translated.",
        },
      ],
    });
  }
  return {
    adapter,
    logger: getService("logger"),
    localization,
    languages: {
      configured: localization.locales.map(language => language.code),
      defaultLocale: localization.defaultLocale,
      target,
    },
    stored: { scopeKind: document.kind, scopeSlug: document.slug, entryId },
    mainTable: record.tableName,
    document: { fields, hasStatus: record.status === true, written, live },
  };
}

/** What each refusal of a source says. */
const REFUSED_SOURCE: Record<SourceRefusal, string> = {
  "is-target": "A text can't be translated from the language it is written in.",
  "not-configured": "The source must be one of the site's languages.",
  // Told as one with no text, so asking never tells a hidden language apart.
  "not-readable": "The source has no text of its own here.",
  "not-published": "The source isn't published.",
  "no-own-value": "The source has no text of its own here.",
  "out-of-date": "The source is not known to be up to date.",
};

/** Why a text can't have been made from `locale` for this caller, whatever the text there is now. */
export function unknownSource(
  { document, languages }: UnitsReading,
  address: UnitAddress,
  locale: string
): string | null {
  const refusal = unitSourceRefusal(document, languages, address, locale);
  return refusal === "is-target" ||
    refusal === "not-configured" ||
    refusal === "not-readable"
    ? REFUSED_SOURCE[refusal]
    : null;
}

/** The open suggestions the caller may read: in the target, and in the language each is made from. */
export async function readableSuggestions(
  reading: UnitsReading
): Promise<Map<string, OpenSuggestion>> {
  const { adapter, logger, stored, languages, document } = reading;
  if (!(await translationSuggestionsPresent(adapter, logger))) return new Map();
  const open = await openSuggestions(adapter, stored, languages.target);
  // A source that has since been unpublished, emptied or changed is still one
  // the caller may read, and the suggestion made from it still stands.
  return new Map(
    [...open].filter(
      ([, { address, sourceLocale }]) =>
        !unitWithheld(document.written, address) &&
        unknownSource(reading, address, sourceLocale) === null
    )
  );
}

/** What is recorded of one value. */
interface RecordedValue {
  locale: string;
  partState: string;
  fieldPath: string;
  valueFingerprint: string;
  sourceLocale: string | null;
  sourceFingerprint: string | null;
}

/** What is recorded of the document's values, in every language, live and held. */
async function recordedValues(
  document: TranslatedDocument
): Promise<RecordedValue[]> {
  const adapter = getService("adapter");
  const entryId = await documentIdOf(document);
  if (
    entryId === null ||
    !(await translationProvenancePresent(adapter, getService("logger")))
  ) {
    return [];
  }
  return adapter.select<RecordedValue>(TRANSLATION_PROVENANCE_TABLE, {
    columns: [
      "locale",
      "partState",
      "fieldPath",
      "valueFingerprint",
      "sourceLocale",
      "sourceFingerprint",
    ],
    where: {
      and: [
        { column: "scopeKind", op: "=", value: document.kind },
        { column: "scopeSlug", op: "=", value: document.slug },
        { column: "entryId", op: "=", value: entryId },
      ],
    },
  });
}

/** The records of `before` and `after` that are not the same in both. */
function movedValues(
  before: readonly RecordedValue[],
  after: readonly RecordedValue[]
): RecordedValue[] {
  const byPlace = (rows: readonly RecordedValue[]) =>
    new Map(
      rows.map(row => [`${row.partState}:${row.locale}:${row.fieldPath}`, row])
    );
  const [then, now] = [byPlace(before), byPlace(after)];
  return [...new Map([...then, ...now])]
    .filter(([place]) => !isDeepStrictEqual(then.get(place), now.get(place)))
    .map(([, row]) => row);
}

/** Holds the document's row for a change, then asks again whether the caller may make it. */
export async function holdForChange(
  { mainTable, stored }: UnitsReading,
  tx: TransactionContext,
  assertStillEditable: (tx: TransactionContext) => Promise<void>
): Promise<void> {
  await tx.lockRow(mainTable, stored.entryId);
  await assertStillEditable(tx);
}

/** An address as a field rule's path; a block's text is no field of the document. */
export function pathOf(address: UnitAddress): FieldPath {
  return address.flatMap(segment => ("node" in segment ? [] : [segment]));
}

/** The units whose text the caller may change, by key. */
async function editableUnits(
  document: TranslatedDocument,
  caller: DocumentCaller,
  { document: read, languages }: UnitsReading
): Promise<Set<string>> {
  const addresses = readableTexts(read);
  const texts = addresses.map(address => ({
    key: unitKey(address),
    path: pathOf(address),
  }));
  const fields = new Set(addresses.map(unitField));
  let body = Object.fromEntries(
    Object.entries(read.written).filter(([name]) => fields.has(name))
  );
  // A text nothing holds yet, as in a group never written in, is put in as a
  // save of it would be: a rule is asked of what is there.
  for (const address of addresses) {
    if (unitValueIn(body, address).found) continue;
    const filled = withUnitValue(body, address, null);
    if (filled) body = { ...body, [filled.field]: filled.value };
  }
  const editable = new Set(
    await editablePaths(
      document,
      caller,
      languages.target,
      body,
      texts.map(text => text.path)
    )
  );
  return new Set(
    texts.filter(text => editable.has(text.path)).map(text => text.key)
  );
}

/** The units of a document in one language. */
export interface DocumentUnits {
  locale: string;
  units: TranslationUnit[];
}

/**
 * The document's units in `locale`: each text the caller may read, and beside it what they may do
 * with it.
 */
export async function translationUnits(
  document: TranslatedDocument,
  caller: DocumentCaller,
  named: { locale: string }
): Promise<DocumentUnits> {
  const { reading, recorded, moved } = await readSettled(async () => {
    const before = await recordedValues(document);
    const reading = await readUnits(document, caller, named.locale);
    const recorded = await recordedValues(document);
    const moved = movedValues(before, recorded);
    return { reading, recorded, moved, settled: moved.length === 0 };
  });
  const fingerprints = new Map(
    recorded
      .filter(row => row.partState === "live")
      .map(row => [`${row.locale}:${row.fieldPath}`, row.valueFingerprint])
  );
  return {
    locale: reading.languages.target,
    units: documentUnits(reading.document, reading.languages, {
      editable: await editableUnits(document, caller, reading),
      suggestions: await readableSuggestions(reading),
      fingerprintOf: (locale, address, value) =>
        fingerprints.get(`${locale}:${unitProvenancePath(address)}`) ??
        valueFingerprint(value),
      settled: (address, locale) => {
        // A text with no record of its own is judged by its field's.
        const paths = [unitProvenancePath(address), unitField(address)];
        return !moved.some(
          row =>
            paths.includes(row.fieldPath) &&
            (locale === undefined || row.locale === locale)
        );
      },
    }),
  };
}

/**
 * Refuses a save that says a field was translated from a language it may not be: one that is not
 * published, has no text of its own there, is not known to be up to date, or that the caller may
 * not read.
 */
export async function assertTranslatedSources(
  document: TranslatedDocument,
  caller: DocumentCaller,
  locale: string,
  claims: ProvenanceClaims
): Promise<void> {
  const translated = Object.entries(claims).flatMap(([field, claim]) =>
    claim.origin === "translated" ? [{ field, from: claim.sourceLocale }] : []
  );
  if (translated.length === 0) return;
  const { document: read, languages } = await readUnits(
    document,
    caller,
    locale
  );
  // A claim names a field, or one text inside it by its path.
  const texts = new Map(
    readableTexts(read).map(address => [unitProvenancePath(address), address])
  );
  const errors = translated.flatMap(({ field, from }) => {
    const address = texts.get(field) ?? fieldUnit(field);
    const refusal = unitSourceRefusal(read, languages, address, from);
    return refusal === null
      ? []
      : [
          {
            path: `${DOCUMENT_PROVENANCE_KEY}.${field}.sourceLocale`,
            code: "PROVENANCE_SOURCE_NOT_ELIGIBLE",
            message: REFUSED_SOURCE[refusal],
          },
        ];
  });
  if (errors.length > 0) throw NextlyError.validation({ errors });
}
