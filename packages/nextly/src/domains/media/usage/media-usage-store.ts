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

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type {
  TransactionContext,
  WhereClause,
  WhereCondition,
} from "@nextlyhq/adapter-drizzle/types";

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

import { findKeptAddresses } from "./kept-addresses";
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
  /**
   * The address the field names the item by, as the library gave it out,
   * or `null` when it names the item by its id. Taken from the reference the
   * field made (`collectMediaReferences`), so there is no second account of
   * which fields name items by address.
   */
  address: string | null;
}

/**
 * The statements the record runs: the transaction of the write that changed
 * the document.
 */
export type UsageDb = Pick<
  TransactionContext,
  "select" | "insertMany" | "delete" | "lockRow"
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

/** An item an address names, and the address it is known by. */
interface AddressMatch {
  mediaId: string;
  /** The item's own address, or an earlier one whose file a Replace kept. */
  address: string;
  /** Whether it is the item's address now, not a kept earlier one. */
  current: boolean;
}

/** What the references resolve to: the ids found, and each address's items. */
interface ResolvedItems {
  ids: Set<string>;
  byUrl: Map<string, AddressMatch[]>;
}

/** `byUrl`'s matches for `url`, with `match` added. */
function addMatch(
  byUrl: Map<string, AddressMatch[]>,
  url: string,
  match: AddressMatch
): void {
  byUrl.set(url, [...(byUrl.get(url) ?? []), match]);
}

/**
 * Each of `urls` that names an item, as the transaction reads them: the
 * items whose address it is now, or else the item a Replace kept it for.
 */
async function addressMatches(
  db: UsageDb,
  urls: readonly string[],
  maxParams: number
): Promise<Map<string, AddressMatch[]>> {
  const byUrl = new Map<string, AddressMatch[]>();
  // Each address is one bound value.
  for (const part of chunks(urls, maxParams)) {
    const rows = await db.select<Record<string, unknown>>("media", {
      columns: ["id", "url"],
      where: { and: [{ column: "url", op: "IN", value: part }] },
    });
    for (const row of rows) {
      const url = columnOf(row, "url", "url");
      addMatch(byUrl, url, {
        mediaId: columnOf(row, "id", "id"),
        address: url,
        current: true,
      });
    }
  }
  const kept = await findKeptAddresses(
    db,
    urls.filter(url => !byUrl.has(url)),
    maxParams
  );
  for (const [url, found] of kept) {
    addMatch(byUrl, url, {
      mediaId: found.mediaId,
      address: found.url,
      current: false,
    });
  }
  return byUrl;
}

/**
 * The same as {@link addressMatches}, asked again once the items `locked`
 * are locked, with each read taking the latest committed rows: the items by
 * their ids, so only their rows are locked, and the kept addresses by key.
 * A Replace, or the end of one that forgets a kept address, takes the same
 * lock, so neither changes what this finds until the write holding it
 * commits, and what it finds is what they last committed. An item gone is
 * named by none of its addresses.
 */
async function lockedAddressMatches(
  db: UsageDb,
  urls: readonly string[],
  locked: readonly string[],
  maxParams: number
): Promise<Map<string, AddressMatch[]>> {
  const wanted = new Set(urls);
  const present = new Set<string>();
  const byUrl = new Map<string, AddressMatch[]>();
  for (const part of chunks(locked, maxParams)) {
    const rows = await db.select<Record<string, unknown>>("media", {
      columns: ["id", "url"],
      where: { and: [{ column: "id", op: "IN", value: part }] },
      forUpdate: true,
    });
    for (const row of rows) {
      const mediaId = columnOf(row, "id", "id");
      const url = columnOf(row, "url", "url");
      present.add(mediaId);
      if (wanted.has(url)) {
        addMatch(byUrl, url, { mediaId, address: url, current: true });
      }
    }
  }
  const kept = await findKeptAddresses(
    db,
    urls.filter(url => !byUrl.has(url)),
    maxParams,
    true
  );
  for (const [url, found] of kept) {
    // An item not locked here was not one the address named a moment ago;
    // it stays named, its presence asked with the ids below.
    if (locked.includes(found.mediaId) && !present.has(found.mediaId)) {
      continue;
    }
    addMatch(byUrl, url, {
      mediaId: found.mediaId,
      address: found.url,
      current: false,
    });
  }
  return byUrl;
}

