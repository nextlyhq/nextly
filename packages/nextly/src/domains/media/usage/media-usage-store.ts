/**
 * The stored record of which media items each document uses, and the one way
 * it is written and read.
 *
 * A write path hands over everything one document refers to now, and the
 * document's rows are replaced with it on the write's own transaction, so the
 * record commits or rolls back with the content it describes. A delete
 * removes the document's rows the same way. A reader asks which documents use
 * an item, one query on the item's index.
 *
 * Until `nextly migrate` creates the table, nothing is recorded and every
 * item reads as used by nothing: each path asks whether the table is there
 * ({@link mediaUsagePresent}) before it writes, rather than catching the
 * error a missing table raises, which on PostgreSQL aborts the transaction.
 *
 * @module domains/media/usage/media-usage-store
 */

import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import {
  MEDIA_USAGE_FIELD_PATH_LENGTH,
  MEDIA_USAGE_TABLE,
} from "../../../schemas/media-usage/table-name";
import { uuidV7 } from "../../../utils/uuid-v7";
import {
  tablePresence,
  type DashboardLogger,
  type TableProbe,
} from "../../dashboard/table-presence";
import { boundedValue } from "../../schema/services/index-name";

import type { MediaReference } from "./media-references";

/** What kind of document uses an item. */
export type UsageSubjectKind = "collection" | "single" | "email-template";

/**
 * One document: a collection's entry, a Single, or an email template. A
 * Single's `documentId` is "" and a template's `slug` is "", so every subject
 * is keyed by the same three columns on every dialect.
 */
export interface UsageSubject {
  kind: UsageSubjectKind;
  slug: string;
  documentId: string;
}

/** A reference, and the language whose value makes it ("" for a shared one). */
export interface LocatedMediaReference extends MediaReference {
  locale: string;
}

/** One stored row: an item used by one field of one document, in one language. */
export interface MediaUsageRow {
  mediaId: string;
  subjectKind: UsageSubjectKind;
  subjectSlug: string;
  documentId: string;
  fieldPath: string;
  locale: string;
}

/** The statements the record runs: a transaction's, or the adapter's own. */
export type UsageDb = Pick<
  TransactionContext,
  "select" | "insertMany" | "delete"
>;

/**
 * The one statement removing rows needs: narrow, so a versions sweep's own
 * database port reaches it as well as a transaction does.
 */
export interface UsageDeleteDb {
  delete(
    table: string,
    where: { and: Array<{ column: string; op: "="; value: string }> }
  ): Promise<number>;
}

/**
 * `items` in runs of at most `size`, the most one statement may bind: the
 * adapter's `maxParamsPerQuery` over what each item binds. SQLite's limit is
 * the lowest, so a document using many items is written in several inserts
 * there and in one elsewhere.
 */
function chunks<T>(items: readonly T[], size: number): T[][] {
  const run = Number.isFinite(size) ? Math.max(1, Math.floor(size)) : 1;
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += run) {
    out.push(items.slice(i, i + run));
  }
  return out;
}

/**
 * A column of a row the adapter read: under its property name where the
 * adapter knows the table's Drizzle definition, else under its own.
 */
function columnOf(
  row: Record<string, unknown>,
  property: string,
  column: string
): string {
  const value = row[property] ?? row[column];
  if (typeof value === "string") return value;
  return typeof value === "number" || typeof value === "bigint"
    ? String(value)
    : "";
}

/** The three columns a document's rows are found by. */
function subjectWhere(subject: UsageSubject): {
  and: Array<{ column: string; op: "="; value: string }>;
} {
  return {
    and: [
      { column: "subjectKind", op: "=", value: subject.kind },
      { column: "subjectSlug", op: "=", value: subject.slug },
      { column: "documentId", op: "=", value: subject.documentId },
    ],
  };
}

/**
 * The forms an address may name an item's own address in: itself, and for an
 * absolute address its path, since content may hold an item's address made
 * absolute against the site (an email's `<img>`, a pasted link) while the
 * library gives it out as `/uploads/...`. A path that names an item on
 * another host as well only keeps that item recorded, never drops a use.
 */
