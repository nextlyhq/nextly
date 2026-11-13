/**
 * Keeping each page's content date as pages are saved: once a save of a
 * type SEO is added to commits, the page's published version is read in
 * every language it holds an address in, and its date moves only where its
 * content's fingerprint did. A deleted page's dates go with it.
 *
 * A draft, and a working draft of a published page, change nothing a
 * visitor sees, so their saves record nothing. A page with no row yet, as
 * every page has on the first save after the plugin is upgraded, is given
 * the date it already had where the save changed none of its content.
 *
 * @module content-dates/hooks
 */
import type { AddressHolder, PluginContext } from "@nextlyhq/plugin-sdk";

import { documentsIn, heldLanguages } from "../languages/versions";
import { typeOf } from "../outputs/listing";
import { isRecord } from "../plain-values";
import { idOf, onceDurable, type SavedContext } from "../problems/hooks";
import { singleKey } from "../problems/page-types";

import { contentFingerprint } from "./fingerprint";
import { forgetContentDates, hasContentDate, recordContentDate } from "./store";

/** A stored date read back, where it is one. */
function dateOf(value: unknown): Date | undefined {
  const date =
    value instanceof Date
      ? value
      : typeof value === "string" || typeof value === "number"
        ? new Date(value)
        : undefined;
  return date === undefined || Number.isNaN(date.getTime()) ? undefined : date;
}

/** Whether a save made a draft, which no visitor is served. */
function isDraft(context: SavedContext): boolean {
  return (
    isRecord(context.data) &&
    (context.data.status === "draft" || context.data._isWorkingDraft === true)
  );
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

/**
 * What a save that changed none of its page's content leaves its date at:
 * the version before the save, compared as the hook was handed both.
 * Undefined where it changed something, or nothing came before.
 */
function unchangedSince(context: SavedContext): UnchangedSince | undefined {
  const { data, originalData } = context;
  if (!isRecord(data) || !isRecord(originalData)) return undefined;
  if (contentFingerprint(data) !== contentFingerprint(originalData)) {
    return undefined;
  }
  // A save hook is handed the stored row, its stamps under their column
  // names.
  const date = dateOf(originalData.updatedAt ?? originalData.updated_at);
  const version = dateOf(data.updatedAt ?? data.updated_at);
  return date === undefined || version === undefined
    ? undefined
    : { date, version };
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
  for (const group of groups.values()) {
    const [first] = group;
    if (first === undefined) continue;
    const type = await typeOf(ctx, first.holder);
    // A page built in code has no document; its date is its route's.
    if (type === undefined) continue;
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
        await recordVersion(
          ctx,
          page.holder,
          page.language,
          document,
          undefined
        );
      }
    }
  }
}

/**
 * The recording waiting or running for each page, one after another, so two
 * saves of one page in this process record in the order they committed.
 */
const queue = new Map<string, Promise<void>>();

/** Every recording started so far, settled: what a reader waits on. */
export function contentDatesSettled(): Promise<void> {
  return Promise.all(queue.values()).then(() => undefined);
}

/**
 * Start `work` for `holder` once the save is durable and every recording
 * already queued for the page has settled, logging rather than throwing.
 */
function afterSave(
  ctx: PluginContext,
  context: SavedContext,
  holder: AddressHolder,
  work: () => Promise<void>
): void {
  onceDurable(context, () => {
    const key = `${holder.collection}\u0000${holder.id}`;
    const settled = (queue.get(key) ?? Promise.resolve())
      .then(work)
      .catch((error: unknown) => {
        // The save has committed; a date not kept leaves the page's last
        // known date, or its own save time, in the sitemap.
        ctx.logger.warn("A page's content date could not be kept", {
          error,
          collection: holder.collection,
          id: holder.id,
        });
      });
    queue.set(key, settled);
    void settled.then(() => {
      if (queue.get(key) === settled) queue.delete(key);
    });
  });
}

/** Keep the content dates of the pages of `collections` and `singles`. */
export function watchContentDates(
  ctx: PluginContext,
  types: { collections: readonly string[]; singles: readonly string[] }
): void {
  const saved = (collection: string) => (context: SavedContext) => {
    const id = idOf(context);
    if (id === undefined || isDraft(context)) return;
    const before = unchangedSince(context);
    const holder = { collection, id };
    afterSave(ctx, context, holder, () => recordSaved(ctx, holder, before));
  };
  for (const slug of types.collections) {
    ctx.hooks.on("afterCreate", slug, saved(slug));
    ctx.hooks.on("afterUpdate", slug, saved(slug));
    ctx.hooks.on("afterDelete", slug, (context: SavedContext) => {
      const id = idOf(context);
      if (id === undefined) return;
      const holder = { collection: slug, id };
      afterSave(ctx, context, holder, () => forgetContentDates(ctx, holder));
    });
  }
  // A Single's save is an update, its hooks named by its key; its pages are
  // held under the same key.
  for (const slug of types.singles) {
    ctx.hooks.on("afterUpdate", singleKey(slug), saved(singleKey(slug)));
  }
}
