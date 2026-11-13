/**
 * The pages an author has opened in the editor most recently, newest first,
 * remembered in this browser per user, for the title switcher's "Recent".
 *
 * Kept under its own storage key rather than in the shell's preferences, so
 * writing one never rewrites the other.
 *
 * @module recent-pages
 */
import type { PreferenceStore } from "@nextlyhq/builder";
import { devicePreferenceStore } from "@nextlyhq/plugin-sdk/admin";
import { z } from "nextly/zod";

/** How many pages "Recent" offers. */
export const RECENT_PAGES_SHOWN = 5;

/** One page as "Recent" remembers it: enough to name it and open it again. */
export interface RecentPage {
  readonly collection: string;
  readonly id: string;
  readonly field: string;
  readonly title: string;
}

/** The storage key, one per user. */
const KEY = "nextly:page-builder:recent-pages";

/** What a stored list must be; anything else reads as no history. */
const storedSchema = z.array(
  z.object({
    collection: z.string(),
    id: z.string(),
    field: z.string(),
    title: z.string(),
  })
);

/**
 * The store for one user, or one that remembers nothing without a user. Kept
 * through the admin's preference store, so the site's switch that keeps
 * nothing on the device holds for it, and signing out forgets it.
 */
export function recentPagesStore(userId: string | null): PreferenceStore {
  return userId === null
    ? { read: () => null, write: () => undefined }
    : devicePreferenceStore(`${KEY}:${userId}`);
}

/** The remembered list, newest first; empty when there is none or it is unreadable. */
export function readRecentPages(store: PreferenceStore): RecentPage[] {
  return readStoredList(store, storedSchema);
}

/**
 * A list a store holds as JSON, read through `schema`: empty when there is
 * none, when the store refuses, or when what it holds is not that list.
 * Shared with the template preview's memory, which keeps its list the same
 * way.
 */
export function readStoredList<T>(
  store: PreferenceStore,
  schema: z.ZodType<T[]>
): T[] {
  try {
    const raw = store.read();
    if (raw === null) return [];
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

/** The same page, by its collection and id. */
function samePage(a: RecentPage, b: RecentPage): boolean {
  return a.collection === b.collection && a.id === b.id;
}

/**
 * The list with `page` first, any earlier entry for it removed, cut to one more
 * than "Recent" shows, so the page being edited can be left out and five
 * others still remain.
 */
export function withRecentPage(
  list: readonly RecentPage[],
  page: RecentPage
): RecentPage[] {
  return [page, ...list.filter(other => !samePage(other, page))].slice(
    0,
    RECENT_PAGES_SHOWN + 1
  );
}

/** What "Recent" offers: the remembered pages, without the one being edited. */
export function recentToOffer(
  list: readonly RecentPage[],
  current: Pick<RecentPage, "collection" | "id"> | null
): RecentPage[] {
  return list
    .filter(
      page =>
        current === null ||
        page.collection !== current.collection ||
        page.id !== current.id
    )
    .slice(0, RECENT_PAGES_SHOWN);
}

/** Remembers `page` as the most recent, swallowing a store that refuses. */
export function rememberPage(store: PreferenceStore, page: RecentPage): void {
  try {
    store.write(JSON.stringify(withRecentPage(readRecentPages(store), page)));
  } catch {
    // A full or refused store loses the history, never the editor.
  }
}
