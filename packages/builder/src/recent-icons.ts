/**
 * The icons an author chose last, newest first, for the Icon control's
 * "Recent" row. Kept by the host's store (one per signed-in author), read
 * and written here, so the picker itself remembers nothing.
 *
 * @module recent-icons
 */
import * as React from "react";

import type { PreferenceStore } from "./shell-state";

/** How many icons are remembered: the picker's one Recent row. */
const REMEMBERED = 8;

/** The stored text as it is read, or `null` for none or a store that refuses. */
function storedText(store: PreferenceStore | undefined): string | null {
  if (store === undefined) return null;
  try {
    return store.read();
  } catch {
    return null;
  }
}

/** The ids a stored text holds, newest first; empty for none or anything else. */
function idsIn(raw: string | null): readonly string[] {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed
          .filter((id): id is string => typeof id === "string")
          .slice(0, REMEMBERED)
      : [];
  } catch {
    return [];
  }
}

/** The remembered ids, newest first; empty when there are none or they are unreadable. */
export function readRecentIcons(
  store: PreferenceStore | undefined
): readonly string[] {
  return idsIn(storedText(store));
}

/**
 * Remembers `id` as the newest, an earlier mention of it removed, and answers
 * the list now kept. A store that refuses the write (private browsing, a full
 * quota) still answers the list, so this session's Recent row is right.
 */
export function rememberIcon(
  store: PreferenceStore | undefined,
  list: readonly string[],
  id: string
): readonly string[] {
  const next = [id, ...list.filter(other => other !== id)].slice(0, REMEMBERED);
  try {
    store?.write(JSON.stringify(next));
  } catch {
    // Nothing to do: the row is remembered for this session only.
  }
  return next;
}

/*
 * Who is drawing each store's list, so a choice made in one Icon control
 * reaches every other one on screen at once: one list, read from the store,
 * rather than one copy per control.
 */
const watchers = new WeakMap<PreferenceStore, Set<() => void>>();

/*
 * The list each store holds for this session, as last remembered: what the
 * controls draw. Kept beside the store rather than read back from it, so a
 * store that refuses the write (private browsing, a full quota) still shows
 * the choice under Recent for the rest of the session, in every control.
 */
const sessionLists = new WeakMap<PreferenceStore, string>();

function watch(store: PreferenceStore, onChange: () => void): () => void {
  const set = watchers.get(store) ?? new Set<() => void>();
  watchers.set(store, set);
  set.add(onChange);
  return () => {
    set.delete(onChange);
  };
}

/**
 * The author's recent icons from the host's store, and a way to remember a
 * choice. Every control drawing the same store reads the same list: a
 * choice in one is remembered in the store and redraws them all.
 */
export function useRecentIcons(
  store: PreferenceStore | undefined
): readonly [readonly string[], (id: string) => void] {
  // The stored text is the snapshot: a string compares by value, so React
  // redraws only when the list changed.
  const raw = React.useSyncExternalStore(
    React.useCallback(
      (onChange: () => void) =>
        store === undefined ? () => undefined : watch(store, onChange),
      [store]
    ),
    () =>
      store === undefined
        ? null
        : (sessionLists.get(store) ?? storedText(store)),
    () => null
  );
  const list = React.useMemo(() => idsIn(raw), [raw]);
  const remember = React.useCallback(
    (id: string) => {
      if (store === undefined) return;
      const current = sessionLists.get(store) ?? storedText(store);
      const next = rememberIcon(store, idsIn(current), id);
      sessionLists.set(store, JSON.stringify(next));
      for (const onChange of watchers.get(store) ?? []) onChange();
    },
    [store]
  );
  return [list, remember] as const;
}
