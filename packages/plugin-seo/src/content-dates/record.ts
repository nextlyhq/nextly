/**
 * Keeping a page's content date from its published versions: after a save,
 * for every language it holds an address in, and at the full check for the
 * pages a publish reached no save hook for. Kept apart from the save hooks,
 * so the full check reads it without reading them.
 *
 * @module content-dates/record
 */
import type { AddressHolder, PluginContext } from "@nextlyhq/plugin-sdk";

import { documentsIn, heldLanguages } from "../languages/versions";
import { typeOf } from "../outputs/listing";

import { contentFingerprint } from "./fingerprint";
import { forgetContentDates, hasContentDate, recordContentDate } from "./store";

/** A stored date read back, where it is one. */
export function dateOf(value: unknown): Date | undefined {
  const date =
    value instanceof Date
      ? value
      : typeof value === "string" || typeof value === "number"
        ? new Date(value)
        : undefined;
  return date === undefined || Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * The date a page with no row yet already had, where a save changed none of
 * its content, and the version that save made it, by its save time.
 */
export interface UnchangedSince {
  /** When the version before the save was saved. */
  date: Date;
  /** When the save's own version was saved, which the date belongs to. */
  version: Date;
}

/** Whether two save times are one, as each dialect keeps them. */
function sameSave(left: Date | undefined, right: Date): boolean {
  return (
    left !== undefined &&
    Math.floor(left.getTime() / 1000) === Math.floor(right.getTime() / 1000)
  );
}

/** Keep the content date of one published version of `holder`. */
async function recordVersion(
  ctx: PluginContext,
  holder: AddressHolder,
  locale: string,
  document: Readonly<Record<string, unknown>>,
  before: UnchangedSince | undefined
): Promise<void> {
  const savedAt = dateOf(document.updatedAt);
  // A page's first row takes the date it already had where the save changed
  // none of its content, and only while the version read is the one that
  // save made: a later save, committed before this read, may have changed
  // it. Every other date is the save time of the version read.
  const kept =
    before !== undefined &&
    sameSave(savedAt, before.version) &&
    !(await hasContentDate(ctx, holder, locale));
  await recordContentDate(ctx, {
    holder,
    locale,
    fingerprint: contentFingerprint(document),
    changedAt: kept ? before.date : (savedAt ?? new Date()),
  });
}

/**
 * Record the content date of `holder`'s published version in every language
 * it holds an address in, forgetting any language it no longer holds one in.
 */
export async function recordSaved(
  ctx: PluginContext,
  holder: AddressHolder,
  before: UnchangedSince | undefined
): Promise<void> {
  const type = await typeOf(ctx, holder);
  if (type === undefined) return;
  const held = await heldLanguages(ctx, holder.collection, [holder.id]);
  const languages = [...(held.get(holder.id)?.keys() ?? [])];
  await forgetContentDates(ctx, holder, languages);
  for (const locale of languages) {
    const document = (await documentsIn(ctx, type, [holder.id], locale)).get(
      holder.id
    );
    if (document !== undefined) {
      await recordVersion(ctx, holder, locale, document, before);
    }
  }
}

/** How many pages the full check's catch-up reads at once. */
const REFRESH_BATCH = 100;

/** A listed version of a page, as the full check catches dates up for it. */
export interface ListedVersion {
  holder: AddressHolder;
  language: string;
}

/**
 * Catch up the content dates of `pages`, reading each type's published
 * versions a batch at a time: a publish no save hook was told of, such as
 * one made while the plugin did not run, moves its page's date to that
 * version's own save time, as its hook would have. Run with the full check,
 * never while a sitemap is read.
 */
export async function refreshContentDates(
  ctx: PluginContext,
  pages: readonly ListedVersion[]
): Promise<void> {
  const groups = new Map<string, ListedVersion[]>();
  for (const page of pages) {
    const key = `${page.holder.collection}\u0000${page.language}`;
    groups.set(key, [...(groups.get(key) ?? []), page]);
  }
  for (const group of groups.values()) await refreshGroup(ctx, group);
}

/** Catch up one type's pages in one language, a batch at a time. */
async function refreshGroup(
  ctx: PluginContext,
  group: readonly ListedVersion[]
): Promise<void> {
  const [first] = group;
  if (first === undefined) return;
  const type = await typeOf(ctx, first.holder);
  // A page built in code has no document; its date is its route's.
  if (type === undefined) return;
  for (let at = 0; at < group.length; at += REFRESH_BATCH) {
    const batch = group.slice(at, at + REFRESH_BATCH);
    const documents = await documentsIn(
      ctx,
      type,
      batch.map(page => page.holder.id),
      first.language
    );
    for (const page of batch) {
      const document = documents.get(page.holder.id);
      if (document === undefined) continue;
      await recordVersion(ctx, page.holder, page.language, document, undefined);
    }
  }
}
