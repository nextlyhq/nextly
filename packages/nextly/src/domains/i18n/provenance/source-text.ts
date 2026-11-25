/**
 * The source text each translation was made from, kept beside its provenance.
 *
 * Provenance says which language a translated value was made from and the fingerprint of that
 * language's value then, which tells whether the source has changed but never what changed. Here
 * the source's value itself is kept, one row per version of one field's source text, for as long
 * as a translation made from it is recorded: every translation made from that version, in any
 * language, live or held as a draft, shares the row.
 *
 * A source is kept only where it is provably the one the translation records: its value, read on
 * the write's own transaction, has the fingerprint recorded with the translation. A value that
 * does not read back as it was written (a date on a database keeping whole seconds) is left out,
 * so what is kept can be missing and is never the wrong text.
 *
 * A repeater's or group's text is each language's overlay of one structure, so its source is no
 * one column's value and is not kept.
 *
 * @experimental Until per-field provenance is complete.
 *
 * @module domains/i18n/provenance/source-text
 */
import { randomUUID } from "node:crypto";

import type {
  UpsertOptions,
  WhereClause,
  WhereCondition,
} from "@nextlyhq/adapter-drizzle/types";
import { and, eq } from "drizzle-orm";

import {
  TRANSLATION_PROVENANCE_ROW_SEPARATOR,
  TRANSLATION_PROVENANCE_TABLE,
  type ProvenanceScopeKind,
} from "../../../schemas/translation-provenance";
import {
  TRANSLATION_SOURCES_TABLE,
  type KeptSource,
} from "../../../schemas/translation-sources";
import {
  tablePresence,
  type DashboardLogger,
  type TableProbe,
} from "../../dashboard/table-presence";
import { isBlank } from "../blank-value";
import type { LocalizedFieldRef } from "../companion-join";
import type { CompanionReadiness } from "../runtime/companion-readiness";

import { valueFingerprint, writtenValueOf } from "./value-fingerprint";

/** The surface of a transaction the source text is kept and removed through. */
export interface SourceTextDb {
  select<T = unknown>(
    table: string,
    options?: { where?: WhereClause; columns?: string[] }
  ): Promise<T[]>;
  upsert<T = unknown>(
    table: string,
    data: Record<string, unknown>,
    options: UpsertOptions
  ): Promise<T>;
  delete(table: string, where: WhereClause): Promise<number>;
}

/** One document. */
export interface SourceDocument {
  scopeKind: ProvenanceScopeKind;
  scopeSlug: string;
  entryId: string;
}

/** A field's value as a language's own row stores it. */
export interface StoredSourceValue {
  /** The value as it was written (`writtenValueOf`), an empty one as it is. */
  value: unknown;
  fingerprint: string;
  /**
   * Whether the value reads back as it was written on every database: text and JSON. A number, a
   * boolean, a date or a decimal may not, so its fingerprint says nothing of one recorded from a
   * write.
   */
  readsBack: boolean;
}

/** A language's stored values, by field; see {@link sourceReaderOf}. */
export type SourceReader = (
  locale: string
) => Promise<ReadonlyMap<string, StoredSourceValue>>;

/** What a write needs to keep the source text its translations are made from. */
export interface WriteSources {
  /** The write's own transaction. */
  db: SourceTextDb;
  /** Reads a language's values on that transaction. */
  read: SourceReader;
  /** Whether the table that keeps the text is there ({@link translationSourcesPresent}). */
  kept: boolean;
}

/** The source one translated field's record names: its language, and its value's fingerprint. */
export interface RecordedSource {
  sourceLocale: string;
  fingerprint: string;
}

/**
 * Whether the table exists yet, asked once per database and remembered once found, on the write's
 * own connection, as provenance's is (`translationProvenancePresent`). Until then no source text
 * is kept.
 */
const presenceByDb = new WeakMap<
  TableProbe,
  (via?: TableProbe) => Promise<boolean>
>();

export function translationSourcesPresent(
  db: TableProbe,
  logger?: DashboardLogger,
  via?: TableProbe
): Promise<boolean> {
  let present = presenceByDb.get(db);
  if (present === undefined) {
    present = tablePresence(
      db,
      TRANSLATION_SOURCES_TABLE,
      "The source text translations are made from is not being kept",
      logger
    );
    presenceByDb.set(db, present);
  }
  return present(via);
}

