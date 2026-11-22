/**
 * The canvas's second kind of selection: a region of the page's layout, its
 * header or footer, drawn from another document around the page.
 *
 * Held beside the editor's block selection rather than inside it. A region
 * is no node of the page's document, so the block selection's rules (ids in
 * document order, outermost only, pruned by an edit) have nothing to say
 * about it, and every surface reading the block selection (the toolbar, the
 * block menus, the keyboard's Delete and moves) is left with nothing selected
 * while a region is: none of them can act on a region by accident.
 *
 * The two never hold at once. Selecting a region clears the block selection,
 * and a block selected by any route clears the region on that very render,
 * derived rather than synced, so no surface ever sees both.
 *
 * @module region-selection
 */
import type { RegionArea } from "@nextlyhq/blocks-engine";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** What the region selection reads of the editor: its block selection. */
export interface RegionSelectionEditor {
  readonly selectedId: string | null;
  readonly select: (id: null) => void;
}

/** The selected region, and the ways to change it. */
export interface RegionSelection {
  /**
   * The region selected, or `null`: always `null` while a block is selected
   * or while the region is not drawn.
   */
  readonly area: RegionArea | null;
  /** Select a region, clearing the block selection. */
  readonly select: (area: RegionArea) => void;
  /** Select no region. */
  readonly clear: () => void;
}

/**
 * The region selection for an editor whose canvas draws `areas`.
 *
 * Its verbs keep one identity, reading the newest editor when called, so a
 * canvas or a Layers row holding them is not drawn again on every edit.
 */
export function useRegionSelection(
  editor: RegionSelectionEditor,
  areas: readonly RegionArea[]
): RegionSelection {
  const [held, setHeld] = useState<RegionArea | null>(null);
  const latest = useRef(editor);
  latest.current = editor;
  const { selectedId } = editor;
  const blockSelected = selectedId !== null;
  const drawn = held !== null && areas.includes(held);
  // Dropped for good once a block is selected or the region goes, so neither
  // clearing that block nor drawing the region again selects it once more.
  // Asked when the block selection changes, not of it as it stands: the
  // press selecting a region clears the block selection in the same breath.
  useEffect(() => {
    if (selectedId !== null) setHeld(null);
  }, [selectedId]);
  useEffect(() => {
    if (!drawn) setHeld(null);
  }, [drawn]);
  const select = useCallback((area: RegionArea) => {
    latest.current.select(null);
    setHeld(area);
  }, []);
  const clear = useCallback(() => setHeld(null), []);
  const area = !blockSelected && drawn ? held : null;
  return useMemo(() => ({ area, select, clear }), [area, select, clear]);
}
