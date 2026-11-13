/**
 * The address record's storage: the plugin's own tables `seo__addresses`
 * (who holds which address, and the lock rows a save takes) and `seo__notes`
 * (the catch-up's fingerprint and site types, the Proxy's note, the site's
 * standing, and the redirects a deploy's move still owes). This module is
 * the only one that reads or writes either table; every reader of the
 * record, in a save or outside one, comes through here.
 *
 * Written through `ctx.db`, so a claim is one statement rather than a whole
 * entry save: no version, content event, media scan or hook runs for a row
 * of bookkeeping. A save's own rows are written on the save's transaction,
 * through the `db` core binds to it.
 *
 * An earlier version kept the record in the collection `nx_seo_addresses`.
 * Its rows are moved here once, at start, before anything here answers
 * (`recordReady`): the record's answers would otherwise lose an address a
 * page holds there, and a second page could take it. The collection stays
 * declared, and is left as it was.
 *
 * @module address-record/store
 */
import { AsyncResource } from "node:async_hooks";

import {
  NextlyError,
  type AddressHolder,
  type HeldAddress,
  type PluginContext,
  type PluginTransaction,
} from "@nextlyhq/plugin-sdk";
import {
  and,
  asc,
  eq,
  inArray,
  increment,
  like,
  or,
} from "@nextlyhq/plugin-sdk/db";
import { isUniqueViolation } from "@nextlyhq/plugin-sdk/schema";

import { addressClaims, addressNotes } from "../schema/tables";
import { SEO_ADMIN_SLUG } from "../settings/contract";

import { recordSlug, sha256, type RecordRow, type RowKind } from "./rows";

/** The database a read or write runs on: the pool, or one transaction. */
type Db = PluginTransaction;

/** A condition a read or write is narrowed by. */
type Condition = ReturnType<typeof eq>;

/** Every one of `conditions`. */
function allOf(first: Condition, ...rest: Condition[]): Condition {
  return and(first, ...rest) ?? first;
}

/** How a read inside a transaction locks the rows it reads. */
export type RowLock = "update" | "share" | "none";

/** How many rows one read or one insert takes. */
const PAGE = 200;

/** The cache part every page head built from the record is tagged with. */
export const ADDRESS_RECORD_CACHE_PART = "address-record";

/**
 * The event announced once a change to who holds an address commits: what
 * expires the page heads tagged with {@link ADDRESS_RECORD_CACHE_PART}.
 * Never for a save that was undone, since the event waits for its commit.
 */
export const ADDRESS_RECORD_CHANGED: string = `${SEO_ADMIN_SLUG}.address-record-changed`;

/** Announce that who holds an address changed, never failing the caller. */
export function announceRecordChanged(ctx: PluginContext): void {
  try {
    ctx.events.emit(ADDRESS_RECORD_CHANGED, {});
  } catch (error) {
    ctx.logger.warn("The SEO plugin could not announce a changed record", {
      error,
    });
  }
}

/** A stored claim row read back, every column checked rather than trusted. */
function claimRowOf(row: Record<string, unknown>): RecordRow {
  const text = (value: unknown) => (typeof value === "string" ? value : null);
  const kind: RowKind =
    row.kind === "address" || row.kind === "range" ? row.kind : "lock";
  const locale = text(row.locale);
  const path = text(row.path);
  const collection = text(row.holderCollection);
  const id = text(row.holderId);
  const label = text(row.holderLabel);
  return {
    id: String(row.id),
    claimKey: text(row.claimKey) ?? "",
    kind,
    address:
      kind === "lock" || locale === null || path === null
        ? null
        : { locale, path, ...(kind === "range" ? { range: true } : {}) },
    holder:
      collection === null || id === null
        ? null
        : { collection, id, ...(label ? { label } : {}) },
  };
}

/** The rows `where` selects, read `lock` on `db`, in claim key order. */
async function claimsWhere(
  db: Db,
  where: Condition,
  lock: RowLock = "none"
): Promise<RecordRow[]> {
  const columns = db.table(addressClaims);
  const found: RecordRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const query = db
      .select(addressClaims)
      .where(where)
      .orderBy(asc(columns.claimKey))
      .limit(PAGE)
      .offset(offset);
    const rows = await (lock === "none" ? query : query.lock(lock)).all();
    found.push(
      ...rows.map(row => claimRowOf(row as unknown as Record<string, unknown>))
    );
    if (rows.length < PAGE) return found;
  }
}

