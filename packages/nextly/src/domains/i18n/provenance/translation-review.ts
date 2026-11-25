/**
 * What one translated field was made from, and marking it reviewed against its source as that is
 * now, read and written through the records themselves: no document, version or draft is written.
 *
 * Who may ask is the caller's to decide (`pipeline/source-review`).
 *
 * @experimental Until per-field provenance is complete.
 *
 * @module domains/i18n/provenance/translation-review
 */
import type {
  WhereClause,
  WhereCondition,
} from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../../errors";
import {
  SOURCE_FINGERPRINT_MOVED,
  TRANSLATION_PROVENANCE_TABLE,
  type ProvenanceOrigin,
  type ProvenancePartState,
} from "../../../schemas/translation-provenance";
import { isBlank } from "../blank-value";

import {
  keepSources,
  keptSource,
  pruneSources,
  unrecordedSources,
  type SourceDocument,
  type SourceTextDb,
  type WriteSources,
} from "./source-text";
import { recordUnknownOrigin } from "./unknown-origin";

/** One translated field of a document, and the languages it is judged between. */
export interface TranslatedField {
  document: SourceDocument;
  /** The translation's language. */
  locale: string;
  /** The site's default language: the source of a value whose record names none. */
  defaultLocale: string;
  fieldPath: string;
}

/** A transaction, as far as a review writes through it. */
export interface ReviewDb extends SourceTextDb {
  updateCount(
    table: string,
    data: Record<string, unknown>,
    where: WhereClause
  ): Promise<number>;
}

/** One field's record, live or held. */
export interface FieldRecord {
  id: string;
  partState: ProvenancePartState;
  origin: ProvenanceOrigin;
  valueFingerprint: string;
  sourceLocale: string | null;
  sourceFingerprint: string | null;
}

/** Why what a translation was made from cannot be shown. */
export type SourceUnavailable =
  /** The value has no record, or one that names no source: made before origins were recorded. */
  | "unknown-origin"
  /** Its source was changing as it was made, so which version it was made from is not known. */
  | "source-moved"
  /** It was written in its own language, and made from none. */
  | "original"
  /** The language it was made from is no longer one of the site's. */
  | "source-language-removed"
  /** The version it was made from is known, and its text was not kept. */
  | "not-kept";

/** What a translated field was made from, as its record and the kept text say. */
export type FieldSource =
  | { available: true; sourceLocale: string; before: unknown }
  | {
      available: false;
      reason: SourceUnavailable;
      /** The language it is held to; absent for a value written originally. */
      sourceLocale?: string;
    };

/** One field's rows of a document, in `locale` and, where given, one part. */
function fieldWhere(
  field: Pick<TranslatedField, "document" | "fieldPath">,
  locale: string,
  partState?: ProvenancePartState
): { and: WhereCondition[] } {
  const { scopeKind, scopeSlug, entryId } = field.document;
  return {
    and: [
      { column: "scopeKind", op: "=", value: scopeKind },
      { column: "scopeSlug", op: "=", value: scopeSlug },
      { column: "entryId", op: "=", value: entryId },
      { column: "locale", op: "=", value: locale },
      { column: "fieldPath", op: "=", value: field.fieldPath },
      ...(partState === undefined
        ? []
        : [{ column: "partState", op: "=" as const, value: partState }]),
    ],
  };
}

/** A field's records: its held draft's and its live one, whichever there are. */
export async function fieldRecords(
  db: Pick<SourceTextDb, "select">,
  field: TranslatedField
): Promise<{ draft?: FieldRecord; live?: FieldRecord }> {
  const rows = await db.select<FieldRecord>(TRANSLATION_PROVENANCE_TABLE, {
    columns: [
      "id",
      "partState",
      "origin",
      "valueFingerprint",
      "sourceLocale",
      "sourceFingerprint",
    ],
    where: fieldWhere(field, field.locale),
  });
  return {
    draft: rows.find(row => row.partState === "draft"),
    live: rows.find(row => row.partState === "live"),
  };
}

