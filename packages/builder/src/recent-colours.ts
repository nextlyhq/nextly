/**
 * Recent colours: the last colours an author typed or picked, newest first,
 * offered by every colour picker in the builder after the site's colour
 * variables. A convenience of the author's own, never part of the site: the
 * host keeps it in its store for that author, provided here once, so a block's
 * picker and a variable's picker read the one list.
 *
 * Eight, each once, newest first, written as the Icon control writes its
 * recent icons. Unlike that list there is no copy held for the session: the
 * host's store holds the list for the page itself where storage refuses.
 *
 * @module recent-colours
 */
import { isRawColour } from "@nextlyhq/blocks-engine";
import * as React from "react";

import { readRecentIcons, rememberIcon } from "./recent-icons";
import type { PreferenceStore } from "./shell-state";

/**
 * Where the host keeps this author's Recent colours. Absent, the pickers show
 * an empty list and remember nothing.
 */
export const RecentColoursStore: React.Context<PreferenceStore | undefined> =
  React.createContext<PreferenceStore | undefined>(undefined);

/**
 * The colour to remember for a value written, or `undefined` for one that is
 * not a colour of its own: a variable, `var()`, a keyword that borrows a
 * colour, or nothing. Kept as it was written, so a recent colour is stored in
 * the form the author typed it.
 */
function rememberable(value: unknown): string | undefined {
  if (typeof value !== "string" || !isRawColour(value)) return undefined;
  return value.trim();
}

/*
 * Who is drawing each store's list, so a colour remembered in one picker
 * reaches every other on screen at once.
 */
const watchers = new WeakMap<PreferenceStore, Set<() => void>>();

function watch(
  store: PreferenceStore | undefined,
  onChange: () => void
): () => void {
  if (store === undefined) return () => undefined;
  const set = watchers.get(store) ?? new Set<() => void>();
  watchers.set(store, set);
  set.add(onChange);
  return () => {
    set.delete(onChange);
  };
}

/** The stored text, or `null` for none or a store that refuses to read. */
function storedText(store: PreferenceStore | undefined): string | null {
  try {
    return store?.read() ?? null;
  } catch {
    return null;
  }
}

/**
 * Remember a value just written, as the newest of the author's Recent
 * colours, and redraw every picker reading the list. Anything but a raw
 * colour, and any value without a store, is ignored.
 */
export function rememberColour(
  store: PreferenceStore | undefined,
  value: unknown
): void {
  const colour = rememberable(value);
  if (store === undefined || colour === undefined) return;
  rememberIcon(store, readRecentIcons(store), colour);
  for (const onChange of watchers.get(store) ?? []) onChange();
}

/** A store that reads back one text, for reading a snapshot by the same rules. */
const textStore = (text: string | null): PreferenceStore => ({
  read: () => text,
  write: () => undefined,
});

/**
 * The author's Recent colours, newest first, and a way to remember a value
 * just written; anything but a raw colour is ignored.
 */
export function useRecentColours(): readonly [
  readonly string[],
  (value: unknown) => void,
] {
  const store = React.useContext(RecentColoursStore);
  // The stored text is the snapshot: a string compares by value, so a picker
  // redraws only when the list changed.
  const raw = React.useSyncExternalStore(
    React.useCallback(
      (onChange: () => void) => watch(store, onChange),
      [store]
    ),
    () => storedText(store),
    () => null
  );
  // Read by the rule it was written by, so nothing else under the key is
  // offered as a colour.
  const colours = React.useMemo(
    () =>
      readRecentIcons(textStore(raw)).filter(
        colour => rememberable(colour) !== undefined
      ),
    [raw]
  );
  const remember = React.useCallback(
    (value: unknown) => rememberColour(store, value),
    [store]
  );
  return [colours, remember] as const;
}
