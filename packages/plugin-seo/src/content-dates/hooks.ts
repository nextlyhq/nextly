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

import { isRecord } from "../plain-values";
import { idOf, onceDurable, type SavedContext } from "../problems/hooks";
import { singleKey } from "../problems/page-types";

import { contentFingerprint } from "./fingerprint";
import { dateOf, recordSaved, type UnchangedSince } from "./record";
import { forgetContentDates } from "./store";

/** Whether a save made a draft, which no visitor is served. */
function isDraft(context: SavedContext): boolean {
  return (
    isRecord(context.data) &&
    (context.data.status === "draft" || context.data._isWorkingDraft === true)
  );
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
  types: {
    readonly collections: readonly string[];
    readonly singles: readonly string[];
  }
): void {
  // Heard on every type and kept to the ones with SEO as each save is made,
  // as the problem list's hooks are, so a type that gets SEO after the plugin
  // started is followed too. A collection's pages are held under its slug, a
  // Single's under its hook key (`single:<slug>`), the key its save names.
  const collectionOf = (context: SavedContext) => {
    const key = context.collection;
    return key !== undefined && types.collections.includes(key)
      ? key
      : undefined;
  };
  const keyOf = (context: SavedContext) =>
    collectionOf(context) ??
    (types.singles.some(slug => singleKey(slug) === context.collection)
      ? context.collection
      : undefined);
  const saved = (context: SavedContext) => {
    const collection = keyOf(context);
    const id = idOf(context);
    if (collection === undefined || id === undefined || isDraft(context)) {
      return;
    }
    const before = unchangedSince(context);
    const holder = { collection, id };
    afterSave(ctx, context, holder, () => recordSaved(ctx, holder, before));
  };
  // A Single is never created or deleted by a person: its save is an update.
  ctx.hooks.on("afterCreate", "*", saved);
  ctx.hooks.on("afterUpdate", "*", saved);
  ctx.hooks.on("afterDelete", "*", (context: SavedContext) => {
    const collection = collectionOf(context);
    const id = idOf(context);
    if (collection === undefined || id === undefined) return;
    const holder = { collection, id };
    afterSave(ctx, context, holder, () => forgetContentDates(ctx, holder));
  });
}
