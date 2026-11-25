/**
 * Marking a container reviewed, in the records of the texts inside it: a container whose texts have
 * records of their own is read by those, so one marked right against its source as that is now is
 * marked by them.
 *
 * @experimental Until per-field provenance is complete.
 *
 * @module domains/i18n/provenance/container-review
 */
import { TRANSLATION_PROVENANCE_TABLE } from "../../../schemas/translation-provenance";
import { isTextPath } from "../pipeline/unit-address";

import {
  fieldOfPath,
  keepSources,
  pruneSources,
  type RecordedSource,
  type WriteSources,
} from "./source-text";
import type {
  FieldRecord,
  FieldReview,
  ReviewDb,
  TranslatedField,
} from "./translation-review";

interface TextRecord extends FieldRecord {
  locale: string;
  fieldPath: string;
}

/** The records of the texts inside a container, in the languages named. */
async function textRecords(
  db: Pick<ReviewDb, "select">,
  { document, fieldPath }: Pick<TranslatedField, "document" | "fieldPath">,
  locales: string[]
): Promise<TextRecord[]> {
  const rows = await db.select<TextRecord>(TRANSLATION_PROVENANCE_TABLE, {
    columns: [
      "id",
      "locale",
      "partState",
      "fieldPath",
      "origin",
      "valueFingerprint",
      "sourceLocale",
      "sourceFingerprint",
    ],
    where: {
      and: [
        { column: "scopeKind", op: "=", value: document.scopeKind },
        { column: "scopeSlug", op: "=", value: document.scopeSlug },
        { column: "entryId", op: "=", value: document.entryId },
        { column: "locale", op: "IN", value: locales },
      ],
    },
  });
  return rows.filter(
    row => isTextPath(row.fieldPath) && fieldOfPath(row.fieldPath) === fieldPath
  );
}

/**
 * The records of the texts a review was shown: each text's live one, or its held draft's where it
 * has one and the person was shown that (`heldDraft`); and the other part's where it is of the same
 * value.
 */
function shownTexts(
  records: readonly TextRecord[],
  heldDraft: boolean
): TextRecord[] {
  const shown = new Map<string, string>();
  // The later of the two parts takes the place of the one before it.
  for (const part of heldDraft ? ["live", "draft"] : ["live"]) {
    for (const record of records) {
      if (record.partState === part) {
        shown.set(record.fieldPath, record.valueFingerprint);
      }
    }
  }
  return records.filter(
    record => shown.get(record.fieldPath) === record.valueFingerprint
  );
}

/**
 * Points the record of each text inside a reviewed field at its source's present version, on `db`,
 * the review's own transaction, once `reviewField` marked the field: for a text made from the
 * language the field was shown beside. One made from another, or whose source has no record there,
 * was not shown beside it, and stays as it was. Nothing for a field that is no container.
 */
export async function reviewTexts(
  db: ReviewDb,
  field: Pick<
    FieldReview,
    "document" | "locale" | "fieldPath" | "sourceLocale" | "heldDraft"
  >,
  sources: WriteSources,
  now: Date
): Promise<void> {
  const { sourceLocale } = field;
  // A container written in its own language was shown beside no source.
  if (sourceLocale === undefined) return;
  const records = await textRecords(db, field, [field.locale, sourceLocale]);
  const present = new Map(
    records
      .filter(each => each.locale === sourceLocale && each.partState === "live")
      .map(each => [each.fieldPath, each.valueFingerprint])
  );
  const made = new Map<string, RecordedSource>();
  for (const record of shownTexts(
    records.filter(each => each.locale === field.locale),
    field.heldDraft
  )) {
    const fingerprint = present.get(record.fieldPath);
    if (fingerprint === undefined || record.sourceLocale !== sourceLocale) {
      continue;
    }
    if (record.sourceFingerprint !== fingerprint) {
      await db.updateCount(
        TRANSLATION_PROVENANCE_TABLE,
        { sourceFingerprint: fingerprint },
        { and: [{ column: "id", op: "=", value: record.id }] }
      );
    }
    made.set(record.fieldPath, { sourceLocale, fingerprint });
  }
  if (!sources.kept || made.size === 0) return;
  await keepSources(sources, field.document, made, now);
  await pruneSources(sources, field.document, [...made.keys()]);
}
