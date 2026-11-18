/**
 * What the floating format bar shows, and what it acts on: the one passage
 * being edited in the shared rich-text editor, while that passage is one the
 * bar serves.
 *
 * ONE store for the admin, because there is one editor: a caret is in one
 * place, so at most one passage has a bar. The surface that opens a passage
 * publishes it here; the bar, drawn over the canvas, reads it. Neither holds
 * the other.
 *
 * Plain state and a subscription, no React, so the rules are asserted without
 * a browser and the bar reads it with `useSyncExternalStore`.
 *
 * @module format-bar-state
 */

import type { TurnIntoOffer } from "../turn-into-verb";

/** One thing the bar offers. */
export type FormatAction = "bold" | "italic" | "link" | "turnInto";

/**
 * What the bar offers a Text: bold, italic, a link, and "Turn into".
 *
 * Configured per block rather than drawn as one fixed row, so a passage that
 * holds more (headings, lists) is offered more by the same bar. "Turn into"
 * keeps its place in the list and is drawn only once a host can turn a block
 * into another.
 */
export const TEXT_FORMAT_ACTIONS: readonly FormatAction[] = [
  "bold",
  "italic",
  "link",
  "turnInto",
];

/** What the selection in the passage holds. */
export interface FormatSelection {
  readonly collapsed: boolean;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly link: { readonly url: string; readonly newTab: boolean } | null;
}

/** The editor's hold on the passage, as the bar uses it. */
export interface FormatSession {
  format(mark: "bold" | "italic"): void;
  link(url: string | null, options?: { readonly newTab?: boolean }): void;
  selection(): FormatSelection | undefined;
  /** Put the caret back in the passage, where it was. */
  focus(): void;
}

/** The passage the bar serves. */
export interface FormatTarget {
  /** The element being edited, which the bar is placed against. */
  readonly element: HTMLElement;
  readonly session: FormatSession;
  readonly actions: readonly FormatAction[];
  /** Finish the edit, as leaving the passage does. */
  readonly finish: () => void;
  /** Turn the block into another; absent where the host cannot. */
  readonly turnInto?: FormatTurnInto;
}

/**
 * "Turn into" for the block whose words are being edited: the types it can
 * become, asked when the choices open, and the turn itself, which finishes
 * the edit first so the words typed are what is turned.
 */
export interface FormatTurnInto {
  readonly choices: () => readonly TurnIntoOffer[];
  readonly run: (to: string) => void;
}

/** Everything the bar draws from. */
export interface FormatBarSnapshot {
  readonly target: FormatTarget | null;
  readonly selection: FormatSelection | null;
  /** The address field is open, by the Link button or ⌘K. */
  readonly linking: boolean;
  /** The "Turn into" choices are open, by the Turn into button. */
  readonly turning: boolean;
  /** A change (a paste) lost what the passage cannot hold. */
  readonly dropped: boolean;
  /** Raised to ask the bar to take the focus, as Alt+F10 does. */
  readonly focusRequest: number;
}

const EMPTY: FormatBarSnapshot = {
  target: null,
  selection: null,
  linking: false,
  turning: false,
  dropped: false,
  focusRequest: 0,
};

/** The store's surface. */
export interface FormatBarStore {
  readonly get: () => FormatBarSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  /** Serve a passage, replacing whichever was served. */
  readonly open: (target: FormatTarget) => void;
  /** Stop serving this passage; a later one already served is kept. */
  readonly close: (element: HTMLElement) => void;
  readonly selected: (selection: FormatSelection) => void;
  readonly setLinking: (open: boolean) => void;
  readonly setTurning: (open: boolean) => void;
  readonly setDropped: (dropped: boolean) => void;
  readonly requestFocus: () => void;
  /**
   * Whether the focus is in the bar on the passage's behalf, so the
   * passage's blur does not finish the edit: an author moving to a button or
   * the address field is still editing.
   */
  readonly holdsFocus: () => boolean;
  readonly setHoldsFocus: (held: boolean) => void;
}

/** A fresh store; the admin's one is {@link formatBar}. */
export function createFormatBarStore(): FormatBarStore {
  let snapshot = EMPTY;
  let focusHeld = false;
  const listeners = new Set<() => void>();
  const set = (next: Partial<FormatBarSnapshot>): void => {
    snapshot = { ...snapshot, ...next };
    for (const listener of [...listeners]) listener();
  };
  return {
    get: () => snapshot,
    subscribe: listener => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    open: target => {
      focusHeld = false;
      set({ ...EMPTY, target, focusRequest: snapshot.focusRequest });
    },
    close: element => {
      if (snapshot.target?.element !== element) return;
      focusHeld = false;
      set({ ...EMPTY, focusRequest: snapshot.focusRequest });
    },
    selected: selection => {
      if (snapshot.target === null) return;
      set({ selection });
    },
    setLinking: linking => {
      if (snapshot.target === null || snapshot.linking === linking) return;
      set({ linking });
    },
    setTurning: turning => {
      if (snapshot.target === null || snapshot.turning === turning) return;
      set({ turning });
    },
    setDropped: dropped => {
      if (snapshot.target === null || snapshot.dropped === dropped) return;
      set({ dropped });
    },
    requestFocus: () => {
      if (snapshot.target === null) return;
      set({ focusRequest: snapshot.focusRequest + 1 });
    },
    holdsFocus: () => focusHeld,
    setHoldsFocus: held => {
      focusHeld = held;
    },
  };
}

/** The admin's one bar, for its one editor. */
export const formatBar: FormatBarStore = createFormatBarStore();

/**
 * Whether the bar is shown: words are selected, or the address field or the
 * "Turn into" choices are open, or the bar holds the focus.
 */
export function formatBarShown(state: FormatBarSnapshot): boolean {
  if (state.target === null) return false;
  return state.linking || state.turning || state.selection?.collapsed === false;
}
