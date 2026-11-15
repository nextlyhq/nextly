/**
 * Bringing the fingerprints an earlier release kept up to the current
 * reading, once, before saves can rewrite what they were taken from.
 *
 * An earlier release fingerprinted a field group's rows with their ids and
 * stamps. A save that sends a group back unchanged rewrites those rows, after
 * which nothing can tell whether the fingerprint kept then still matches the
 * content: the stamps it was taken from are gone. So each kept fingerprint
 * that matches its page's published content as that release read it is
 * given the current one while the rows still hold those stamps, its date
 * left as it is. Run after the plugin starts; a note makes every later start
 * one read.
 *
 * @module content-dates/upgrade
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";
import { and, asc, eq } from "@nextlyhq/plugin-sdk/db";

import { noteKey, putNote, readNotes } from "../address-record/store";
import { documentsIn } from "../languages/versions";
import { typeOf } from "../outputs/listing";
import { contentDates } from "../schema/tables";

import { contentFingerprint, earlierContentFingerprints } from "./fingerprint";

/** The note naming the reading every kept fingerprint has been brought to. */
export const FINGERPRINT_READING_KEY: string = noteKey("content-dates:reading");

/**
 * The reading `contentFingerprint` takes; changed with it, so a site's kept
 * fingerprints are brought up to date again.
 */
const CURRENT_READING = "field-group-rows-without-bookkeeping";

/** How many kept rows one read takes. */
const PAGE = 100;

/** A kept row, as this pass reads it. */
interface KeptRow {
  pageKey: string;
  collection: string;
  id: string;
  locale: string;
  fingerprint: string;
}

/** `row` as this pass reads it. */
function keptRowOf(row: Record<string, unknown>): KeptRow {
  return {
    pageKey: String(row.pageKey),
    collection: String(row.holderCollection),
    id: String(row.holderId),
    locale: String(row.locale),
    fingerprint: String(row.fingerprint),
  };
}

/**
 * Give `row` the current fingerprint of `document`, its page's published
 * content, where it holds the one an earlier release kept for it. The write
 * names the fingerprint it replaces, so a save recorded meanwhile keeps its
 * own.
 */
async function bringRowUpToDate(
  ctx: PluginContext,
  row: KeptRow,
  document: Readonly<Record<string, unknown>>
): Promise<void> {
  if (!earlierContentFingerprints(document).includes(row.fingerprint)) return;
  const columns = ctx.db.table(contentDates);
  const held = and(
    eq(columns.pageKey, row.pageKey),
    eq(columns.fingerprint, row.fingerprint)
  );
  if (held === undefined) return;
  await ctx.db
    .update(contentDates, { fingerprint: contentFingerprint(document) })
    .where(held);
}

/** `rows` by their page's type and language, each group read at once. */
function byTypeAndLanguage(rows: readonly KeptRow[]): KeptRow[][] {
  const groups = new Map<string, KeptRow[]>();
  for (const row of rows) {
    const key = `${row.collection}\u0000${row.locale}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()];
}

/** Bring each of `rows`, of one type and language, up to date. */
async function bringGroupUpToDate(
  ctx: PluginContext,
  rows: readonly KeptRow[]
): Promise<void> {
  const [first] = rows;
  if (first === undefined) return;
  const type = await typeOf(ctx, first);
  if (type === undefined) return;
  const documents = await documentsIn(
    ctx,
    type,
    rows.map(row => row.id),
    first.locale
  );
  for (const row of rows) {
    const document = documents.get(row.id);
    if (document !== undefined) await bringRowUpToDate(ctx, row, document);
  }
}

/**
 * Bring every kept fingerprint to the current reading, unless a note says
 * it has been; the note is kept once every row has been read.
 */
export async function upgradeKeptFingerprints(
  ctx: PluginContext
): Promise<void> {
  const { notes } = await readNotes(ctx, [FINGERPRINT_READING_KEY]);
  const noted = notes.get(FINGERPRINT_READING_KEY);
  if (noted === CURRENT_READING) return;
  const columns = ctx.db.table(contentDates);
  for (let offset = 0; ; offset += PAGE) {
    const rows = (await ctx.db
      .select(contentDates)
      .orderBy(asc(columns.id))
      .limit(PAGE)
      .offset(offset)
      .all()) as unknown as Record<string, unknown>[];
    for (const group of byTypeAndLanguage(rows.map(keptRowOf))) {
      await bringGroupUpToDate(ctx, group);
    }
    if (rows.length < PAGE) break;
  }
  await putNote(ctx, FINGERPRINT_READING_KEY, CURRENT_READING, {
    absent: noted === undefined,
  });
}

/** The pass the last start began, to wait for. */
let started: Promise<void> | undefined;

/**
 * Start `upgradeKeptFingerprints`, not awaited by the start: it reads
 * published pages, which waits for the boot to finish. A failure is logged,
 * and the next start tries again.
 */
export function startFingerprintUpgrade(ctx: PluginContext): Promise<void> {
  started = upgradeKeptFingerprints(ctx).catch((error: unknown) => {
    ctx.logger.error(
      "The SEO plugin could not bring its kept content fingerprints up to date",
      { error }
    );
  });
  return started;
}

/** The pass the last start began, to wait for. */
export function lastFingerprintUpgrade(): Promise<void> | undefined {
  return started;
}