/** A translated field's column, and how its values are stored there. */
export type TranslatedColumn = Pick<
  LocalizedFieldRef,
  "name" | "column" | "json" | "sharedStructure"
>;

/** A Drizzle handle that reads rows, as a transaction's `getDrizzle()` answers it. */
interface SelectsStoredRows {
  select(projection: Record<string, unknown>): {
    from(table: unknown): {
      where(condition: unknown): Promise<Record<string, unknown>[]>;
    };
  };
}

/**
 * Reads a language's own stored values of one document, each language once, through `db`: a
 * transaction's handle, so a source is read as the write sees it. Only a field whose value a
 * translation row stores whole is read: a container's column there holds an overlay of its
 * structure. Empty where the translation table is not there to read.
 */
export function sourceReaderOf(args: {
  db: unknown;
  /** The document's translation table, and the fields it stores. */
  companion: {
    table: unknown;
    localizedFields: readonly TranslatedColumn[];
  };
  readiness: CompanionReadiness | undefined;
  entryId: string | number;
}): SourceReader {
  const table = args.companion.table as Record<string, unknown>;
  const fields = args.companion.localizedFields.filter(
    field =>
      field.sharedStructure === undefined && table[field.column] !== undefined
  );
  const read = async (
    locale: string
  ): Promise<ReadonlyMap<string, StoredSourceValue>> => {
    if (args.readiness !== "ready" || fields.length === 0) return new Map();
    const [row] = await (args.db as SelectsStoredRows)
      .select(
        Object.fromEntries(
          fields.map(field => [field.column, table[field.column]])
        )
      )
      .from(args.companion.table)
      .where(
        and(
          eq(table._parent as never, args.entryId),
          eq(table._locale as never, locale)
        )
      );
    if (row === undefined) return new Map();
    return new Map(
      fields.map(field => [
        field.name,
        storedSourceValue(
          row[field.column],
          field.json === true,
          table[field.column]
        ),
      ])
    );
  };
  const byLocale = new Map<
    string,
    Promise<ReadonlyMap<string, StoredSourceValue>>
  >();
  return locale => {
    let values = byLocale.get(locale);
    if (values === undefined) {
      values = read(locale);
      byLocale.set(locale, values);
    }
    return values;
  };
}

/** One column's value as {@link StoredSourceValue} says. */
function storedSourceValue(
  stored: unknown,
  json: boolean,
  column: unknown
): StoredSourceValue {
  const value = writtenValueOf(stored ?? null, json);
  return {
    value,
    fingerprint: valueFingerprint(value, json),
    readsBack: json || storesText(column),
  };
}

/** Whether a Drizzle column stores text: a decimal is `string numeric`, and a date names its own. */
function storesText(column: unknown): boolean {
  return (
    typeof column === "object" &&
    column !== null &&
    (column as { dataType?: unknown }).dataType === "string"
  );
}

/** A document's rows, of `fields` where they are given. */
function documentWhere(
  document: SourceDocument,
  fields?: readonly string[]
): { and: WhereCondition[] } {
  return {
    and: [
      { column: "scopeKind", op: "=", value: document.scopeKind },
      { column: "scopeSlug", op: "=", value: document.scopeSlug },
      { column: "entryId", op: "=", value: document.entryId },
      ...(fields === undefined
        ? []
        : [{ column: "fieldPath", op: "IN" as const, value: [...fields] }]),
    ],
  };
}

/** What names one version of one field's source text within a document. */
function versionKey(version: {
  sourceLocale: string | null;
  fieldPath: string;
  fingerprint: string | null;
}): string {
  return JSON.stringify([
    version.sourceLocale,
    version.fieldPath,
    version.fingerprint,
  ]);
}

/**
 * The source values of `fields` in the languages they were made from that are there to be
 * recorded, by language then field: one no record describes yet, from before origins were
 * recorded, whose value reads back as written and is not blank. What a translation made from such
 * a source now is recorded against, so a later change of it is found.
 */
