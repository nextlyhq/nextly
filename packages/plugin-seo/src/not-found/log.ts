/**
 * The log of addresses that answered "not found": one row per address, with
 * how often and when it was first and last asked for, kept to a bounded size.
 *
 * Admin, API and asset requests never enter it, so it lists only addresses a
 * person or a search engine expected to be a page. Past its bound it keeps
 * the most recently and the most frequently asked-for addresses, so a flood
 * of distinct addresses pushes out neither the address asked for an hour ago
 * nor the one asked for a thousand times last month.
 *
 * Kept in the plugin's own table (`seo__not_found`), written through
 * `ctx.db`: a request for an address already logged is counted in one
 * statement, `hits = hits + 1`, which the database adds under the row's lock,
 * so requests arriving at once each count, in every process and on a
 * serverless start alike. This module is the only one that reads or writes
 * the table.
 *
 * @module not-found/log
 */
import { createHash } from "node:crypto";

import type { PluginContext } from "@nextlyhq/plugin-sdk";
import { desc, eq, inArray, increment } from "@nextlyhq/plugin-sdk/db";
import { isUniqueViolation } from "@nextlyhq/plugin-sdk/schema";

import { within } from "../address-record/rows";
import { notFoundLog } from "../schema/tables";

import { notFoundSlug } from "./collection";
import { notAPageAddress } from "./page-address";

/** The most addresses the log keeps once it is pruned. */
const NOT_FOUND_LIMIT = 1000;

/** How far past its limit the log grows before it is pruned again. */
const PRUNE_SLACK = 100;

/** How many rows one read takes. */
const PAGE = 200;

/** What a row of the log records about one address. */
export type NotFoundKind = "missing" | "moved";

/** A row of the log, read back. */
export interface LoggedRow {
  id: string;
  locale: string;
  /** The address as it is kept, by its language. */
  path: string;
  /** The address exactly as it was asked for, where that is known. */
  asked: string | null;
  hits: number;
  /** ISO text. */
  firstSeen: string;
  /** ISO text. */
  lastSeen: string;
  kind: NotFoundKind;
}

/** An address as it is kept: a language and a path. */
export interface LoggedAddress {
  locale: string;
  path: string;
  /** The address exactly as it was asked for, where it is known. */
  asked?: string;
}

/** The stored key of an address in a language. */
export function pathKey(address: LoggedAddress): string {
  return createHash("sha256")
    .update(`${address.locale}|${address.path}`, "utf8")
    .digest("hex");
}

/** A stored time as ISO text, whichever way the dialect hands it back. */
function isoOf(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : "";
}

/** A stored row read back, every column checked rather than trusted. */
function loggedRowOf(row: Record<string, unknown>): LoggedRow {
  return {
    id: String(row.id),
    locale: typeof row.locale === "string" ? row.locale : "",
    path: typeof row.path === "string" ? row.path : "",
    asked: typeof row.asked === "string" ? row.asked : null,
    hits: typeof row.hits === "number" ? row.hits : Number(row.hits ?? 0),
    firstSeen: isoOf(row.firstSeen),
    lastSeen: isoOf(row.lastSeen),
    kind: row.kind === "moved" ? "moved" : "missing",
  };
}

/**
 * Add `hits` more requests to the row for `key`, as of `lastSeen`: one
 * statement, the add made by the database. Answers whether the row was there.
 */
async function bumpLogged(
  ctx: PluginContext,
  key: string,
  lastSeen: Date,
  kind: NotFoundKind,
  hits: number = 1
): Promise<boolean> {
  const columns = ctx.db.table(notFoundLog);
  const changed = await ctx.db
    .update(notFoundLog, {
      hits: increment(hits),
      lastSeen,
      // An address a deploy moved stays listed as moved however it is
      // asked for afterwards.
      ...(kind === "moved" ? { kind } : {}),
    })
    .where(eq(columns.pathKey, key));
  return changed > 0;
}

/**
 * Count one more request for `path` that found nothing, or list it as an old
 * address a deploy moved without a redirect (`moved`). An address left out
 * of the log is ignored.
 *
 * An address already logged costs one statement. A first request costs an
 * update that changes nothing, the insert, and the count that decides on
 * pruning. Two first requests at once both count: the one whose insert the
 * unique key refuses adds its request to the row the other made.
 */
