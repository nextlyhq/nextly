"use client";
/**
 * The draft mutations a reader performs while editing their dashboard.
 *
 * Lifted out of `useLayoutEditor` rather than left inline. Each is a small
 * closure, but a hook accumulating a dozen of them becomes a body nobody reads
 * end to end — and the mutations are the part where a mistake silently edits
 * the wrong card, so they are worth reading as a set.
 *
 * Every one goes through `mutatePlacements`, which owns the single decision
 * they all share: with no draft, do nothing. Spelled out per mutation it was
 * five copies of one null check, and the next one written slightly differently
 * would no-op when the draft is PRESENT rather than when it is absent.
 *
 * @module components/features/widgets/edit/usePlacementMutations
 */
import { useCallback, type Dispatch, type SetStateAction } from "react";

import type { WidgetPlacement } from "@admin/types/dashboard/widgets";

import {
  movePlacementTo,
  removePlacement,
  resolveDrop,
  togglePlacementHidden,
} from "../layout-editor";

import type { LayoutDraft } from "./useLayoutEditor";

export interface PlacementMutations {
  move: (fromId: string, toId: string) => void;
  dropOn: (activeId: string, overId: string | null) => void;
  toggleHidden: (placementId: string) => void;
  remove: (placementId: string) => void;
}

export function usePlacementMutations(
  setDraft: Dispatch<SetStateAction<LayoutDraft | null>>,
  columnCount: number
): PlacementMutations {
  /**
   * Apply a change to the draft's placements, or do nothing without a draft.
   *
   * Every mutation below was spelling this out: the same null check, the same
   * spread, the same field. Five copies of one decision is five places for the
   * next one to be written slightly differently, and the difference would be a
   * mutation that silently no-ops when the draft is absent instead of when it
   * is present.
   */
  const mutatePlacements = useCallback(
    (change: (placements: WidgetPlacement[]) => WidgetPlacement[]) =>
      setDraft(current =>
        current
          ? { ...current, placements: change(current.placements) }
          : current
      ),
    [setDraft]
  );

  const move = useCallback(
    (fromId: string, toId: string) =>
      mutatePlacements(placements => movePlacementTo(placements, fromId, toId)),
    [mutatePlacements]
  );

  const dropOn = useCallback(
    (activeId: string, overId: string | null) =>
      mutatePlacements(placements =>
        resolveDrop(placements, activeId, overId, columnCount)
      ),
    [mutatePlacements, columnCount]
  );

  const toggleHidden = useCallback(
    (placementId: string) =>
      mutatePlacements(placements =>
        togglePlacementHidden(placements, placementId)
      ),
    [mutatePlacements]
  );

  const remove = useCallback(
    (placementId: string) =>
      mutatePlacements(placements => removePlacement(placements, placementId)),
    [mutatePlacements]
  );

  return { move, dropOn, toggleHidden, remove };
}