const HELD_KINDS = ["address", "range"];

/** The rows stored under `keys`, read `lock` on `db`. */
export async function rowsByKeys(
  db: Db,
  keys: readonly string[],
  lock: RowLock = "none"
): Promise<RecordRow[]> {
  if (keys.length === 0) return [];
  return claimsWhere(
    db,
    inArray(db.table(addressClaims).claimKey, [...keys]),
    lock
  );
}

/** The addresses and ranges `holder` keeps, read `lock` on `db`. */
export function rowsOfHolder(
  db: Db,
  holder: AddressHolder,
  lock: RowLock = "none"
): Promise<RecordRow[]> {
  const columns = db.table(addressClaims);
  return claimsWhere(
    db,
    allOf(
      eq(columns.holderCollection, holder.collection),
      eq(columns.holderId, holder.id),
      inArray(columns.kind, HELD_KINDS)
    ),
    lock
  );
}

/**
 * Candidates for the addresses and ranges below `base` in `locale`: every
 * row whose path starts with it, and possibly more. Each character of `base`
 * a pattern could read differently is matched by any one character instead,
 * on every dialect: `like` reads `_` and `%` as wildcards, and a `\` as an
 * escape on PostgreSQL and MySQL. So no row below `base` is ever missed, and
 * the caller keeps those truly below by the path itself.
 */
export function rowsUnder(
  db: Db,
  locale: string,
  base: string,
  lock: RowLock = "none"
): Promise<RecordRow[]> {
  const columns = db.table(addressClaims);
  const pattern = `${base.replace(/[\\%_]/g, "_")}%`;
  return claimsWhere(
    db,
    allOf(
      eq(columns.locale, locale),
      inArray(columns.kind, HELD_KINDS),
      like(columns.path, pattern)
    ),
    lock
  );
}

/**
 * Insert `values` into `table` on `db`, answering false where its unique
 * key refuses it: another transaction made the row first. On PostgreSQL a
 * refused statement ends the transaction it ran in, so there the insert runs
 * under a savepoint of `db`'s transaction, which `ctx.db.transaction` joins
 * from inside it; MySQL and SQLite keep a transaction usable after one.
 */
async function insertUnlessTaken<
  T extends typeof addressClaims | typeof addressNotes,
>(
  ctx: PluginContext,
  db: Db,
  table: T,
  values: Parameters<Db["insert"]>[1] & Record<string, unknown>
): Promise<boolean> {
  try {
    if (ctx.dialect === "postgresql") {
      await ctx.db.transaction(inner => inner.insert(table, values as never));
    } else {
      await db.insert(table, values as never);
    }
    return true;
  } catch (error) {
    if (!isUniqueViolation(ctx.dialect, error)) throw error;
    return false;
  }
}

/**
 * Hold the lock row `key` until `db`'s transaction ends: one update adding
 * to `taken`, which takes the row's lock and reads the latest row. Where the
 * row is not there yet it is made with `fields`; a save making it at the
 * same moment waits on the key's index, and the loser takes the winner's.
 */
export async function takeLock(
  ctx: PluginContext,
  db: Db,
  key: string,
  fields: { locale: string; path: string }
): Promise<void> {
  const byKey = eq(db.table(addressClaims).claimKey, key);
  const take = () =>
    db.update(addressClaims, { taken: increment(1) }).where(byKey);
  if ((await take()) > 0) return;
  const made = await insertUnlessTaken(ctx, db, addressClaims, {
    claimKey: key,
    kind: "lock",
    locale: fields.locale,
    path: fields.path,
  });
  if (made) return;
  if ((await take()) === 0) {
    throw NextlyError.internal({
      logContext: { reason: "address-lock-vanished", ...fields },
    });
  }
}