export async function unrecordedSources(
  sources: WriteSources,
  fields: ReadonlyMap<string, string>
): Promise<Map<string, Map<string, string>>> {
  const found = new Map<string, Map<string, string>>();
  for (const [field, sourceLocale] of fields) {
    const stored = (await sources.read(sourceLocale)).get(field);
    if (stored === undefined || !stored.readsBack || isBlank(stored.value)) {
      continue;
    }
    const inLanguage = found.get(sourceLocale) ?? new Map<string, string>();
    inLanguage.set(field, stored.fingerprint);
    found.set(sourceLocale, inLanguage);
  }
  return found;
}

/**
 * Keeps the source text of each field of `made`, on the write's transaction: a version already
 * kept is shared, and one whose stored value is not the one recorded is left out.
 */
export async function keepSources(
  sources: WriteSources,
  document: SourceDocument,
  made: ReadonlyMap<string, RecordedSource>,
  now: Date
): Promise<void> {
  if (!sources.kept || made.size === 0) return;
  const kept = new Set(
    (
      await sources.db.select<{
        sourceLocale: string;
        fieldPath: string;
        fingerprint: string;
      }>(TRANSLATION_SOURCES_TABLE, {
        columns: ["sourceLocale", "fieldPath", "fingerprint"],
        where: documentWhere(document, [...made.keys()]),
      })
    ).map(versionKey)
  );
  for (const [fieldPath, source] of made) {
    if (kept.has(versionKey({ ...source, fieldPath }))) continue;
    const stored = (await sources.read(source.sourceLocale)).get(fieldPath);
    if (stored === undefined || stored.fingerprint !== source.fingerprint) {
      continue;
    }
    const content: KeptSource = { value: stored.value };
    // Keeps the row that stands: another language's save may keep the same version at once.
    await sources.db.upsert(
      TRANSLATION_SOURCES_TABLE,
      {
        id: randomUUID(),
        ...document,
        sourceLocale: source.sourceLocale,
        fieldPath,
        fingerprint: source.fingerprint,
        content,
        recordedAt: now,
      },
      {
        conflictColumns: [
          "scopeKind",
          "scopeSlug",
          "entryId",
          "sourceLocale",
          "fieldPath",
          "fingerprint",
        ],
        updateColumns: [],
      }
    );
  }
}

/**
 * Removes each version of the source text of `fields` that no record of the document names as its
 * source any more, in any language, live or held, on the write's own transaction.
 */
export async function pruneSources(
  db: Pick<SourceTextDb, "select" | "delete">,
  document: SourceDocument,
  fields: readonly string[]
): Promise<void> {
  if (fields.length === 0) return;
  const kept = await db.select<{
    id: string;
    sourceLocale: string;
    fieldPath: string;
    fingerprint: string;
  }>(TRANSLATION_SOURCES_TABLE, {
    columns: ["id", "sourceLocale", "fieldPath", "fingerprint"],
    where: documentWhere(document, fields),
  });
  if (kept.length === 0) return;
  const named = new Set(
    (
      await db.select<{
        sourceLocale: string | null;
        fieldPath: string;
        sourceFingerprint: string | null;
      }>(TRANSLATION_PROVENANCE_TABLE, {
        columns: ["sourceLocale", "fieldPath", "sourceFingerprint"],
        where: documentWhere(document, fields),
      })
    ).map(row => versionKey({ ...row, fingerprint: row.sourceFingerprint }))
  );
  const unnamed = kept
    .filter(version => !named.has(versionKey(version)))
    .map(version => version.id);
  if (unnamed.length === 0) return;
  await db.delete(TRANSLATION_SOURCES_TABLE, {
    and: [{ column: "id", op: "IN", value: unnamed }],
  });
}

/**
 * Removes every source text a deleted document's translations were made from, on `db`, the
 * delete's own transaction.
 */
export async function forgetDocumentSources(
  db: Pick<SourceTextDb, "delete">,
  document: SourceDocument
): Promise<void> {
  await db.delete(TRANSLATION_SOURCES_TABLE, documentWhere(document));
}

/** The field a record's path is of: itself, or the field a row's own record is in. */
export function fieldOfPath(path: string): string {
  return path.split(TRANSLATION_PROVENANCE_ROW_SEPARATOR)[0];
}
