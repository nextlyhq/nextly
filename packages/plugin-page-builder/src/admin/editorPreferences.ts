"use client";

/**
 * Where this editor's chrome preferences live, and what they start as.
 *
 * The shell opens no left panel by default — `leftPanel: null`. That is right for
 * an editor whose author already knows the document, and wrong on first contact
 * with a page builder, where the block library IS the way to begin. Before the
 * shell existed, the library was a permanently visible pane; a default of "no
 * panel" would have hidden it behind a rail button an author has no reason to
 * press yet.
 *
 * Expressed through the shell's own preference port rather than a new prop. The
 * port already lets a host decide what "nothing stored yet" means, so seeding a
 * first-run value needs no API: `readPreferences` falls back to the shell's
 * defaults only when `read()` answers null, and this answers with a seed
 * instead.
 *
 * Once the author opens or closes a panel the shell writes through, and their
 * choice wins from then on — including closing the library, which persists.
 *
 * @module admin/editorPreferences
 */

import type { PreferenceStore } from "@nextlyhq/builder";

/**
 * The plugin's own storage key.
 *
 * Distinct from the shell's default so that a host embedding several editors, or
 * a future standalone builder alongside this one, does not silently share one
 * set of panel widths between surfaces that are not the same surface.
 */
const STORAGE_KEY = "nextly.page-builder.shell";

/**
 * What the shell sees before the author has expressed any preference.
 *
 * Only the keys this plugin means to override. Everything else the shell fills
 * from its own defaults, so this does not have to track fields it has no opinion
 * about — and a field added to `ShellPreferences` later does not silently
 * acquire a value from here.
 */
const FIRST_RUN = JSON.stringify({ leftPanel: "insert" });

/**
 * A store that seeds the block library open, then gets out of the way.
 *
 * Returns a store that forgets when there is no `window`, so a server render is a
 * default rather than a crash — the same shape the shell's own fallback uses.
 */
export function editorPreferenceStore(): PreferenceStore {
  if (typeof window === "undefined") {
    return { read: () => FIRST_RUN, write: () => undefined };
  }
  return {
    read: () => window.localStorage.getItem(STORAGE_KEY) ?? FIRST_RUN,
    write: value => window.localStorage.setItem(STORAGE_KEY, value),
  };
}