/** Delete the claim rows `ids` on `db`. */
export async function deleteRows(
  db: Db,
  ids: readonly string[]
): Promise<void> {
  const columns = db.table(addressClaims);
  for (let at = 0; at < ids.length; at += PAGE) {
    await db
      .delete(addressClaims)
      .where(inArray(columns.id, ids.slice(at, at + PAGE)));
  }
}

/**
 * Claim `held` for `holder` under `key` on `db`; false where the key is
 * another's already. On PostgreSQL the refusal ends the transaction, so the
 * caller fails the save at once.
 */
export async function insertClaim(
  ctx: PluginContext,
  db: Db,
  key: string,
  held: HeldAddress,
  holder: AddressHolder
): Promise<boolean> {
  try {
    await db.insert(addressClaims, {
      claimKey: key,
      kind: held.range === true ? "range" : "address",
      locale: held.locale,
      path: held.path,
      holderCollection: holder.collection,
      holderId: holder.id,
      holderLabel: holder.label ?? null,
    });
    return true;
  } catch (error) {
    if (!isUniqueViolation(ctx.dialect, error)) throw error;
    return false;
  }
}

/**
 * Let go of every address a deleted collection's entries held, on the
 * delete's own transaction: one statement. Answers how many went.
 */
export function releaseCollection(db: Db, collection: string): Promise<number> {
  const columns = db.table(addressClaims);
  return db
    .delete(addressClaims)
    .where(
      allOf(
        eq(columns.holderCollection, collection),
        inArray(columns.kind, HELD_KINDS)
      )
    );
}

/**
 * Run `work` with `ctx.db` on the transaction the calling flow is in, as a
 * savepoint of it: a caller handed only a collection transaction reads and
 * writes the record on it this way. Outside one, on a transaction of its own.
 */
export function onFlowTransaction<T>(
  ctx: PluginContext,
  work: (db: Db) => Promise<T>
): Promise<T> {
  return ctx.db.transaction(work);
}

// Reads outside a save: each waits for the earlier record to have moved.

/** Who holds each of `keys`, by key, read once the record has moved. */
export async function holdersByKey(
  ctx: PluginContext,
  keys: readonly string[]
): Promise<Map<string, AddressHolder>> {
  await recordReady(ctx);
  const held = new Map<string, AddressHolder>();
  for (let at = 0; at < keys.length; at += PAGE) {
    for (const row of await rowsByKeys(ctx.db, keys.slice(at, at + PAGE))) {
      if (row.holder !== null) held.set(row.claimKey, row.holder);
    }
  }
  return held;
}

/** The rows stored under `keys`, on `db` where given, read once moved. */
export async function rowsAt(
  ctx: PluginContext,
  keys: readonly string[],
  db?: Db
): Promise<RecordRow[]> {
  await recordReady(ctx);
  return rowsByKeys(db ?? ctx.db, keys);
}

/**
 * The exact addresses the pages `ids` of `collection` hold, in every
 * language: one read for a whole batch of pages.
 */
export async function addressesOf(
  ctx: PluginContext,
  collection: string,
  ids: readonly string[]
): Promise<RecordRow[]> {
  if (ids.length === 0) return [];
  await recordReady(ctx);
  const columns = ctx.db.table(addressClaims);
  const found: RecordRow[] = [];
  for (let at = 0; at < ids.length; at += PAGE) {
    found.push(
      ...(await claimsWhere(
        ctx.db,
        allOf(
          eq(columns.kind, "address"),
          eq(columns.holderCollection, collection),
          inArray(columns.holderId, ids.slice(at, at + PAGE))
        )
      ))
    );
  }
  return found;
}

/** The claim key of every row a holder of `collection` keeps. */
export async function keysHeldBy(
  ctx: PluginContext,
  collection: string
): Promise<Set<string>> {
  await recordReady(ctx);
  const columns = ctx.db.table(addressClaims);
  const rows = await claimsWhere(
    ctx.db,
    eq(columns.holderCollection, collection)
  );
  return new Set(rows.map(row => row.claimKey));
}

/**
 * The addresses and ranges the record holds, in claim key order: every one,
 * or the `page` of them where given.
 */
