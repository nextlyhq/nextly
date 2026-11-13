/**
 * When each page's published content last changed, kept in the plugin's
 * `content_dates` table: read a batch at a time by the listing, written only
 * after a save commits.
 *
 * A record never moves a date for a fingerprint it already holds, so a save
 * recorded twice, or two saves of one page recorded at once, leave one row
 * with one answer: the first insert wins the unique key, and every later
 * write is an update that changes the row only where the fingerprint
 * differs.
 *
 * @module content-dates/store
 */
import type { AddressHolder, PluginContext } from "@nextlyhq/plugin-sdk";
import { and, asc, eq, inArray, ne } from "@nextlyhq/plugin-sdk/db";
import { isUniqueViolation } from "@nextlyhq/plugin-sdk/schema";

import { sha256 } from "../address-record/rows";
import { heldLanguages } from "../languages/versions";
import { contentDates } from "../schema/tables";

/** How many pages one read or delete names. */
const PAGE = 100;

/** The key a page's row in one language is stored under. */
export function pageDateKey(holder: AddressHolder, locale: string): string {
  return sha256(`${holder.collection}|${holder.id}|${locale}`);
}

/** A stored date, as ISO text. */
function isoOf(value: unknown): string | undefined {
  const date =
    value instanceof Date
      ? value
      : typeof value === "string" || typeof value === "number"
        ? new Date(value)
        : undefined;
  return date === undefined || Number.isNaN(date.getTime())
    ? undefined
    : date.toISOString();
}

/**
 * When the published content of each of `ids` last changed in `locale`, by
 * id, as ISO text: one read for the batch. A page with no row is missing
 * from the answer, and its reader falls back to its own last save.
 */
export async function readContentDates(
  ctx: PluginContext,
  collection: string,
  ids: readonly string[],
  locale: string
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const columns = ctx.db.table(contentDates);
  for (let at = 0; at < ids.length; at += PAGE) {
    const keys = ids
      .slice(at, at + PAGE)
      .map(id => pageDateKey({ collection, id }, locale));
    const rows = await ctx.db
      .select(contentDates)
      .where(inArray(columns.pageKey, keys))
      .all();
    for (const row of rows as unknown as Record<string, unknown>[]) {
      const changed = isoOf(row.changedAt);
      if (changed !== undefined && row.holderCollection === collection) {
        found.set(String(row.holderId), changed);
      }
    }
  }
  return found;
}

/** What a save found for one version of a page. */
export interface ContentDate {
  holder: AddressHolder;
  locale: string;
  fingerprint: string;
  /**
   * When the content changed, where the fingerprint is not the one kept:
   * the published version's own save time, so a record repeated later
   * writes the same date.
   */
  changedAt: Date;
}

/**
 * Keep `date` for its page: a new row where there is none, the fingerprint
 * and date where the row holds another fingerprint, and nothing where it
 * holds this one.
 */
export async function recordContentDate(
  ctx: PluginContext,
  date: ContentDate
): Promise<void> {
  const columns = ctx.db.table(contentDates);
  const key = pageDateKey(date.holder, date.locale);
  const moveIfChanged = () =>
    ctx.db
      .update(contentDates, {
        fingerprint: date.fingerprint,
        changedAt: date.changedAt,
      })
      .where(
        and(
          eq(columns.pageKey, key),
          ne(columns.fingerprint, date.fingerprint)
        ) ?? eq(columns.pageKey, key)
      );
  const existing = await ctx.db
    .select(contentDates)
    .where(eq(columns.pageKey, key))
    .first();
  if (existing !== null) {
    await moveIfChanged();
    return;
  }
  try {
    await ctx.db.insert(contentDates, {
      pageKey: key,
      holderCollection: date.holder.collection,
      holderId: date.holder.id,
      locale: date.locale,
      fingerprint: date.fingerprint,
      changedAt: date.changedAt,
    });
  } catch (error) {
    // Another save of the page made the row first: this one moves it only
    // where it found other content.
    if (!isUniqueViolation(ctx.dialect, error)) throw error;
    await moveIfChanged();
  }
}

/** Whether `holder` has a row in `locale`. */
export async function hasContentDate(
  ctx: PluginContext,
  holder: AddressHolder,
  locale: string
): Promise<boolean> {
  const columns = ctx.db.table(contentDates);
  const row = await ctx.db
    .select(contentDates)
    .where(eq(columns.pageKey, pageDateKey(holder, locale)))
    .first();
  return row !== null;
}

/**
 * Forget `holder`'s rows, in every language or only those not in `keep`:
 * a deleted page leaves none, and a language it is no longer published in
 * leaves none for it.
 */
export async function forgetContentDates(
  ctx: PluginContext,
  holder: AddressHolder,
  keep: readonly string[] = []
): Promise<void> {
  const columns = ctx.db.table(contentDates);
  const rows = (await ctx.db
    .select(contentDates)
    .where(
      and(
        eq(columns.holderCollection, holder.collection),
        eq(columns.holderId, holder.id)
      ) ?? eq(columns.holderId, holder.id)
    )
    .all()) as unknown as Record<string, unknown>[];
  const gone = rows
    .filter(row => !keep.includes(String(row.locale)))
    .map(row => String(row.pageKey));
  for (let at = 0; at < gone.length; at += PAGE) {
    await ctx.db
      .delete(contentDates)
      .where(inArray(columns.pageKey, gone.slice(at, at + PAGE)));
  }
}

/** The keys of `rows` whose page holds no address in the row's language. */
async function orphanKeys(
  ctx: PluginContext,
  rows: readonly Record<string, unknown>[]
): Promise<string[]> {
  const byCollection = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const collection = String(row.holderCollection);
    byCollection.set(collection, [
      ...(byCollection.get(collection) ?? []),
      row,
    ]);
  }
  const gone: string[] = [];
  for (const [collection, ofType] of byCollection) {
    const held = await heldLanguages(
      ctx,
      collection,
      ofType.map(row => String(row.holderId))
    );
    for (const row of ofType) {
      const languages = held.get(String(row.holderId));
      if (languages?.has(String(row.locale)) !== true) {
        gone.push(String(row.pageKey));
      }
    }
  }
  return gone;
}

/**
 * Forget every row whose page no longer holds an address in its language:
 * a page deleted while the plugin did not run, or a language a page left.
 * Run with the full site check, a batch of rows at a time, so the table
 * never keeps rows nothing will read.
 */
export async function pruneContentDates(ctx: PluginContext): Promise<void> {
  const columns = ctx.db.table(contentDates);
  for (let offset = 0; ; ) {
    const rows = (await ctx.db
      .select(contentDates)
      .orderBy(asc(columns.id))
      .limit(PAGE)
      .offset(offset)
      .all()) as unknown as Record<string, unknown>[];
    const gone = await orphanKeys(ctx, rows);
    if (gone.length > 0) {
      await ctx.db.delete(contentDates).where(inArray(columns.pageKey, gone));
    }
    if (rows.length < PAGE) return;
    // The rows kept move up past those deleted.
    offset += rows.length - gone.length;
  }
}
