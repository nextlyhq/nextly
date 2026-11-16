/**
 * Which entry each template was last previewed with, remembered per person
 * for the browser session, so reopening a template previews the entry the
 * author left it on.
 *
 * Kept as the title switcher keeps its recent pages (`recent-pages.ts`): a
 * `PreferenceStore` per user, under a key of its own, read through a schema
 * so anything unreadable is no memory. In the session's storage rather than
 * the browser's, since which entry a template is previewed with is a
 * working choice, not a preference worth keeping past the session.
 *
 * @module template-preview-memory
 */
import type { PreferenceStore } from "@nextlyhq/builder";
import { devicePreferenceStore } from "@nextlyhq/plugin-sdk/admin";
import { z } from "nextly/zod";

import { readStoredList } from "./recent-pages";

/** The storage key, one per user. */
const KEY = "nextly:page-builder:template-preview";

/** How many templates are remembered: more than a session opens. */
const REMEMBERED = 50;

/** What a stored memory must be: template id to entry id, newest last. */
const storedSchema = z.array(z.tuple([z.string(), z.string()]));

/** A store that remembers nothing, without a user or a session's storage. */
const NOTHING: PreferenceStore = { read: () => null, write: () => undefined };

/**
 * The store for one user, or one that remembers nothing without a user. Kept
 * for the tab through the admin's preference store, so the site's switch
 * that keeps nothing on the device holds for it, and signing out forgets it.
 */
export function templatePreviewStore(userId: string | null): PreferenceStore {
  if (userId === null || typeof window === "undefined") return NOTHING;
  return devicePreferenceStore(`${KEY}:${userId}`, { lifetime: "tab" });
}

/** Every remembered pair, oldest first; none when unreadable. */
function readAll(store: PreferenceStore): [string, string][] {
  return readStoredList(store, storedSchema);
}

/** The entry `template` was last previewed with, if one is remembered. */
export function rememberedEntry(
  store: PreferenceStore,
  template: string
): string | undefined {
  return readAll(store).find(([held]) => held === template)?.[1];
}

/**
 * Remember `entry` for `template`, or forget the template's entry where
 * `entry` is `null`. A store that refuses loses the memory, never the editor.
 */
export function rememberEntry(
  store: PreferenceStore,
  template: string,
  entry: string | null
): void {
  const others = readAll(store).filter(([held]) => held !== template);
  const next =
    entry === null
      ? others
      : [...others, [template, entry] as [string, string]].slice(-REMEMBERED);
  try {
    store.write(JSON.stringify(next));
  } catch {
    // A full or refused store forgets; the editor previews the most recent.
  }
}
