"use client";

/**
 * The link control's read: the pages and entries a block can link to, by
 * title, through the pages search.
 *
 * A promise rather than a hook, for the reason `entries-client` gives: the
 * control asks again on each pause in typing and abandons the question a new
 * one replaces, which is a function called with a query and a signal.
 *
 * Read in collection order, so the plugin's own Pages come first and each
 * other page collection's entries follow together, the order the control
 * groups them in. A Pages item carries the address it is served at, which a
 * link stores; an entry of any other collection carries none, and is linked
 * by its reference where the block can hold one.
 *
 * It decides nothing about access: the route reads as the signed-in author
 * and lists only what they may open.
 *
 * @module admin/link-targets-client
 */
import { readPluginRoute } from "@nextlyhq/plugin-sdk/admin";

import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
// The CONTRACT, not the route: the route reaches the Direct API through
// `nextly/runtime`, which is server-only.
import {
  PAGES_SEARCH_LIMIT_MAX,
  pagesSearchPath,
  type PageItem,
  type PagesSearchResponse,
} from "../pages-search-contract";

/** Said when the route answered with something that is not a list of pages. */
const UNEXPLAINED = "Pages could not be searched. Try again.";

/** What one read asks for. */
export interface FindLinkTargetsQuery {
  /** Pages whose title holds this, ignoring case; empty for the first few. */
  readonly search: string;
  /** How many to return; the route caps it at {@link PAGES_SEARCH_LIMIT_MAX}. */
  readonly limit?: number;
  /** Abandons the read, as a newer question replaces this one. */
  readonly signal?: AbortSignal;
  /** The language being edited, so pages are searched and named in it. */
  readonly locale?: string;
}

/** One page or entry, as the link control lists it. */
export interface FoundLinkTarget {
  readonly id: string;
  readonly collection: string;
  /** The heading it is listed under: its collection's plural name. */
  readonly group: string;
  readonly title: string;
  readonly path?: string;
}

/**
 * Search the site's pages for a link.
 *
 * Resolves with the pages the route returned and REJECTS when it refused or
 * failed, so the control can tell "nothing matches" from "couldn't search".
 * An aborted read rejects with the abort, as `fetch` does.
 */
export async function findLinkTargets(
  query: FindLinkTargetsQuery
): Promise<readonly FoundLinkTarget[]> {
  const body = await readPluginRoute<PagesSearchResponse>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: pagesSearchPath({
      q: query.search.trim(),
      // Capped here too, so the request states what it will get.
      ...(query.limit === undefined
        ? {}
        : { limit: Math.min(query.limit, PAGES_SEARCH_LIMIT_MAX) }),
      order: "collection",
      ...(query.locale === undefined ? {} : { locale: query.locale }),
    }),
    ...(query.signal === undefined ? {} : { signal: query.signal }),
  });
  return targetsOf(body);
}

/**
 * {@link findLinkTargets} bound to the language being edited, as the editor
 * lends it: every search it makes reads and names pages in `locale`, and in
 * the default locale when there is none. One binding, so the language cannot
 * be forgotten at a call site.
 */
export function findLinkTargetsIn(
  locale: string | undefined
): (query: FindLinkTargetsQuery) => Promise<readonly FoundLinkTarget[]> {
  return query =>
    findLinkTargets(locale === undefined ? query : { ...query, locale });
}

/**
 * The items of a successful answer as link targets, each kept only when it
 * has the fields the contract promises. A successful answer that is not a
 * list envelope is a route this client does not understand: a failure, not
 * "no pages".
 */
function targetsOf(body: unknown): readonly FoundLinkTarget[] {
  const items =
    typeof body === "object" && body !== null
      ? (body as Partial<PagesSearchResponse>).items
      : undefined;
  if (!Array.isArray(items)) throw new Error(UNEXPLAINED);
  return items.flatMap((item: unknown) => {
    const target = targetOf(item);
    return target === undefined ? [] : [target];
  });
}

/** A non-empty string, or `undefined` for anything else. */
function named(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** One item as a link target, or `undefined` when it lacks a field the contract promises. */
function targetOf(item: unknown): FoundLinkTarget | undefined {
  if (typeof item !== "object" || item === null) return undefined;
  const fields = item as Partial<Record<keyof PageItem, unknown>>;
  const { id, collection, title } = fields;
  if (
    typeof id !== "string" ||
    typeof collection !== "string" ||
    typeof title !== "string"
  ) {
    return undefined;
  }
  // Headed by the plural name where the collection gives one ("Landing
  // pages"), its singular name where not, and its slug as a last resort.
  const group =
    named(fields.collectionPluralLabel) ??
    named(fields.collectionLabel) ??
    collection;
  const path = named(fields.path);
  return {
    id,
    collection,
    group,
    title,
    ...(path === undefined ? {} : { path }),
  };
}
