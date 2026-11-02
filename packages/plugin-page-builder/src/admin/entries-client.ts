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
 * shape `@nextlyhq/builder`'s content services lend — and the plugin SDK
 * offers no imperative route read, so this one calls the route itself.
 *
 * ## What it does NOT do
 *
 * It decides nothing about access. The route reads as the signed-in author,
 * and a collection no registered block names as a relation target is refused
 * there. This hands over what the route answered.
 *
 * @module admin/entries-client
 */
import { pluginRouteFullPath } from "nextly/config";

// The CONTRACT, not the route: the route reaches the Direct API through
// `nextly/runtime`, which is server-only and says so at load time.
import {
  ENTRIES_LIMIT_MAX,
  entriesPath,
  type EntriesResponse,
  type EntryItem,
} from "../entries-contract";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";

/**
 * Where the admin's API answers, relative to the origin.
 *
 * The same prefix the admin's own fetcher builds every request on: a
 * scaffolded app mounts the Nextly handler at `/admin/api/[[...params]]`, and
 * the plugin route then answers at `/admin/api/plugins/<name><path>`.
 */
const ADMIN_API_PREFIX = "/admin/api";

/**
 * Said when the route answered with a failure and no message of its own, or
 * the request never reached it. In the author's terms rather than the
 * network's, because "Failed to fetch" describes the program.
 */
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
  const path = pluginRouteFullPath(
    PAGE_BUILDER_PLUGIN_NAME,
    entriesPath({
      collection: query.collection,
      ...(query.search === undefined ? {} : { search: query.search }),
      ...(query.ids === undefined ? {} : { ids: query.ids }),
      // Capped here too, so the request states what it will get rather than
      // relying on the route to quietly shorten it.
      ...(query.limit === undefined
        ? {}
        : { limit: Math.min(query.limit, ENTRIES_LIMIT_MAX) }),
    })
  );
  const response = await fetch(`${ADMIN_API_PREFIX}${path}`, {
    method: "GET",
    // The admin session travels as a cookie, as every admin read sends it.
    credentials: "include",
    headers: { accept: "application/json" },
    ...(query.signal === undefined ? {} : { signal: query.signal }),
  });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error(failureMessage(body));
  return itemsOf(body);
}

/**
 * The message the route's error envelope carries, or the fallback.
 *
 * Errors arrive as `{ error: { code, message, ... } }`; the message is the
 * route's public one, phrased for a person, so it is shown as sent.
 */
function failureMessage(body: unknown): string {
  if (typeof body !== "object" || body === null) return UNEXPLAINED;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return UNEXPLAINED;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message !== "" ? message : UNEXPLAINED;
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
