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
 * The date a page with no row yet already had, where the save changed none
 * of its content: the version before the save, compared as the hook was
 * handed both. Undefined where it changed something, or nothing came before.
 */
function unchangedSince(context: SavedContext): Date | undefined {
  const { data, originalData } = context;
  if (!isRecord(data) || !isRecord(originalData)) return undefined;
  return contentFingerprint(data) === contentFingerprint(originalData)
    ? dateOf(originalData.updatedAt)
    : undefined;
}

/**
 * Record the content date of `holder`'s published version in every language
 * it holds an address in, forgetting any language it no longer holds one in.
 */
export async function recordSaved(
  ctx: PluginContext,
  holder: AddressHolder,
  before: Date | undefined
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
    if (document === undefined) continue;
    const savedAt = dateOf(document.updatedAt) ?? new Date();
    // A page's first row takes the date it already had where this save
    // changed none of its content; every later one moves to the save that
    // changed it.
    const first = !(await hasContentDate(ctx, holder, locale));
    await recordContentDate(ctx, {
      holder,
      locale,
      fingerprint: contentFingerprint(document),
      changedAt: first && before !== undefined ? before : savedAt,
    });
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