function addressForms(url: string): string[] {
  let path: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return [url];
    }
    path = parsed.pathname;
  } catch {
    return [url];
  }
  let decoded = path;
  try {
    decoded = decodeURI(path);
  } catch {
    // A malformed escape: the path as it is.
  }
  return [...new Set([url, path, decoded])];
}

/**
 * Which of the ids and addresses name a media item, and which item each
 * names: the ids found, and each address's items, in any of its forms
 * (`addressForms`). A reference to something that is not an item, or no
 * longer is, records nothing.
 */
async function resolveItems(
  db: UsageDb,
  refs: readonly MediaReference[],
  maxParams: number
): Promise<{ ids: Set<string>; byUrl: Map<string, string[]> }> {
  const wantedIds = [
    ...new Set(refs.flatMap(r => (r.mediaId ? [r.mediaId] : []))),
  ];
  const wantedUrls = [
    ...new Set(refs.flatMap(r => (r.url ? addressForms(r.url) : []))),
  ];
  const ids = new Set<string>();
  const byUrl = new Map<string, string[]>();
  // Each id or address is one bound value.
  for (const part of chunks(wantedIds, maxParams)) {
    const rows = await db.select<Record<string, unknown>>("media", {
      columns: ["id"],
      where: { and: [{ column: "id", op: "IN", value: part }] },
    });
    for (const row of rows) ids.add(columnOf(row, "id", "id"));
  }
  for (const part of chunks(wantedUrls, maxParams)) {
    const rows = await db.select<Record<string, unknown>>("media", {
      columns: ["id", "url"],
      where: { and: [{ column: "url", op: "IN", value: part }] },
    });
    for (const row of rows) {
      const url = columnOf(row, "url", "url");
      const list = byUrl.get(url) ?? [];
      list.push(columnOf(row, "id", "id"));
      byUrl.set(url, list);
    }
  }
  return { ids, byUrl };
}

/**
 * The field path as the table stores it: whole when it fits the column, else
 * bounded to it with a hash of the whole path, so a field nested deeply
 * enough to pass it is still one row of its own, apart from every other.
 */
function storedFieldPath(fieldPath: string): string {
  return boundedValue(fieldPath, MEDIA_USAGE_FIELD_PATH_LENGTH);
}

/**
 * Replace everything the record holds for `subject` with `refs`, on `db`,
 * which is the transaction of the write that made the document what `refs`
 * describe. A reference made twice, by one field in one language, is one row.
 * `maxParams` is the adapter's `maxParamsPerQuery`: no statement binds more.
 */
export async function replaceDocumentUsage(
  db: UsageDb,
  subject: UsageSubject,
  refs: readonly LocatedMediaReference[],
  maxParams: number
): Promise<void> {
  const { ids, byUrl } =
    refs.length > 0
      ? await resolveItems(db, refs, maxParams)
      : { ids: new Set<string>(), byUrl: new Map<string, string[]>() };
  const rows = new Map<string, Record<string, unknown>>();
  for (const ref of refs) {
    const items = ref.mediaId
      ? ids.has(ref.mediaId)
        ? [ref.mediaId]
        : []
      : addressForms(ref.url ?? "").flatMap(form => byUrl.get(form) ?? []);
    for (const mediaId of items) {
      const key = JSON.stringify([ref.fieldPath, ref.locale, mediaId]);
      if (rows.has(key)) continue;
      rows.set(key, {
        id: uuidV7(),
        mediaId,
        subjectKind: subject.kind,
        subjectSlug: subject.slug,
        documentId: subject.documentId,
        fieldPath: storedFieldPath(ref.fieldPath),
        locale: ref.locale,
      });
    }
  }
  await db.delete(MEDIA_USAGE_TABLE, subjectWhere(subject));
  const values = [...rows.values()];
  // Every row binds one value for each of its columns.
  const perRow = values.length > 0 ? Object.keys(values[0]).length : 1;
  for (const part of chunks(values, maxParams / perRow)) {
    await db.insertMany(MEDIA_USAGE_TABLE, part);
  }
}