export async function heldRows(
  ctx: PluginContext,
  kinds: readonly RowKind[] = ["address", "range"],
  page?: { limit: number; offset: number }
): Promise<RecordRow[]> {
  await recordReady(ctx);
  const columns = ctx.db.table(addressClaims);
  if (page === undefined) {
    return claimsWhere(ctx.db, inArray(columns.kind, [...kinds]));
  }
  const rows = await ctx.db
    .select(addressClaims)
    .where(inArray(columns.kind, [...kinds]))
    .orderBy(asc(columns.claimKey))
    .limit(page.limit)
    .offset(page.offset)
    .all();
  return rows.map(row => claimRowOf(row as unknown as Record<string, unknown>));
}

// Notes.

/** A stored note: its key, kind and value. */
export interface StoredNote {
  key: string;
  kind: string;
  value: string | null;
}

function noteOf(row: Record<string, unknown>): StoredNote {
  return {
    key: typeof row.noteKey === "string" ? row.noteKey : "",
    kind: typeof row.kind === "string" ? row.kind : "",
    value: typeof row.value === "string" ? row.value : null,
  };
}

/** The key of the note `name`. */
export function noteKey(name: string): string {
  return sha256(`meta:${name}`);
}

/**
 * The notes stored under `keys`, and, where `withPending`, whether any
 * pending move is noted: one read. At most `keys.length` notes are meta
 * notes, so a read of one more holds a pending note whenever one exists.
 */
export async function readNotes(
  ctx: PluginContext,
  keys: readonly string[],
  withPending = false
): Promise<{ notes: Map<string, string | null>; pending: boolean }> {
  await recordReady(ctx);
  return notesOn(ctx.db, keys, withPending);
}

async function notesOn(
  db: Db,
  keys: readonly string[],
  withPending: boolean,
  lock: RowLock = "none"
): Promise<{ notes: Map<string, string | null>; pending: boolean }> {
  const columns = db.table(addressNotes);
  const byKey = inArray(columns.noteKey, [...keys]);
  const query = db
    .select(addressNotes)
    .where(
      withPending ? (or(byKey, eq(columns.kind, "pending")) ?? byKey) : byKey
    )
    .limit(keys.length + (withPending ? 1 : 0));
  const rows = (await (lock === "none" ? query : query.lock(lock)).all()).map(
    row => noteOf(row as unknown as Record<string, unknown>)
  );
  const notes = new Map<string, string | null>();
  let pending = false;
  for (const row of rows) {
    if (row.kind === "pending") pending = true;
    else notes.set(row.key, row.value);
  }
  return { notes, pending };
}

/**
 * Keep `value` under the note `key`: one update where the note is there, an
 * insert where it is not, and the update again where another process made it
 * at the same moment. A caller that has just read the note `absent` starts
 * with the insert.
 */
export async function putNote(
  ctx: PluginContext,
  key: string,
  value: string,
  { absent = false }: { absent?: boolean } = {}
): Promise<void> {
  await recordReady(ctx);
  const byKey = eq(ctx.db.table(addressNotes).noteKey, key);
  const write = () => ctx.db.update(addressNotes, { value }).where(byKey);
  if (!absent && (await write()) > 0) return;
  const made = await insertUnlessTaken(ctx, ctx.db, addressNotes, {
    noteKey: key,
    kind: "meta",
    value,
  });
  if (!made) await write();
}

/**
 * Keep `value` under the note `key` where none is kept yet; answers the
 * value kept, this one or the one another process kept first.
 */
export async function addNoteOnce(
  ctx: PluginContext,
  key: string,
  value: string
): Promise<string | null> {
  await recordReady(ctx);
  if (
    await insertUnlessTaken(ctx, ctx.db, addressNotes, {
      noteKey: key,
      kind: "meta",
      value,
    })
  ) {
    return value;
  }
  return (await notesOn(ctx.db, [key], false)).notes.get(key) ?? null;
}

/** Note `values` under their keys as `pending`, on `db`, skipping kept ones. */
export async function notePending(
  ctx: PluginContext,
  db: Db,
  values: readonly { key: string; value: string }[]
): Promise<void> {
  for (const { key, value } of values) {
    await insertUnlessTaken(ctx, db, addressNotes, {
      noteKey: key,
      kind: "pending",
      value,
    });
  }
}

