/**
 * When a page's content last changed, for the site's own code: its own
 * sitemap, or a page's `article:modified_time`. The same date the plugin's
 * sitemap and structured data give it (`lastChangedOf`), so a save that
 * changed only a page's SEO moves none of them, where the entry's own
 * `updatedAt`, which every save moves, would.
 *
 * ```ts
 * import { seoLastChanged } from "@nextlyhq/plugin-seo";
 *
 * const modified = await seoLastChanged({ collection: "posts", entry: post });
 * const dates = await seoLastChanged({ collection: "posts", entries: posts });
 * dates.get(post.id);
 * ```
 *
 * @module content-dates/seo-last-changed
 */
import {
  failRenderWhenUnavailable,
  NextlyError,
  type PluginContext,
} from "@nextlyhq/plugin-sdk";

import { startedSeoContext } from "../code-pages/metadata";
import { textOf } from "../plain-values";
import { singleKey } from "../problems/page-types";

import { lastChangedOf } from "./last-changed";
import { readContentDates } from "./store";

/**
 * An entry as the site's code read it: its id, and its own last save. Any
 * document Nextly hands back fits, typed or not.
 */
export interface SeoLastChangedEntry {
  /** The entry's id. One that is no string or number has no content date. */
  readonly id?: unknown;
  /**
   * The entry's own last save, as Nextly reads it: the date given where the
   * plugin keeps no content date for it.
   */
  readonly updatedAt?: unknown;
}

/**
 * Whose dates {@link seoLastChanged} reads: entries of one collection, or a
 * Single, and the language they are read in.
 */
export type SeoLastChangedOptions = (
  | { readonly collection: string; readonly single?: never }
  | { readonly single: string; readonly collection?: never }
) & {
  /**
   * The language the pages are read in, where the site serves several.
   * Defaults to the site's default language.
   */
  readonly locale?: string;
};

/**
 * The key the save hooks keep `options`' dates under: a collection's slug,
 * or a Single's `single:<slug>`.
 *
 * @throws NextlyError when `options` name neither a collection nor a Single,
 * or both.
 */
function holderOf(options: SeoLastChangedOptions): string {
  const collection = textOf(options.collection);
  const single = textOf(options.single);
  if ((collection === undefined) === (single === undefined)) {
    throw NextlyError.invalidInput({
      message:
        'seoLastChanged: name one collection or one Single, such as { collection: "posts" } or { single: "home" }.',
      logContext: { collection: options.collection, single: options.single },
    });
  }
  return collection ?? singleKey(single ?? "");
}

/** `entry`'s id as its content dates are kept under, where it has one. */
function idOf(entry: SeoLastChangedEntry): string | undefined {
  const { id } = entry;
  return typeof id === "string" || typeof id === "number"
    ? String(id)
    : undefined;
}

/**
 * The content dates kept for `ids`: one read per hundred
 * entries. None where the SEO plugin is not running here, or the dates
 * could not be read, so each entry takes its own last save; a production
 * render fails instead where Nextly is unavailable, as the page's head does.
 */
async function keptDates(
  holder: string,
  ids: readonly string[],
  locale: string | undefined
): Promise<Map<string, string>> {
  let ctx: PluginContext | undefined;
  try {
    ctx = await startedSeoContext();
  } catch (error) {
    failRenderWhenUnavailable(error);
    return new Map();
  }
  if (ctx === undefined || ids.length === 0) return new Map();
  try {
    return await readContentDates(
      ctx,
      holder,
      ids,
      locale ?? (await ctx.publicAddresses.defaultLanguage())
    );
  } catch (error) {
    failRenderWhenUnavailable(error);
    ctx.logger.error(
      "Content dates could not be read, so entries are dated by their own last save",
      { collection: holder, error }
    );
    return new Map();
  }
}

/**
 * When an entry's published content last changed, as ISO text: the date the
 * SEO plugin keeps for it, else its own `updatedAt`, exactly as the plugin's
 * sitemap and structured data date it. None where neither is a date. Use it
 * for your own sitemap's `lastModified`, or a page's
 * `openGraph.modifiedTime`, in place of `updatedAt`, which every save moves,
 * an SEO-only one included.
 *
 * Give `entries` rather than `entry` for many at once, such as a sitemap's:
 * the answer is a map from each entry's id to its date, read in one query
 * per hundred entries rather than one per entry. An entry with no date is
 * left out of it.
 *
 * Where the SEO plugin is not running, each entry is dated by its own
 * `updatedAt`. Where Nextly is unavailable while a page is rendered for
 * production, `next build` included, it throws, as the page's head does.
 *
 * @example
 * ```ts
 * import { seoLastChanged } from "@nextlyhq/plugin-seo";
 *
 * const modified = await seoLastChanged({ collection: "posts", entry: post });
 * ```
 *
 * @throws NextlyError when the options name neither a collection nor a
 * Single, or both.
 *
 * @experimental Its name and shape may change before 1.0.
 */
export function seoLastChanged(
  options: SeoLastChangedOptions & { readonly entry: SeoLastChangedEntry }
): Promise<string | undefined>;
export function seoLastChanged<Entry extends SeoLastChangedEntry>(
  options: SeoLastChangedOptions & { readonly entries: readonly Entry[] }
): Promise<Map<Entry["id"], string>>;
export async function seoLastChanged(
  options: SeoLastChangedOptions & {
    readonly entry?: SeoLastChangedEntry;
    readonly entries?: readonly SeoLastChangedEntry[];
  }
): Promise<string | undefined | Map<unknown, string>> {
  const holder = holderOf(options);
  const { entry, entries } = options;
  const asked = entries ?? (entry === undefined ? [] : [entry]);
  const kept = await keptDates(
    holder,
    asked.map(each => idOf(each)).filter(id => id !== undefined),
    options.locale
  );
  const dates = new Map<unknown, string>();
  for (const each of asked) {
    const id = idOf(each);
    const date = lastChangedOf(id === undefined ? undefined : kept.get(id), {
      updatedAt: each.updatedAt,
    });
    if (date !== undefined) dates.set(each.id, date);
  }
  return entries === undefined
    ? entry === undefined
      ? undefined
      : dates.get(entry.id)
    : dates;
}
