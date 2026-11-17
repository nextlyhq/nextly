/**
 * The shell's preferences: read from the author's store, held while the shell
 * is open, and written back only when one has changed.
 *
 * @module shell-preferences
 */
import * as React from "react";

import type { CanvasZoom } from "./canvas-zoom";
import {
  DEFAULT_PREFERENCES,
  readPreferences,
  writePreferences,
  type PreferenceStore,
  type ShellPreferences,
} from "./shell-state";

/**
 * What the newest completed read of a preference store left behind.
 *
 * TWO fields because there are two different questions downstream, and one
 * value cannot answer both:
 *
 * - `count` answers "has a NEW record arrived", which is what a remount is
 *   keyed on. Any read qualifies: the panel group has to re-register against
 *   whatever layout landed, whoever it belongs to.
 * - `store` answers "whose record is `preferences` holding right now", which is
 *   what any guard protecting a WRITE needs. The count cannot answer it — it is
 *   monotonic, so it is already nonzero for the previous store the moment a host
 *   swaps in a new one, and a write let through in that window spreads the old
 *   store's record and persists it into the new store, replacing the layout and
 *   the zoom of whichever user or workspace the new store belongs to.
 *
 * `store` is the store OBJECT rather than a name or an index, for the reason
 * the identity is already the read's dependency: it is the thing itself, and no
 * two live stores can compare equal without being the same store.
 *
 * `null` is the state before any read has completed, and it is deliberately not
 * a fourth thing to test for: every caller compares this against the store it
 * is about to act on, and `null` is not any store, so "no read yet" and "a
 * different store's read" answer alike without either being spelled out.
 */
interface PreferencesLoad {
  readonly count: number;
  readonly store: PreferenceStore | null;
}

/** Before any read has reached state. */
const NO_LOAD: PreferencesLoad = { count: 0, store: null };

/**
 * Preferences, restored AFTER mount and written back whenever they change.
 *
 * Reading storage in the initializer is the obvious shape and it is wrong here.
 * On a server render the default store answers `null`, so the server emits the
 * defaults; the client initializer reads `localStorage` and emits a restored
 * panel. React 19 treats that divergence as a hydration failure and rebuilds
 * the subtree — so a returning author's restored layout arrives as a flash and
 * a discarded tree rather than as a layout.
 *
 * Both first renders therefore start from the defaults, and the stored
 * preferences are applied in an effect. The cost is one frame of default
 * chrome; the alternative is a mismatch on every load for anyone who has ever
 * moved a panel.
 */
export function usePreferences(
  store: PreferenceStore
): readonly [
  ShellPreferences,
  (change: (current: ShellPreferences) => ShellPreferences) => void,
  number,
  boolean,
] {
  const [preferences, setPreferences] =
    React.useState<ShellPreferences>(DEFAULT_PREFERENCES);
  const [load, setLoad] = React.useState<PreferencesLoad>(NO_LOAD);

  React.useEffect(() => {
    const restored = readPreferences(store);
    // Compared before setting so a host with no stored preferences does not
    // take a second render for a value that did not change.
    setPreferences(current =>
      shallowEqualPreferences(current, restored) ? current : restored
    );
    // Set in the SAME effect as the preferences it describes, which is what
    // makes `store` below an honest account of whose record `preferences`
    // holds: React applies both updates in one commit, so no render can see
    // one without the other.
    setLoad(current => ({ count: current.count + 1, store }));
  }, [store]);

  // The newest preferences, reachable from a callback that must not go stale.
  const latest = React.useRef(preferences);
  latest.current = preferences;

  /**
   * Takes a CHANGE rather than a value, and this is load-bearing.
   *
   * `react-resizable-panels` calls `onLayoutChanged` once a drag settles, from
   * a handler React captured when the panel was rendered. Handed a whole
   * record built by spreading `preferences` from that render, a drag begun
   * before an unrelated change would write the OLD record back with only the
   * layout replaced — silently discarding whichever field moved in between.
   *
   * Measured, not theorised: opening a panel and then dragging its separator
   * wrote `leftPanel: null` back over the open panel, so the panel vanished on
   * the next load. jsdom cannot see this — its inert `ResizeObserver` means
   * `onLayoutChanged` never fires there — which is why it took a browser.
   */
  const update = React.useCallback(
    (change: (current: ShellPreferences) => ShellPreferences) => {
      const next = change(latest.current);
      latest.current = next;
      setPreferences(next);
      writePreferences(store, next);
    },
    [store]
  );

  /*
   * The store-specific answer is derived HERE rather than handed out for a
   * caller to work out, because the comparison is only sound against the same
   * store the read was keyed on — and that is this argument. Returning
   * `load.store` instead would leave every caller re-deriving it, and a caller
   * holding a different store variable (the shell resolves a fallback of its
   * own) would compare the wrong pair while looking correct.
   */
  return [preferences, update, load.count, load.store === store] as const;
}

/**
 * Whether two preference records say the same thing.
 *
 * EVERY field has to be compared here, because this is what the restore
 * effect gates on: a field missing from this function reads as "unchanged"
 * for any two records that differ only in it, so a stored non-default value
 * for that field is silently dropped on mount whenever the rest of the record
 * already matches the default — which a fresh session with nothing else
 * customised does by construction.
 *
 * The layout is compared by its entries rather than by identity: `readPreferences`
 * builds a fresh object every call, so identity is always false and the restore
 * effect would set state on every mount even when nothing changed.
 */
/** Whether two zooms mean the same thing, which is not object identity. */
function sameZoom(a: CanvasZoom, b: CanvasZoom): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === "fixed" && b.kind === "fixed" ? a.scale === b.scale : true;
}

/**
 * The preferences compared by value. Listed once, so a field added to
 * `ShellPreferences` is compared by adding it here; one left out reads as
 * "unchanged" and is dropped on load. `zoom` and `layouts` are compared below.
 */
const SCALAR_PREFERENCES = [
  "leftPanel",
  "leftPanelView",
  "leftPanelHidden",
  "inspectorHidden",
  "leftPinned",
  "panelKeys",
  "editingBreakpoint",
] as const satisfies readonly (keyof ShellPreferences)[];

function shallowEqualPreferences(
  a: ShellPreferences,
  b: ShellPreferences
): boolean {
  if (SCALAR_PREFERENCES.some(key => a[key] !== b[key])) return false;
  if (!sameZoom(a.zoom, b.zoom)) return false;
  if (a.layouts === b.layouts) return true;
  const topologies = Object.keys(a.layouts);
  if (topologies.length !== Object.keys(b.layouts).length) return false;
  return topologies.every(topology => {
    const left = a.layouts[topology];
    const right = b.layouts[topology];
    if (left === undefined || right === undefined) return false;
    const ids = Object.keys(left);
    return (
      ids.length === Object.keys(right).length &&
      ids.every(id => left[id] === right[id])
    );
  });
}
