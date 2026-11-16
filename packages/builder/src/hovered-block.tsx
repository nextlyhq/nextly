"use client";

/**
 * Which block the author is pointing at from outside the canvas, so the canvas
 * can outline it.
 *
 * Layers sets it while the pointer is over a row, and the canvas marks read
 * it: hovering a row outlines its block on the page, which is how an author
 * finds which of five "Text" rows is the one they mean. One value for every
 * surface that points at a block, so a canvas hover style drawn later reads
 * the same answer rather than a second one.
 *
 * **Held outside React state on purpose.** The pointer crosses rows far more
 * often than anything else in the editor changes, and a value held in the
 * editor's state would re-render the whole editor, the canvas included, on
 * every row it crossed. Here only the two readers re-render: the row being
 * left and entered, and the marks.
 *
 * @module hovered-block
 */
import * as React from "react";

/** The hovered block, readable and writable by any surface under one editor. */
export interface HoveredBlock {
  /** The block pointed at, or `null` for none. */
  readonly get: () => string | null;
  /** Point at a block, or at nothing with `null`. */
  readonly set: (id: string | null) => void;
  /** Be told when it changes; answers the unsubscribe. */
  readonly subscribe: (listener: () => void) => () => void;
}

/** A fresh holder, pointing at nothing. */
function createHoveredBlock(): HoveredBlock {
  let current: string | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set: id => {
      if (id === current) return;
      current = id;
      listeners.forEach(listener => listener());
    },
    subscribe: listener => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * What a surface outside any editor reads: nothing hovered, and a set that
 * goes nowhere, so a panel or the marks drawn alone in a test still work.
 */
const NOWHERE: HoveredBlock = {
  get: () => null,
  set: () => undefined,
  subscribe: () => () => undefined,
};

const HoveredBlockContext = React.createContext<HoveredBlock>(NOWHERE);

/**
 * Shares one hovered block with everything under it: the panels and the
 * canvas of one editor. A host with two editors gives each its own.
 */
export function HoveredBlockProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [hovered] = React.useState(createHoveredBlock);
  return (
    <HoveredBlockContext.Provider value={hovered}>
      {children}
    </HoveredBlockContext.Provider>
  );
}

/** The holder, to point at a block. */
export function useHoveredBlockSetter(): HoveredBlock["set"] {
  return React.useContext(HoveredBlockContext).set;
}

/** The block pointed at, re-rendering when it changes. */
export function useHoveredBlock(): string | null {
  const hovered = React.useContext(HoveredBlockContext);
  return React.useSyncExternalStore(hovered.subscribe, hovered.get, () => null);
}