export async function recordNotFound(
  ctx: PluginContext,
  address: LoggedAddress,
  kind: NotFoundKind = "missing",
  now: Date = new Date(),
  bound: { limit: number; slack: number } = {
    limit: NOT_FOUND_LIMIT,
    slack: PRUNE_SLACK,
  }
): Promise<void> {
  if (notAPageAddress(address.path)) return;
  // `/gone/` is the address `/gone`, as redirects and the Proxy read it.
  if (address.path.length > 1 && address.path.endsWith("/")) {
    address = { ...address, path: address.path.slice(0, -1) };
  }
  const key = pathKey(address);
  if (await bumpLogged(ctx, key, now, kind)) return;
  try {
    await ctx.db.insert(notFoundLog, {
      pathKey: key,
      locale: address.locale,
      path: address.path,
      asked: address.asked ?? null,
      hits: 1,
      firstSeen: now,
      lastSeen: now,
      kind,
    });
  } catch (error) {
    // Another request made the row first: count this one on it.
    if (!isUniqueViolation(ctx.dialect, error)) throw error;
    await bumpLogged(ctx, key, now, kind);
    return;
  }
  if ((await ctx.db.select(notFoundLog).count()) > bound.limit + bound.slack) {
    await pruneNotFound(ctx, bound.limit);
  }
}

/**
 * Every row of the log, most asked for first, read `pageSize` rows at a
 * time. The log is bounded, so every row it keeps is read. The one read the
 * admin's Not found list, the overview and the problem list go through.
 */
export async function readNotFoundLog(
  ctx: PluginContext,
  pageSize: number = PAGE
): Promise<LoggedRow[]> {
  const columns = ctx.db.table(notFoundLog);
  const rows: LoggedRow[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await ctx.db
      .select(notFoundLog)
      .orderBy(desc(columns.hits), desc(columns.lastSeen), desc(columns.id))
      .limit(pageSize)
      .offset(offset)
      .all();
    rows.push(
      ...page.map(row => loggedRowOf(row as unknown as Record<string, unknown>))
    );
    if (page.length < pageSize) return rows;
  }
}

/**
 * Bring the log back to `limit`: keep the half most recently asked for and
 * the half most often asked for, an address asked for as often as another
 * kept where it was asked for more recently, and let the rest go. The log
 * is pruned at a small, bounded size, so its rows are read whole.
 */
export async function pruneNotFound(
  ctx: PluginContext,
  limit: number = NOT_FOUND_LIMIT
): Promise<void> {
  const rows = await readNotFoundLog(ctx);
  const half = Math.ceil(limit / 2);
  const recent = (a: LoggedRow, b: LoggedRow) =>
    Date.parse(b.lastSeen) - Date.parse(a.lastSeen);
  const keep = new Set([
    ...[...rows]
      .sort(recent)
      .slice(0, half)
      .map(row => row.id),
    ...[...rows]
      .sort((a, b) => b.hits - a.hits || recent(a, b))
      .slice(0, half)
      .map(row => row.id),
  ]);
  const gone = rows.filter(row => !keep.has(row.id)).map(row => row.id);
  const columns = ctx.db.table(notFoundLog);
  for (let at = 0; at < gone.length; at += PAGE) {
    await ctx.db
      .delete(notFoundLog)
      .where(inArray(columns.id, gone.slice(at, at + PAGE)));
  }
}

/**
 * Drop `address` from the log, as a redirect now answers it.
 *
 * Called inside the redirect's own transaction (`transaction` is its token):
 * `ctx.db.transaction` joins the transaction the calling flow is in, so the
 * row goes only if the redirect commits.
 */
export async function forgetNotFound(
  ctx: PluginContext,
  _transaction: Parameters<
    PluginContext["services"]["collections"]["deleteEntryInTransaction"]
  >[0],
  address: LoggedAddress
): Promise<void> {
  await ctx.db.transaction(async tx => {
    await tx
      .delete(notFoundLog)
      .where(eq(tx.table(notFoundLog).pathKey, pathKey(address)));
  });
}

/**
 * Drop every address at or below `base` in `locale` from the log, as a
 * pattern redirect now answers them all. Joins the redirect's transaction,
 * as {@link forgetNotFound} does.
 */