/**
 * The records of the value a person is shown, its own first: the held draft's where they are shown
 * that, and the live one's, which is the only one where they are shown the live value.
 */
export function shownRecords(
  records: { draft?: FieldRecord; live?: FieldRecord },
  heldDraft: boolean
): FieldRecord[] {
  return [heldDraft ? records.draft : undefined, records.live].filter(
    record => record !== undefined
  );
}

/** The fingerprint of a field's live value in `locale`, as its record there says. */
export async function liveFingerprint(
  db: Pick<SourceTextDb, "select">,
  field: TranslatedField,
  locale: string
): Promise<string | undefined> {
  const [row] = await db.select<{ valueFingerprint: string }>(
    TRANSLATION_PROVENANCE_TABLE,
    {
      columns: ["valueFingerprint"],
      where: fieldWhere(field, locale, "live"),
    }
  );
  return row?.valueFingerprint;
}

/**
 * What the value `record` describes was made from. The text is looked for only where `kept` says
 * the table that holds it is there.
 */
export async function fieldSource(
  db: Pick<SourceTextDb, "select">,
  field: TranslatedField,
  record: FieldRecord | undefined,
  kept: boolean
): Promise<FieldSource> {
  if (record?.origin === "original") {
    return { available: false, reason: "original" };
  }
  const sourceLocale = record?.sourceLocale ?? field.defaultLocale;
  const fingerprint = record?.sourceFingerprint ?? null;
  if (fingerprint === null) {
    return { available: false, reason: "unknown-origin", sourceLocale };
  }
  if (fingerprint === SOURCE_FINGERPRINT_MOVED) {
    return { available: false, reason: "source-moved", sourceLocale };
  }
  const source = kept
    ? await keptSource(db, field.document, field.fieldPath, {
        sourceLocale,
        fingerprint,
      })
    : undefined;
  return source === undefined
    ? { available: false, reason: "not-kept", sourceLocale }
    : { available: true, sourceLocale, before: source.value };
}

/** A review of one field, as the person was shown it. */
export interface FieldReview extends TranslatedField {
  /** Whether the value shown was the held draft's, where there is one. */
  heldDraft: boolean;
  /** The language whose value the person was found to read; none for a value with no source. */
  sourceLocale: string | undefined;
  /** The translation shown. */
  valueFingerprint: string;
  /** The source shown beside it. */
  sourceFingerprint: string;
}

/** A refusal of a review whose translation or source is no longer what was shown. */
function moved(what: "translation" | "source", review: FieldReview): never {
  throw NextlyError.conflict({
    reason: "state",
    message:
      what === "translation"
        ? "This translation has changed since it was shown. Reload it and review it again."
        : "The source has changed since it was shown. Reload it and review the translation again.",
    logContext: {
      reason: `reviewed-${what}-moved`,
      ...review.document,
      locale: review.locale,
      fieldPath: review.fieldPath,
    },
  });
}

/** A refusal of a review of a value that is no translation of anything. */
function nothingToReview(code: string, message: string): never {
  throw NextlyError.validation({ errors: [{ path: "field", code, message }] });
}

/**
 * Marks a field's translation as right against its source as that is now, on `db`, one
 * transaction: the record names the source's present version, and keeps its origin, its engine,
 * who wrote it and the fingerprint of its value. The text is not written, so nothing a reader sees
 * changes, and no version, draft or review moves.
 *
 * The value marked is the one the person was shown: the held draft's where they were shown that, and
 * the live one too where the draft holds the same value. Where they differ, the live value stays as
 * it was until the draft is published. A value with no record is given one, of unknown origin.
 */