/**
 * Which of the ids and addresses name a media item, and which item each
 * names: the ids found, and each address's items, in any of its forms
 * (`addressForms`). A form no item has now is looked up among the addresses
 * a Replace kept (`kept-addresses`), so content still naming an item's
 * earlier address goes on counting as the item's use. A reference to
 * something that is not an item, or no longer is, records nothing.
 *
 * Every item an address names is locked, in one order, for the rest of the
 * write, and the addresses are asked again under those locks
 * ({@link lockedAddressMatches}): the lock a Replace takes, and the one the
 * end of a Replace takes to decide whether an old file is still named. So
 * that decision either waits for this write and sees its use, or comes first
 * and this write sees the address forgotten, and never removes a file a use
 * recorded here still names.
 */
async function resolveItems(
  db: UsageDb,
  refs: readonly MediaReference[],
  maxParams: number
): Promise<ResolvedItems> {
  const wantedUrls = [
    ...new Set(refs.flatMap(r => (r.url ? addressForms(r.url) : []))),
  ];
  let byUrl = await addressMatches(db, wantedUrls, maxParams);
  const named = [
    ...new Set([...byUrl.values()].flat().map(match => match.mediaId)),
  ].sort();
  if (named.length > 0) {
    for (const mediaId of named) await db.lockRow("media", mediaId);
    byUrl = await lockedAddressMatches(db, [...byUrl.keys()], named, maxParams);
  }
  const keptItems = [...byUrl.values()]
    .flat()
    .filter(match => !match.current)
    .map(match => match.mediaId);
  const wantedIds = [
    ...new Set([
      ...refs.flatMap(r => (r.mediaId ? [r.mediaId] : [])),
      ...keptItems,
    ]),
  ];
  const ids = new Set<string>();
  for (const part of chunks(wantedIds, maxParams)) {
    const rows = await db.select<Record<string, unknown>>("media", {
      columns: ["id"],
      where: { and: [{ column: "id", op: "IN", value: part }] },
    });
    for (const row of rows) ids.add(columnOf(row, "id", "id"));
  }
  // A kept address counts only while its item is still there.
  for (const [url, matches] of byUrl) {
    const standing = matches.filter(
      match => match.current || ids.has(match.mediaId)
    );
    if (standing.length > 0) byUrl.set(url, standing);
    else byUrl.delete(url);
  }
  return { ids, byUrl };
}

/** The items one reference names, with the address each is named by. */
function itemsOf(
  ref: MediaReference,
  resolved: ResolvedItems
): Array<{ mediaId: string; address: string | null; current: boolean }> {
  if (ref.mediaId) {
    return resolved.ids.has(ref.mediaId)
      ? [{ mediaId: ref.mediaId, address: null, current: true }]
      : [];
  }
  return addressForms(ref.url ?? "").flatMap(
    form => resolved.byUrl.get(form) ?? []
  );
}

/**
 * Which of two ways one field names one item its row keeps: a kept earlier
 * address over the item's address now, and either over its id. A field that
 * names a kept address anywhere still shows the previous file there, which
 * Used in reports from the row; and a row with any address is one a Replace
 * keeps the old files for, so preferring the kept one loses no protection
 * for the current file.
 */
