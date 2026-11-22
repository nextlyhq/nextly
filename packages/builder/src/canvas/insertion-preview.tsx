"use client";

/**
 * Where the tile highlighted in the Add panel would put its block, so the
 * canvas can draw it.
 *
 * The panel sets it while a tile is pointed at or has the keyboard's
 * highlight, and the canvas's insertion line reads it: the line on the page
 * at the very place a click would use, with the panel's own words.
 *
 * **Held outside React state on purpose**, as the hovered block is: the
 * pointer crosses tiles far more often than anything else in the editor
 * changes, and a value in the editor's state would re-render the editor, the
 * page included, on every tile it crossed. Here only the line re-renders.
 *
 * @module insertion-preview
 */
import * as React from "react";

import type { OpPosition } from "../op-vocabulary";

import {
  createValueHolder,
  nowhereHolder,
  type ValueHolder,
} from "./value-holder";

/** A highlighted tile's place, as the canvas draws it. */
export interface InsertionPreview {
  /** Where a click on the tile puts its block. */
  readonly at: OpPosition;
  /** The words for it, "Heading goes inside Hero, at the end". */
  readonly words: string;
}

/** Whether two previews name the same place in the same words. */
function samePreview(a: InsertionPreview, b: InsertionPreview): boolean {
  return (
    a.words === b.words &&
    a.at.index === b.at.index &&
    a.at.parentId === b.at.parentId &&
    a.at.slot === b.at.slot
  );
}

const InsertionPreviewContext =
  React.createContext<ValueHolder<InsertionPreview>>(nowhereHolder());

/**
 * Shares one preview with everything under it: the Add panel and the canvas
 * of one editor. A host with two editors gives each its own.
 */
export function InsertionPreviewProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [holder] = React.useState(() =>
    createValueHolder<InsertionPreview>(samePreview)
  );
  return (
    <InsertionPreviewContext.Provider value={holder}>
      {children}
    </InsertionPreviewContext.Provider>
  );
}

/** The highlighted tile's place, re-rendering when it changes. */
export function useInsertionPreview(): InsertionPreview | null {
  const holder = React.useContext(InsertionPreviewContext);
  return React.useSyncExternalStore(holder.subscribe, holder.get, () => null);
}

/**
 * How long a preview outlasts the highlight that set it: the pointer crossing
 * from one tile to the next, or off the tiles and back, does not make the
 * line blink.
 */
export const PREVIEW_GRACE_MS = 150;

/**
 * Hands `preview` to the canvas while it is set. A new one replaces the old
 * at once; going to nothing waits {@link PREVIEW_GRACE_MS} first, and a new
 * one inside that wait cancels it. Unmounting clears it at once: the panel
 * closing takes its line with it. A preview equal to the one held changes
 * nothing, so a caller may build it afresh on every render.
 */
export function usePublishInsertionPreview(
  preview: InsertionPreview | null
): void {
  const holder = React.useContext(InsertionPreviewContext);
  React.useEffect(() => {
    if (preview !== null) {
      holder.set(preview);
      return undefined;
    }
    const wait = setTimeout(() => holder.set(null), PREVIEW_GRACE_MS);
    return () => clearTimeout(wait);
  }, [holder, preview]);
  React.useEffect(() => () => holder.set(null), [holder]);
}