export async function forgetNotFoundUnder(
  ctx: PluginContext,
  _transaction: Parameters<
    PluginContext["services"]["collections"]["deleteEntryInTransaction"]
  >[0],
  locale: string,
  base: string
): Promise<void> {
  await ctx.db.transaction(async tx => {
    const columns = tx.table(notFoundLog);
    // The log is bounded, so the language's rows are read whole and only
    // those at or below `base` go, as `within` reads it.
    const candidates = await tx
      .select(notFoundLog)
      .where(eq(columns.locale, locale))
      .all();
    const gone = candidates
      .filter(row => within(row.path, base))
      .map(row => row.id);
    for (let at = 0; at < gone.length; at += PAGE) {
      await tx
        .delete(notFoundLog)
        .where(inArray(columns.id, gone.slice(at, at + PAGE)));
    }
  });
}

/** A stored time read back as a date, or `fallback` where it reads as none. */
function dateOf(value: unknown, fallback: Date): Date {
  const time =
    value instanceof Date ? value.getTime() : Date.parse(isoOf(value));
  return Number.isNaN(time) ? fallback : new Date(time);
}

/**
 * Move one row an earlier version kept in the log's collection to the table:
 * read under the row's lock and deleted on the same transaction, so of two
 * processes moving at once only one moves it. Where the table already logs
 * the address (a request since this version started), the counts are added
 * and the earlier first and the later last time kept. Answers whether this
 * call moved it.
 */
function moveOne(
  ctx: PluginContext,
  slug: string,
  id: string
): Promise<boolean> {
  return ctx.services.collections.withTransaction(async transaction => {
    const { data } = await ctx.services.ownCollections.listEntriesInTransaction(
      transaction,
      slug,
      {
        where: { id: { equals: id } },
        pagination: { limit: 1, page: 1 },
        depth: 0,
      },
      { lock: "update" }
    );
    const [held] = data as Record<string, unknown>[];
    if (held === undefined) return false;
    const row = loggedRowOf(held);
    const now = new Date();
    const lastSeen = dateOf(held.lastSeen, now);
    const firstSeen = dateOf(held.createdAt, lastSeen);
    const key =
      typeof held.pathKey === "string" && held.pathKey !== ""
        ? held.pathKey
        : pathKey({ locale: row.locale, path: row.path });
    // Joins the transaction the row is read and deleted on: the row moves
    // whole or not at all.
    await ctx.db.transaction(async tx => {
      const columns = tx.table(notFoundLog);
      const there = await tx
        .select(notFoundLog)
        .where(eq(columns.pathKey, key))
        .first();
      if (there === null) {
        await tx.insert(notFoundLog, {
          pathKey: key,
          locale: row.locale,
          path: row.path,
          asked: row.asked,
          hits: row.hits,
          firstSeen,
          lastSeen,
          kind: row.kind,
        });
        return;
      }
      await tx
        .update(notFoundLog, {
          hits: increment(row.hits),
          firstSeen: firstSeen < there.firstSeen ? firstSeen : there.firstSeen,
          lastSeen: lastSeen > there.lastSeen ? lastSeen : there.lastSeen,
          ...(row.kind === "moved" ? { kind: "moved" } : {}),
        })
        .where(eq(columns.id, there.id));
    });
    await ctx.services.collections.deleteEntryInTransaction(
      transaction,
      slug,
      id
    );
    return true;
  });
}

/**
 * Move every row an earlier version of the plugin kept in the not-found
 * log's collection to the plugin's table, and answer how many moved. Started
 * at each start, not awaited: once the collection is empty it costs one
 * count. The collection stays declared, so a site's rows are never dropped
 * with it; a row that cannot be moved now is left in place for the next
 * start.
 */
export async function moveLoggedRows(ctx: PluginContext): Promise<number> {
  const slug = notFoundSlug(ctx);
  if ((await ctx.services.ownCollections.count(slug)) === 0) return 0;
  let moved = 0;
  for (;;) {
    // Each moved row leaves the collection, so the first page is read again
    // until none is left.
    const { data } = await ctx.services.ownCollections.listEntries(slug, {
      pagination: { limit: PAGE, page: 1 },
      sort: { field: "pathKey", direction: "asc" },
      depth: 0,
    });
    const ids = (data as Record<string, unknown>[]).map(row => String(row.id));
    if (ids.length === 0) return moved;
    let movedNow = 0;
    for (const id of ids) {
      if (await moveOne(ctx, slug, id)) movedNow += 1;
    }
    moved += movedNow;
    // Another process moved this page's rows meanwhile, and will go on.
    if (movedNow === 0) return moved;
  }
}