/** Every pending note, in key order. */
export async function pendingNotes(ctx: PluginContext): Promise<StoredNote[]> {
  await recordReady(ctx);
  const columns = ctx.db.table(addressNotes);
  const found: StoredNote[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const rows = await ctx.db
      .select(addressNotes)
      .where(eq(columns.kind, "pending"))
      .orderBy(asc(columns.noteKey))
      .limit(PAGE)
      .offset(offset)
      .all();
    found.push(
      ...rows.map(row => noteOf(row as unknown as Record<string, unknown>))
    );
    if (rows.length < PAGE) return found;
  }
}

/** Forget the notes `keys`. */
export async function forgetNotes(
  ctx: PluginContext,
  keys: readonly string[]
): Promise<void> {
  if (keys.length === 0) return;
  await recordReady(ctx);
  const columns = ctx.db.table(addressNotes);
  for (let at = 0; at < keys.length; at += PAGE) {
    await ctx.db
      .delete(addressNotes)
      .where(inArray(columns.noteKey, keys.slice(at, at + PAGE)));
  }
}

// The move of an earlier version's record.

/** The note saying the earlier collection's rows have moved here. */
const MOVED_KEY = noteKey("record-moved");

/** What the earlier collection's rows are, as this module moves them. */
interface EarlierRow {
  claimKey: string;
  kind: string;
  locale: string;
  path: string;
  holderCollection: string | null;
  holderId: string | null;
  holderLabel: string | null;
}

function earlierRowOf(row: Record<string, unknown>): EarlierRow | undefined {
  const text = (value: unknown) => (typeof value === "string" ? value : null);
  const claimKey = text(row.claimKey);
  const kind = text(row.kind);
  if (claimKey === null || claimKey === "" || kind === null) return undefined;
  return {
    claimKey,
    kind,
    locale: text(row.locale) ?? "",
    path: text(row.path) ?? "",
    holderCollection: text(row.holderCollection),
    holderId: text(row.holderId),
    holderLabel: text(row.holderLabel),
  };
}

/**
 * Move the rows an earlier version kept in the record's collection here,
 * once: the held addresses and ranges to `seo__addresses`, and the notes and
 * pending moves to `seo__notes`. Lock rows are left: each is made again the
 * first time a save takes it. Answers how many rows moved.
 *
 * The copy and the note that it is done commit together, under the note's
 * lock, so two processes starting at once move the rows once: the second
 * waits, then finds the note. Nothing reads the collection afterwards and
 * nothing here writes it, so its rows are left in place rather than deleted,
 * and an address let go of here is never brought back from there.
 */
export async function moveEarlierRecord(ctx: PluginContext): Promise<number> {
  if (await moveDone(ctx.db, "none")) return 0;
  // Read before the transaction, on the pool: nothing writes the collection
  // any more, so what is read cannot change before the copy.
  const earlier = await readEarlier(ctx);
  // Two starts moving at once can deadlock on MySQL, where one is rolled
  // back: it then finds the other's move done, or tries again.
  for (let attempt = 1; ; attempt++) {
    try {
      return await copyEarlier(ctx, earlier);
    } catch (error) {
      if (await moveDone(ctx.db, "none")) return 0;
      if (attempt >= MOVE_ATTEMPTS) throw error;
    }
  }
}

/** Whether the note on `db` says the earlier record has moved. */
async function moveDone(db: Db, lock: RowLock): Promise<boolean> {
  const { notes } = await notesOn(db, [MOVED_KEY], false, lock);
  return notes.get(MOVED_KEY) === "moved";
}

/** Every row the earlier collection keeps but its lock rows. */
async function readEarlier(ctx: PluginContext): Promise<EarlierRow[]> {
  const earlier: EarlierRow[] = [];
  const slug = recordSlug(ctx);
  for (let page = 1; ; page++) {
    const { data } = await ctx.services.ownCollections.listEntries(slug, {
      where: { kind: { in: ["address", "range", "meta", "pending"] } },
      pagination: { limit: PAGE, page },
      sort: { field: "claimKey", direction: "asc" },
      depth: 0,
    });
    for (const row of data as Record<string, unknown>[]) {
      const each = earlierRowOf(row);
      if (each !== undefined) earlier.push(each);
    }
    if ((data as unknown[]).length < PAGE) return earlier;
  }
}