export async function reviewField(
  db: ReviewDb,
  review: FieldReview,
  sources: WriteSources,
  now: Date
): Promise<void> {
  const records = shownRecords(
    await fieldRecords(db, review),
    review.heldDraft
  );
  const shown = records.at(0);
  if (shown?.origin === "original") {
    nothingToReview(
      "TRANSLATION_HAS_NO_SOURCE",
      "This value was written in its own language, so it has no source to review it against."
    );
  }
  const stored =
    shown === undefined
      ? (await sources.read(review.locale)).get(review.fieldPath)
      : undefined;
  if (shown === undefined && (stored === undefined || isBlank(stored.value))) {
    nothingToReview(
      "TRANSLATION_IS_EMPTY",
      "This field has no translation to review."
    );
  }
  if (
    (shown?.valueFingerprint ?? stored?.fingerprint) !== review.valueFingerprint
  ) {
    moved("translation", review);
  }
  const sourceLocale = shown?.sourceLocale ?? review.defaultLocale;
  // Made from another language since the person was found to read this one.
  if (sourceLocale !== review.sourceLocale) moved("translation", review);
  const source = await recordedSource(db, review, sourceLocale, sources, now);
  if (source !== review.sourceFingerprint) moved("source", review);

  if (shown === undefined) {
    await recordUnknownOrigin(
      db,
      review.document,
      {
        locale: review.locale,
        fieldPath: review.fieldPath,
        valueFingerprint: review.valueFingerprint,
        sourceLocale,
        sourceFingerprint: source,
      },
      now
    );
  }
  for (const record of records) {
    // A live value written originally has no source, though a draft holds the same text.
    if (record.origin === "original") continue;
    if (record.valueFingerprint !== review.valueFingerprint) continue;
    await moveSource(db, review, record, { sourceLocale, source });
  }
  if (!sources.kept) return;
  await keepSources(
    sources,
    review.document,
    new Map([[review.fieldPath, { sourceLocale, fingerprint: source }]]),
    now
  );
  await pruneSources(db, review.document, [review.fieldPath]);
}

/**
 * The fingerprint of the source's live value, recorded as of unknown origin first where no record
 * says it. Refused where the source holds no value to review against.
 */
async function recordedSource(
  db: ReviewDb,
  review: FieldReview,
  sourceLocale: string,
  sources: WriteSources,
  now: Date
): Promise<string> {
  const recorded = await liveFingerprint(db, review, sourceLocale);
  if (recorded !== undefined) return recorded;
  const found = (
    await unrecordedSources(
      sources,
      new Map([[review.fieldPath, sourceLocale]])
    )
  )
    .get(sourceLocale)
    ?.get(review.fieldPath);
  if (found === undefined) {
    nothingToReview(
      "TRANSLATION_SOURCE_IS_EMPTY",
      "The source language has no value for this field to review the translation against."
    );
  }
  await recordUnknownOrigin(
    db,
    review.document,
    {
      locale: sourceLocale,
      fieldPath: review.fieldPath,
      valueFingerprint: found,
      sourceLocale: null,
      sourceFingerprint: null,
    },
    now
  );
  return found;
}

/**
 * Points `record` at the source's present version, refused where the record has moved since it was
 * read. One that names it already is left: MySQL counts only rows a statement changes, so writing
 * the same values again would read as a record that had moved.
 */
async function moveSource(
  db: ReviewDb,
  review: FieldReview,
  record: FieldRecord,
  to: { sourceLocale: string; source: string }
): Promise<void> {
  if (
    record.sourceFingerprint === to.source &&
    record.sourceLocale === to.sourceLocale
  ) {
    return;
  }
  const changed = await db.updateCount(
    TRANSLATION_PROVENANCE_TABLE,
    { sourceLocale: to.sourceLocale, sourceFingerprint: to.source },
    {
      and: [
        { column: "id", op: "=", value: record.id },
        {
          column: "valueFingerprint",
          op: "=",
          value: record.valueFingerprint,
        },
        record.sourceFingerprint === null
          ? { column: "sourceFingerprint", op: "IS NULL" }
          : {
              column: "sourceFingerprint",
              op: "=",
              value: record.sourceFingerprint,
            },
      ],
    }
  );
  if (changed !== 1) moved("translation", review);
}
