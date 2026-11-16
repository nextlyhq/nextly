/**
 * The values a content route's code supplied for each page, read and kept:
 * recorded as the page's head is answered (`route-values/record`), read back
 * by the SEO tab, bulk edit and the problem list as the page's code level.
 *
 * A page is named by its content type's key (a collection's slug, or
 * `single:<slug>`), its id, and the language its head was answered in. A
 * Single has one page in each language, so its id is not part of its name.
 *
 * @module route-values/store
 */
import {
  NextlyError,
  type PageMetadataValues,
  type PluginContext,
} from "@nextlyhq/plugin-sdk";

import { sha256 } from "../address-record/rows";
import { codeValuesOf, sortedJson } from "../code-pages/store";
import { isRecord, textOf } from "../plain-values";

import { routeValuesSlug } from "./collection";

/** One page in one language, as its route's values are kept. */
export interface RouteValuesPage {
  /** The content type's key: a collection's slug, or `single:<slug>`. */
  type: string;
  /** The page's id; ignored for a Single, which has one page. */
  id: string;
  /** The language its head was answered in, as the site names it. */
  language: string;
}

/** The id a page is kept under: none for a Single, which has one page. */
function keptId(page: RouteValuesPage): string {
  return page.type.startsWith("single:") ? "" : page.id;
}

/** The key one page in one language is kept under. */
export function routeValuesKey(page: RouteValuesPage): string {
  return sha256(`${page.type}\u0000${keptId(page)}\u0000${page.language}`);
}

/** A stored row, read loosely. */
interface StoredRow {
  id: string;
  key: string;
  values: PageMetadataValues;
}

function rowOf(entry: unknown): StoredRow | undefined {
  if (!isRecord(entry)) return undefined;
  const key = textOf(entry.pageKey);
  if (key === undefined) return undefined;
  return {
    id: String(entry.id),
    key,
    values: codeValuesOf(entry.codeValues),
  };
}

/** How many keys one read asks for. */
const READ_CHUNK = 100;

/** The stored rows of `keys`, by key, read in chunks. */
async function rowsOf(
  ctx: PluginContext,
  keys: readonly string[]
): Promise<Map<string, StoredRow>> {
  const found = new Map<string, StoredRow>();
  const unique = [...new Set(keys)];
  for (let at = 0; at < unique.length; at += READ_CHUNK) {
    const chunk = unique.slice(at, at + READ_CHUNK);
    const { data } = await ctx.services.ownCollections.listEntries(
      routeValuesSlug(ctx),
      {
        where: { pageKey: { in: chunk } },
        pagination: { limit: chunk.length, page: 1 },
        depth: 0,
      }
    );
    for (const entry of data as unknown[]) {
      const row = rowOf(entry);
      if (row !== undefined) found.set(row.key, row);
    }
  }
  return found;
}

/**
 * What each of `pages` last had supplied by its route's code, by
 * {@link routeValuesKey}: one read for them all, and nothing for a page
 * whose route never supplied a value.
 *
 * A read that fails, such as on a database not yet migrated to hold these
 * rows, answers nothing and is logged: the views reading it then show the
 * page without its code level, as they did before it was kept, rather than
 * fail to open.
 */
export async function readRouteValues(
  ctx: PluginContext,
  pages: readonly RouteValuesPage[]
): Promise<Map<string, PageMetadataValues>> {
  if (pages.length === 0) return new Map();
  try {
    const rows = await rowsOf(ctx, pages.map(routeValuesKey));
    return new Map([...rows].map(([key, row]) => [key, row.values]));
  } catch (error) {
    ctx.logger.warn("What pages' routes supply in code could not be read", {
      error,
    });
    return new Map();
  }
}

/** What the route of the one page `page` last supplied, or nothing. */
export async function routeValuesOf(
  ctx: PluginContext,
  page: RouteValuesPage
): Promise<PageMetadataValues> {
  return (await readRouteValues(ctx, [page])).get(routeValuesKey(page)) ?? {};
}

/** Change the row `id` to hold `values`. */
async function rewrite(
  ctx: PluginContext,
  id: string,
  values: PageMetadataValues
): Promise<void> {
  // Applied over whatever version is current: the row is the plugin's own
  // bookkeeping, never edited beside it.
  await ctx.services.collections.updateEntry(routeValuesSlug(ctx), id, {
    codeValues: values,
    _overwrite: true,
  });
}

/**
 * Keep `values` as what the route of `page` supplies. Written only where it
 * changes the row, so a route answering again writes nothing, and a page
 * whose route supplies nothing and never did gets no row. One read of the
 * row each time: a page's head is cached by core, so this runs only when
 * the head is worked out again, not on every visit.
 */
export async function recordRouteValues(
  ctx: PluginContext,
  page: RouteValuesPage,
  values: PageMetadataValues
): Promise<void> {
  const key = routeValuesKey(page);
  const kept = codeValuesOf(values);
  const json = sortedJson(kept);
  const row = (await rowsOf(ctx, [key])).get(key);
  if (row !== undefined) {
    if (sortedJson(row.values) !== json) await rewrite(ctx, row.id, kept);
  } else if (Object.keys(kept).length > 0) {
    try {
      await ctx.services.collections.createEntry(routeValuesSlug(ctx), {
        pageKey: key,
        type: page.type,
        pageId: keptId(page),
        language: page.language,
        codeValues: kept,
      });
    } catch (error) {
      // Another request made the row first: change that one.
      if (!NextlyError.isCode(error, "DUPLICATE")) throw error;
      const made = (await rowsOf(ctx, [key])).get(key);
      if (made === undefined) throw error;
      await rewrite(ctx, made.id, kept);
    }
  }
}
