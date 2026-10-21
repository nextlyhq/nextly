"use client";
/**
 * The draft mutations a reader performs while customising their dashboard.
 *
 * Lifted out of `useLayoutEditor` rather than left inline. Each is a small
 * closure, but a hook accumulating a dozen of them becomes a body nobody reads
 * end to end — and the mutations are the part where a mistake silently edits
 * the wrong card, so they are worth reading as a set. Every one addresses its
 * card by placement ID, through the pure rules in `layout-editor`.
 *
 * Every one goes through `mutatePlacements`, which owns the single decision
 * they all share: with no draft, do nothing.
 *
 * @module components/features/widgets/edit/usePlacementMutations
 */
import { useCallback, type Dispatch, type SetStateAction } from "react";

import type {
  WidgetPlacement,
  WidgetWidth,
  WidgetWidthFacts,
} from "@admin/types/dashboard/widgets";

import {
  movePlacement,
  movePlacementToPosition,
  removePlacement,
  restorePlacement,
  setPlacementConfig,
  setPlacementWidth,
  type IsDrawn,
  type MoveDirection,
} from "../layout-editor";

import type { LayoutDraft } from "./useLayoutEditor";

export interface PlacementMutations {
  /**
   * Records what a reader chose for one card.
   *
   * Takes the WHOLE answer rather than one field, because the form that calls
   * it knows every setting it drew — and a per-field write could not express
   * clearing one, since an emptied field arrives as an absent key.
   */
  setConfig: (placementId: string, config: Record<string, unknown>) => void;
  /** Move one card to an end, or one step past its drawn neighbour. */
  move: (placementId: string, direction: MoveDirection) => void;
  /** Move one card to `final` among the drawn cards: where a drag released it. */
  moveTo: (placementId: string, final: number) => void;
  /** Set one card's width, when its widget allows that width. */
  setWidth: (placementId: string, width: WidgetWidth) => void;
  /** Take one card off the dashboard, keeping it in the list. */
  remove: (placementId: string) => void;
  /** Put a removed card back where it was. */
  restore: (placementId: string) => void;
}

export function usePlacementMutations(
  setDraft: Dispatch<SetStateAction<LayoutDraft | null>>,
  isDrawn: IsDrawn,
  factsFor: (widgetId: string) => WidgetWidthFacts | undefined
): PlacementMutations {
  /**
   * Apply a change to the draft's placements, or do nothing without a draft.
   *
   * One place for the null check every mutation needs, so none of them can be
   * written to no-op when the draft is PRESENT instead of when it is absent.
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
    (placementId: string, direction: MoveDirection) =>
      mutatePlacements(placements =>
        movePlacement(placements, placementId, direction, isDrawn)
      ),
    [mutatePlacements, isDrawn]
  );

  const moveTo = useCallback(
    (placementId: string, final: number) =>
      mutatePlacements(placements =>
        movePlacementToPosition(placements, placementId, final, isDrawn)
      ),
    [mutatePlacements, isDrawn]
  );

  const setWidth = useCallback(
    (placementId: string, width: WidgetWidth) =>
      mutatePlacements(placements => {
        // The allowed widths of THIS card's widget, read from the draft's own
        // placement so a stale id cannot borrow another widget's list.
        const placement = placements.find(p => p.id === placementId);
        const allowed = placement
          ? factsFor(placement.widgetId)?.allowedWidths
          : undefined;
        return setPlacementWidth(placements, placementId, width, allowed);
      }),
    [mutatePlacements, factsFor]
  );

  const remove = useCallback(
    (placementId: string) =>
      mutatePlacements(placements => removePlacement(placements, placementId)),
    [mutatePlacements]
  );

  const restore = useCallback(
    (placementId: string) =>
      mutatePlacements(placements => restorePlacement(placements, placementId)),
    [mutatePlacements]
  );

  const setConfig = useCallback(
    (placementId: string, config: Record<string, unknown>) =>
      mutatePlacements(placements =>
        setPlacementConfig(placements, placementId, config)
      ),
    [mutatePlacements]
  );

  return { move, moveTo, setWidth, remove, restore, setConfig };
}