/**
 * Lock one document's row on `tx` for the rest of the transaction, as the
 * first thing the transaction does: for the rebuild, which reads a document
 * that a write may be changing. The lock waits for that write to commit, and
 * nothing read before it fixes what the transaction sees, so on MySQL, whose
 * transaction reads from a snapshot taken at its first read, as on
 * PostgreSQL, the reads after it see what the write committed. SQLite runs
 * one write transaction at a time, so the two never overlap there and the
 * lock is nothing.
 */
export async function lockDocument(
  tx: Pick<TransactionContext, "lockRow">,
  table: string,
  rowId: string
): Promise<void> {
  await tx.lockRow(table, rowId);
}

/** Remove everything the record holds for `subject`, which is gone. */
export async function removeDocumentUsage(
  db: UsageDeleteDb,
  subject: UsageSubject
): Promise<void> {
  await db.delete(MEDIA_USAGE_TABLE, subjectWhere(subject));
}

/**
 * Remove everything the record holds for every document of a collection or a
 * Single that is gone.
 */
export async function removeEntityUsage(
  db: UsageDeleteDb,
  entity: { kind: "collection" | "single"; slug: string }
): Promise<void> {
  await db.delete(MEDIA_USAGE_TABLE, {
    and: [
      { column: "subjectKind", op: "=", value: entity.kind },
      { column: "subjectSlug", op: "=", value: entity.slug },
    ],
  });
}

/**
 * Every document field that uses one media item, from the record alone: one
 * query on the item's index, reading no content table. Ordered so one
 * document's rows are together.
 */
export async function listMediaUsage(
  db: Pick<UsageDb, "select">,
  mediaId: string
): Promise<MediaUsageRow[]> {
  const rows = await db.select<Record<string, unknown>>(MEDIA_USAGE_TABLE, {
    columns: [
      "mediaId",
      "subjectKind",
      "subjectSlug",
      "documentId",
      "fieldPath",
      "locale",
    ],
    where: { and: [{ column: "mediaId", op: "=", value: mediaId }] },
    orderBy: [
      { column: "subjectKind", direction: "asc" },
      { column: "subjectSlug", direction: "asc" },
      { column: "documentId", direction: "asc" },
      { column: "fieldPath", direction: "asc" },
      { column: "locale", direction: "asc" },
    ],
  });
  return rows.map(row => ({
    mediaId: columnOf(row, "mediaId", "media_id"),
    subjectKind: columnOf(
      row,
      "subjectKind",
      "subject_kind"
    ) as UsageSubjectKind,
    subjectSlug: columnOf(row, "subjectSlug", "subject_slug"),
    documentId: columnOf(row, "documentId", "document_id"),
    fieldPath: columnOf(row, "fieldPath", "field_path"),
    locale: columnOf(row, "locale", "locale"),
  }));
}

/**
 * The `nextly_meta` key whose presence says the record has been built for
 * content written before it existed: set by `nextly media reindex-usage` once
 * it has rebuilt every document, and on a new site, which has none.
 */
export const MEDIA_USAGE_RECORDED_KEY = "media.usage.recorded";

/**
 * Whether the usage table exists yet, asked once per database and remembered
 * once found (`tablePresence`). A path that opens its own transaction asks
 * before it opens; one inside a transaction its caller holds asks `via` that
 * transaction's connection, never the pool.
 */
const presenceByDb = new WeakMap<
  TableProbe,
  (via?: TableProbe) => Promise<boolean>
>();

export function mediaUsagePresent(
  db: TableProbe,
  logger?: DashboardLogger,
  via?: TableProbe
): Promise<boolean> {
  let present = presenceByDb.get(db);
  if (present === undefined) {
    present = tablePresence(
      db,
      MEDIA_USAGE_TABLE,
      "Where media items are used is not being recorded",
      logger
    );
    presenceByDb.set(db, present);
  }
  return present(via);
}
