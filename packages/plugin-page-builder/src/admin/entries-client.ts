"use client";

/**
 * The relation control's read: a collection's entries, by title search or by
 * id, as `{ id, title }`.
 *
 * ## Why a promise rather than a hook
 *
 * The other clients in this folder are hooks over `usePluginRoute`, because
 * each reads one answer a surface holds for as long as it is mounted. This
 * read is driven by the author's typing: the control asks again on each pause,
 * abandons the previous question when a new one starts, and resolves a stored
 * id once. That is a function called with a query and a signal, which is the
 * shape `@nextlyhq/builder`'s content services lend, read through the SDK's
 * imperative `readPluginRoute`.
 *
 * ## What it does NOT do
 *
 * It decides nothing about access. The route reads as the signed-in author,
 * and a collection no registered block names as a relation target is refused
 * there. This hands over what the route answered.
 *
 * @module admin/entries-client
 */
import { readPluginRoute } from "@nextlyhq/plugin-sdk/admin";

// The CONTRACT, not the route: the route reaches the Direct API through
// `nextly/runtime`, which is server-only and says so at load time.
import {
  ENTRIES_LIMIT_MAX,
  entriesPath,
  type EntriesResponse,
  type EntryItem,
} from "../entries-contract";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";

/** Said when the route answered with something that is not a list of entries. */
const UNEXPLAINED = "Entries could not be loaded. Try again.";

/** What one read asks for. */
export interface FindEntriesQuery {
  /** The collection a relation prop points at (its `relationTo`). */
  readonly collection: string;
  /** Entries whose title holds this, ignoring case. */
  readonly search?: string;
  /** These entries by id, to name the ones a prop stores. */
  readonly ids?: readonly string[];
  /** How many to return; the route caps it at {@link ENTRIES_LIMIT_MAX}. */
  readonly limit?: number;
  /** Abandons the read, as a newer question replaces this one. */
  readonly signal?: AbortSignal;
  /** The language being edited, so titles are searched and named in it. */
  readonly locale?: string;
}

/**
 * Read a collection's entries through the page builder's entries route.
 *
 * Resolves with the entries the route returned — only those the author may
 * read, each with its id and its title — and REJECTS when the route refused or
 * failed, with the route's own message where it sent one. An empty list is an
 * answer ("nothing matches"), never a stand-in for a failure, so a control can
 * tell the two apart. An aborted read rejects with the abort, as `fetch` does.
 */
export async function findEntries(
  query: FindEntriesQuery
): Promise<readonly EntryItem[]> {
  // Through the admin's own route read, so an expired session is renewed and
  // the read retried rather than failing mid-search, and a refusal carries
  // the route's own message.
  const body = await readPluginRoute<EntriesResponse>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: entriesPath({
      collection: query.collection,
      ...(query.search === undefined ? {} : { search: query.search }),
      ...(query.ids === undefined ? {} : { ids: query.ids }),
      // Capped here too, so the request states what it will get rather than
      // relying on the route to quietly shorten it.
      ...(query.limit === undefined
        ? {}
        : { limit: Math.min(query.limit, ENTRIES_LIMIT_MAX) }),
      ...(query.locale === undefined ? {} : { locale: query.locale }),
    }),
    ...(query.signal === undefined ? {} : { signal: query.signal }),
  });
  return itemsOf(body);
}

/**
 * The items of a successful answer, each kept only when it is the shape the
 * contract promises.
 *
 * A successful answer that is not a list envelope is a route this client does
 * not understand, which is a failure rather than "no entries".
 */
function itemsOf(body: unknown): readonly EntryItem[] {
  const items =
    typeof body === "object" && body !== null
      ? (body as Partial<EntriesResponse>).items
      : undefined;
  if (!Array.isArray(items)) throw new Error(UNEXPLAINED);
  return items.flatMap((item: unknown) => {
    if (typeof item !== "object" || item === null) return [];
    const { id, title } = item as Record<string, unknown>;
    return typeof id === "string" && typeof title === "string"
      ? [{ id, title }]
      : [];
  });
}