function rank(found: { address: string | null; current: boolean }): number {
  if (found.address === null) return 0;
  return found.current ? 1 : 2;
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
  const resolved: ResolvedItems =
    refs.length > 0
      ? await resolveItems(db, refs, maxParams)
      : { ids: new Set<string>(), byUrl: new Map<string, AddressMatch[]>() };
  const rows = new Map<
    string,
    { row: Record<string, unknown>; rank: number }
  >();
  for (const ref of refs) {
    for (const found of itemsOf(ref, resolved)) {
      const key = JSON.stringify([ref.fieldPath, ref.locale, found.mediaId]);
      const standing = rows.get(key);
      if (standing && standing.rank >= rank(found)) continue;
      rows.set(key, {
        rank: rank(found),
        row: {
          id: uuidV7(),
          mediaId: found.mediaId,
          subjectKind: subject.kind,
          subjectSlug: subject.slug,
          documentId: subject.documentId,
          fieldPath: storedFieldPath(ref.fieldPath),
          locale: ref.locale,
          address: found.address,
        },
      });
    }
  }
  await db.delete(MEDIA_USAGE_TABLE, subjectWhere(subject));
  const values = [...rows.values()].map(entry => entry.row);
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

/** One stored row, with its own id, which a rewrite of its document renews. */
export interface IdentifiedUsageRow extends MediaUsageRow {
  id: string;
}

/** The columns a row of the record is read with. */
const USAGE_ROW_COLUMNS = [
  "id",
  "mediaId",
  "subjectKind",
  "subjectSlug",
  "documentId",
  "fieldPath",
  "locale",
  "address",
];

/** The order a document's rows are read in: one document's together. */
const DOCUMENT_ORDER: Array<{ column: string; direction: "asc" }> = [
  { column: "subjectKind", direction: "asc" },
  { column: "subjectSlug", direction: "asc" },
  { column: "documentId", direction: "asc" },
];

/** One row as the adapter read it. */
function identifiedRowOf(row: Record<string, unknown>): IdentifiedUsageRow {
  return {
    id: columnOf(row, "id", "id"),
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
    address: typeof row.address === "string" ? row.address : null,
  };
}

/**
 * Every row of the record for one media item, ids included: one query on
 * the item's index, reading no content table. Ordered so one document's
 * rows are together.
 */
async function listIdentifiedMediaUsage(
  db: Pick<UsageDb, "select">,
  mediaId: string
): Promise<IdentifiedUsageRow[]> {
  const rows = await db.select<Record<string, unknown>>(MEDIA_USAGE_TABLE, {
    columns: USAGE_ROW_COLUMNS,
    where: { and: [{ column: "mediaId", op: "=", value: mediaId }] },
    orderBy: [
      ...DOCUMENT_ORDER,
      { column: "fieldPath", direction: "asc" },
      { column: "locale", direction: "asc" },
    ],
  });
  return rows.map(identifiedRowOf);
}

/**
 * Whether any document names the item by an address, as the record has it:
 * one row looked for on the item's index.
 */
export async function usedByAddress(
  db: Pick<UsageDb, "select">,
  mediaId: string
): Promise<boolean> {
  const rows = await db.select<Record<string, unknown>>(MEDIA_USAGE_TABLE, {
    columns: ["id"],
    where: {
      and: [
        { column: "mediaId", op: "=", value: mediaId },
        { column: "address", op: "IS NOT NULL" },
      ],
    },
    limit: 1,
  });
  return rows.length > 0;
}

/** Which of an item's uses a page reads, and where it starts. */
export interface MediaUsagePageQuery {
  /** Only the documents naming the item by its address, by those uses. */
  byAddressOnly: boolean;
  /** The documents before this page, in the record's order. */
  offset: number;
  /** The most documents on the page. */
  limit: number;
}

/**
 * The page's documents as conditions on their full key, kind, slug and id,
 * gathered by kind and slug, each group's ids in runs one statement may bind
 * alongside `reserved` values of its own (`maxParamsPerQuery`): the rows of
 * those documents and no other's, so a Single, whose id is always "", never
 * brings in the rows of every other Single using the item.
 */
function documentKeyRuns(
  documents: ReadonlyArray<Record<string, unknown>>,
  maxParams: number,
  reserved: number
): WhereClause[][] {
  const groups = new Map<
    string,
    { kind: string; slug: string; ids: string[] }
  >();
  for (const row of documents) {
    const kind = columnOf(row, "subjectKind", "subject_kind");
    const slug = columnOf(row, "subjectSlug", "subject_slug");
    const scope = JSON.stringify([kind, slug]);
    const group = groups.get(scope) ?? { kind, slug, ids: [] };
    group.ids.push(columnOf(row, "documentId", "document_id"));
    groups.set(scope, group);
  }
  // A document's kind and slug bind two values beside its id.
  const room = Number.isFinite(maxParams)
    ? Math.max(3, Math.floor(maxParams) - reserved)
    : Number.MAX_SAFE_INTEGER;
  const runs: WhereClause[][] = [];
  let run: WhereClause[] = [];
  let used = 0;
  for (const { kind, slug, ids } of groups.values()) {
    for (let start = 0; start < ids.length; ) {
      if (room - used < 3) {
        runs.push(run);
        run = [];
        used = 0;
      }
      const take = Math.min(ids.length - start, room - used - 2);
      run.push({
        and: [
          { column: "subjectKind", op: "=", value: kind },
          { column: "subjectSlug", op: "=", value: slug },
          {
            column: "documentId",
            op: "IN",
            value: ids.slice(start, start + take),
          },
        ],
      });
      used += take + 2;
      start += take;
    }
  }
  if (run.length > 0) runs.push(run);
  return runs;
}

/**
 * One page of the documents using an item, from the record alone: how many
 * documents use it, counted in the database, and every row of the page's
 * documents, which are `limit` of them in the record's order. Bounded
 * queries on the item's index, however many documents use it: the count,
 * the page's documents, and their rows by each document's full key, one
 * query unless the page binds more values than the dialect takes in one.
 */
export async function listMediaUsagePage(
  db: Pick<DrizzleAdapter, "select" | "count" | "getCapabilities">,
  mediaId: string,
  query: MediaUsagePageQuery
): Promise<{ rows: IdentifiedUsageRow[]; total: number }> {
  const conditions: WhereCondition[] = [
    { column: "mediaId", op: "=", value: mediaId },
    ...(query.byAddressOnly
      ? [{ column: "address", op: "IS NOT NULL" as const }]
      : []),
  ];
  const item: WhereClause = { and: conditions };
  const total = await db.count(MEDIA_USAGE_TABLE, {
    where: item,
    distinctOn: ["subjectKind", "subjectSlug", "documentId"],
  });
  const documents = await db.select<Record<string, unknown>>(
    MEDIA_USAGE_TABLE,
    {
      columns: ["subjectKind", "subjectSlug", "documentId"],
      distinct: true,
      where: item,
      orderBy: DOCUMENT_ORDER,
      limit: query.limit,
      offset: query.offset,
    }
  );
  if (documents.length === 0) return { rows: [], total };
  // The item's own conditions bind its id, and its address test none.
  const runs = documentKeyRuns(
    documents,
    db.getCapabilities().maxParamsPerQuery,
    1
  );
  const rows: Array<Record<string, unknown>> = [];
  for (const keys of runs) {
    rows.push(
      ...(await db.select<Record<string, unknown>>(MEDIA_USAGE_TABLE, {
        columns: USAGE_ROW_COLUMNS,
        where: { and: [...conditions, { or: keys }] },
        orderBy: [
          ...DOCUMENT_ORDER,
          { column: "fieldPath", direction: "asc" },
          { column: "locale", direction: "asc" },
        ],
      }))
    );
  }
  return { rows: rows.map(identifiedRowOf), total };
}

/**
 * Every document field that uses one media item, from the record alone:
 * {@link listIdentifiedMediaUsage} without the rows' own ids.
 */
export async function listMediaUsage(
  db: Pick<UsageDb, "select">,
  mediaId: string
): Promise<MediaUsageRow[]> {
  const rows = await listIdentifiedMediaUsage(db, mediaId);
  return rows.map(({ id: _id, ...row }) => row);
}

/**
 * The `nextly_meta` key whose presence says the record has been built for
 * content written before it existed: set by `nextly media reindex-usage` once
 * it has rebuilt every document, and on a new site, which has none.
 *
 * The key names the record's format, so a mark written for an earlier one
 * does not count. Rows written before the record kept each use's address
 * (`address`) read as uses by id, and a Replace trusting them would remove a
 * file a page still shows; a record marked under an earlier key
 * (`media.usage.recorded`) therefore reads as still being built until the
 * rebuild writes this key. The same holds for `media.usage.recorded:2`, whose
 * rows for a block document with its own list of items lack the addresses its
 * nodes name. Raise the format whenever the rows gain something a reader of
 * a complete record relies on.
 */
export const MEDIA_USAGE_RECORDED_KEY = "media.usage.recorded:3";

/**
 * Which build of the record stands, or `null` while none does: the mark's
 * stored value, which each rebuild writes anew (`rebuiltAt`). Two reads that
 * give the same build saw no rebuild finish between them, so what was read
 * between them came from that one complete record.
 */
async function mediaUsageRecordBuild(
  db: Pick<UsageDb, "select">
): Promise<string | null> {
  const rows = await db.select<Record<string, unknown>>("nextly_meta", {
    columns: ["key", "value"],
    where: {
      and: [{ column: "key", op: "=", value: MEDIA_USAGE_RECORDED_KEY }],
    },
  });
  if (rows.length === 0) return null;
  const value = rows[0].value;
  return typeof value === "string" ? value : JSON.stringify(value ?? null);
}

/**
 * `read()`, and whether the record it read was complete: the build is read
 * before and after it, and only one build standing throughout, the same
 * before and after, counts. A rebuild that starts, finishes or runs whole
 * between the two reads leaves them different or absent, so whatever `read`
 * saw of a record being rebuilt is never taken as complete. The one check
 * every answer about the record makes: the library's counts and an item's
 * uses, the Unused list and Replace's uses by address. Until a build
 * stands, a use the record lacks, or one it holds without its address, may
 * still be in some document.
 */
export async function readWithinOneBuild<T>(
  db: Pick<UsageDb, "select">,
  read: () => Promise<T>
): Promise<{ value: T; recorded: boolean }> {
  const before = await mediaUsageRecordBuild(db);
  const value = await read();
  const after = await mediaUsageRecordBuild(db);
  return { value, recorded: before !== null && before === after };
}

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
