/**
 * Whether each translated field is out of date, computed from the recorded provenance, never
 * stored: a field is out of date when its source language's live value no longer has the
 * fingerprint the translation was made from. A value written originally in its language has no
 * source and is never out of date; one with no recorded origin is unknown, and its language is
 * judged by the language-level stamp instead.
 *
 * @experimental Until per-field provenance is complete.
 *
 * @module domains/i18n/provenance/field-status
 */
import {
  TRANSLATION_PROVENANCE_TABLE,
  type ProvenanceOrigin,
  type ProvenanceScopeKind,
} from "../../../schemas/translation-provenance";

import type { ProvenanceDb } from "./record-provenance";

/** Where one field's value in one language came from, and whether its source moved since. */
export interface FieldProvenance {
  origin: ProvenanceOrigin;
  /** The engine of a machine translation. */
  engine?: string;
  /** The language the value was made from; absent for a value written originally. */
  sourceLocale?: string;
  /**
   * Whether the source's value changed after this one was made from it. Absent where that cannot
   * be told: the source has no recorded value, or the origin is unknown.
   */
  outOfDate?: boolean;
}

/** The live provenance rows a read needs, one per document, language and field. */
interface LiveRow {
  entryId: string;
  locale: string;
  fieldPath: string;
  origin: ProvenanceOrigin;
  engine: string | null;
  sourceLocale: string | null;
  sourceFingerprint: string | null;
  valueFingerprint: string;
}

/** The key one document's language is found under in {@link fieldProvenanceOf}'s answer. */
export function documentLanguageKey(entryId: string, locale: string): string {
  return `${entryId}::${locale}`;
}

/**
 * Each document's fields' provenance, by language, for `entryIds` of one collection or Single:
 * one read of the live rows (the unique key's leading columns, so index-backed), every language
 * included, since a source may be any of them.
 */
export async function fieldProvenanceOf(
  db: Pick<ProvenanceDb, "select">,
  scope: { scopeKind: ProvenanceScopeKind; scopeSlug: string },
  entryIds: readonly string[]
): Promise<Map<string, Record<string, FieldProvenance>>> {
  const out = new Map<string, Record<string, FieldProvenance>>();
  if (entryIds.length === 0) return out;
  const rows = await db.select<LiveRow>(TRANSLATION_PROVENANCE_TABLE, {
    columns: [
      "entryId",
      "locale",
      "fieldPath",
      "origin",
      "engine",
      "sourceLocale",
      "sourceFingerprint",
      "valueFingerprint",
    ],
    where: {
      and: [
        { column: "scopeKind", op: "=", value: scope.scopeKind },
        { column: "scopeSlug", op: "=", value: scope.scopeSlug },
        { column: "entryId", op: "IN", value: [...entryIds] },
        { column: "partState", op: "=", value: "live" },
      ],
    },
  });
  // Each value's fingerprint now, by document, language and field: what a source is compared by.
  const current = new Map<string, string>();
  for (const row of rows) {
    current.set(
      `${documentLanguageKey(String(row.entryId), row.locale)}::${row.fieldPath}`,
      row.valueFingerprint
    );
  }
  for (const row of rows) {
    const key = documentLanguageKey(String(row.entryId), row.locale);
    const fields = out.get(key) ?? {};
    fields[row.fieldPath] = fieldStatus(row, current);
    out.set(key, fields);
  }
  return out;
}

/** One field's provenance, and whether its source moved since, as {@link FieldProvenance} says. */
function fieldStatus(
  row: LiveRow,
  current: ReadonlyMap<string, string>
): FieldProvenance {
  const status: FieldProvenance = { origin: row.origin };
  if (row.engine !== null) status.engine = row.engine;
  if (row.origin === "original") return { ...status, outOfDate: false };
  if (row.origin === "unknown" || row.sourceLocale === null) return status;
  status.sourceLocale = row.sourceLocale;
  const source = current.get(
    `${documentLanguageKey(String(row.entryId), row.sourceLocale)}::${row.fieldPath}`
  );
  // A source with no recorded value cannot be compared: unknown, never up to date.
  if (source === undefined || row.sourceFingerprint === null) return status;
  return { ...status, outOfDate: source !== row.sourceFingerprint };
}

/**
 * Whether a language is out of date, from its fields' provenance: out of date when any field is;
 * up to date when every translated field's answer is known and none is; otherwise `undefined`,
 * for the caller to judge by the language-level stamp.
 */
export function languageOutOfDate(
  fields: Readonly<Record<string, FieldProvenance>> | undefined,
  translatedFields: readonly string[]
): boolean | undefined {
  if (fields === undefined) return undefined;
  if (Object.values(fields).some(field => field.outOfDate === true)) {
    return true;
  }
  const known = translatedFields.every(
    name => fields[name]?.outOfDate === false
  );
  return known ? false : undefined;
}