/** How many times a start tries the move before it fails. */
const MOVE_ATTEMPTS = 3;

/**
 * Copy `earlier` into the record's tables and note the move done, on one
 * transaction, under the note's lock; nothing where another start has.
 */
function copyEarlier(
  ctx: PluginContext,
  earlier: readonly EarlierRow[]
): Promise<number> {
  return ctx.db.transaction(async db => {
    const byKey = eq(db.table(addressNotes).noteKey, MOVED_KEY);
    // The note is made first, and taken where another start made it: on
    // MySQL an update finding no row locks the gap where it would be, and
    // two starts each holding that gap deadlock on their inserts. A start
    // that finds the note made waits for the one making it to end.
    const made = await insertUnlessTaken(ctx, db, addressNotes, {
      noteKey: MOVED_KEY,
      kind: "meta",
      value: "moving",
    });
    if (!made) {
      await db.update(addressNotes, { taken: increment(1) }).where(byKey);
      if (await moveDone(db, "update")) return 0;
    }
    const claims = earlier.filter(
      row => row.kind === "address" || row.kind === "range"
    );
    const notes = earlier.filter(
      row => row.kind === "meta" || row.kind === "pending"
    );
    for (let at = 0; at < claims.length; at += PAGE) {
      await db.insert(
        addressClaims,
        claims.slice(at, at + PAGE).map(row => ({
          claimKey: row.claimKey,
          kind: row.kind,
          locale: row.locale,
          path: row.path,
          holderCollection: row.holderCollection,
          holderId: row.holderId,
          holderLabel: row.holderLabel,
        }))
      );
    }
    for (let at = 0; at < notes.length; at += PAGE) {
      await db.insert(
        addressNotes,
        notes.slice(at, at + PAGE).map(row => ({
          noteKey: row.claimKey,
          kind: row.kind,
          value: noteValueOf(row),
        }))
      );
    }
    await db.update(addressNotes, { value: "moved" }).where(byKey);
    return claims.length + notes.length;
  });
}

/**
 * What an earlier note row keeps, as the notes table keeps it: a pending
 * move's page and address as JSON (the collection kept the page in its own
 * columns), and any other note's value as it was.
 */
function noteValueOf(row: EarlierRow): string {
  if (row.kind !== "pending") return row.path;
  return JSON.stringify({
    holder: { collection: row.holderCollection, id: row.holderId },
    address: safeJson(row.path),
  });
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Each context's move, kept beside the context so every copy of this module shares it. */
const moves = globalThis as unknown as {
  __nextly_seoAddressRecordMoves?: WeakMap<
    PluginContext,
    { started?: Promise<void>; outside: AsyncResource }
  >;
};

function moveOf(ctx: PluginContext) {
  moves.__nextly_seoAddressRecordMoves ??= new WeakMap();
  let move = moves.__nextly_seoAddressRecordMoves.get(ctx);
  if (move === undefined) {
    move = { outside: new AsyncResource("nextly-seo-address-record-move") };
    moves.__nextly_seoAddressRecordMoves.set(ctx, move);
  }
  return move;
}

/**
 * Note where the record's move may be started from: the plugin's `init`,
 * outside any request and any transaction. A move first asked for inside a
 * save still runs from there, on a transaction of its own, rather than as a
 * savepoint of the save's that would roll back with it.
 */
export function prepareRecordMove(ctx: PluginContext): void {
  moveOf(ctx);
}

/**
 * Wait until the earlier record has moved: started once per context, and
 * started again by the next caller after one that failed.
 */
export function recordReady(ctx: PluginContext): Promise<void> {
  const move = moveOf(ctx);
  if (move.started === undefined) {
    const started = move.outside.runInAsyncScope(() =>
      moveEarlierRecord(ctx).then(count => {
        if (count > 0) announceRecordChanged(ctx);
      })
    );
    move.started = started;
    started.catch((error: unknown) => {
      if (move.started === started) move.started = undefined;
      ctx.logger.error("The SEO plugin could not move its address record", {
        error,
      });
    });
  }
  return move.started;
}
