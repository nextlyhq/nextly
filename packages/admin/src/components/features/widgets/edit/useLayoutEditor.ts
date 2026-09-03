"use client";

/**
 * The arrangement a reader is editing, and the one write that commits it.
 *
 * ## Why edit mode batches instead of saving each gesture
 *
 * Every write is guarded twice — by `version`, which catches another tab, and
 * by `scope`, which catches the visible widget set moving underneath the
 * snapshot in hand. Both refuse with a 409 whose only remedy is to re-read, and
 * re-reading DISCARDS whatever is in progress. Saving on every drag would
 * therefore turn each gesture into its own chance to lose the arrangement, and
 * a reader dragging four cards would run that risk four times instead of once.
 *
 * So the editor holds a local copy, every gesture edits that, and Save commits
 * it in one PUT. Cancel throws it away. This is also what Backstage, Grafana,
 * Metabase and Azure Portal do; WordPress is the one that autosaves, and it has
 * no per-placement configuration to lose when a conflict forces a reload.
 *
 * @module components/features/widgets/edit/useLayoutEditor
 */

import { DEFAULT_COLUMN_COUNT, MAX_PLACEMENTS } from "nextly/config";
import { useCallback, useMemo, useState } from "react";

import type { UseDashboardLayoutResult } from "@admin/hooks/queries/useDashboardLayout";
import type { WidgetPlacement } from "@admin/types/dashboard/widgets";

import { addPlacement, draftDiffers, type DropTarget } from "../layout-editor";

import { useLayoutLifecycle } from "./useLayoutLifecycle";
import { usePlacementMutations } from "./usePlacementMutations";

/** Where a card's declared geometry comes from when it is added. */
export interface WidgetGeometrySource {
  (widgetId: string): { size?: string; height?: string } | undefined;
}

export interface LayoutEditor {
  /** Whether the reader is editing. Cards are only manipulable while true. */
  isEditing: boolean;
  /** The arrangement to DRAW — the local copy while editing, else the server's. */
  placements: WidgetPlacement[];
  /** Widget ids offered by the "add" picker. */
  available: string[];
  /**
   * Whether this arrangement already holds as many cards as a write may carry.
   *
   * 🔴 Exposed rather than left for the picker to compute, and refused in
   * {@link LayoutEditor.add} rather than only rendered. An install declaring
   * more widgets than one submission may hold offers the surplus through
   * `available`, so every one of those buttons built a draft the server was
   * always going to refuse -- and the reader met a generic "could not be
   * saved" with nothing naming a limit they had not knowingly reached.
   */
  atCapacity: boolean;
  hasUnsavedChanges: boolean;
  isSaving: boolean;
  /**
   * Whether the last commit lost a race, on either guard.
   *
   * The recovery is one action for both causes, so this is one flag: re-read,
   * which necessarily discards the local copy.
   */
  isConflict: boolean;
  begin: () => void;
  cancel: () => void;
  save: () => void;
  reset: () => void;
  /**
   * The remedy a conflict offers: take the server's arrangement, discard this
   * one.
   *
   * 🔴 THREE pieces of state, because a conflict is three and clearing one
   * leaves the other two contradicting the reader. Re-reading alone refetched
   * an arrangement the editor then declined to show — `placements` prefers the
   * draft — while the failed mutation kept `isConflict` true, so the alert
   * stayed up saying to reload beneath a button that had just been pressed. The
   * action has to do everything its own copy promises.
   */
  reload: () => void;
  /** Move by IDENTITY: the placement `fromId` takes the position of `toId`. */
  move: (fromId: string, toId: string) => void;
  /**
   * Apply a drag that may have crossed columns.
   *
   * A named operation rather than a placements setter, for the same reason
   * every other mutation here is one: a setter lets a caller write an arbitrary
   * draft, and the invariants this module keeps -- ids unique, order dense,
   * columns in range -- would then be enforced nowhere.
   */
  dropOn: (activeId: string, target: DropTarget | null) => void;
  /**
   * Choose how many columns the dashboard is drawn in.
   *
   * Placements are NOT rewritten here. A card whose column falls outside the
   * new count is folded into the last one for drawing, and its stored column
   * is left alone -- so widening the dashboard again puts it back where the
   * reader had it, rather than where a narrower view happened to show it.
   */
  setColumnCount: (columnCount: number) => void;
  /**
   * The count the dashboard is being drawn in RIGHT NOW.
   *
   * The draft's while editing, the saved one otherwise. Published rather than
   * re-derived by each consumer: a second derivation would answer the saved
   * count while the reader is looking at a different one, and the card that
   * landed in a column they cannot see would be nobody's fault in particular.
   */
  columnCount: number;
  toggleHidden: (placementId: string) => void;
  remove: (placementId: string) => void;
  add: (widgetId: string) => void;
}

/**
 * An arrangement being edited, and the guards it is a modification of.
 *
 * One object, so a placement list can never be sent against a version and a
 * scope it was not derived from.
 */
export interface LayoutDraft {
  placements: WidgetPlacement[];
  version: number;
  scope: string;
  /** The count being edited, which may differ from the one last saved. */
  columnCount: number;
}

export function useLayoutEditor(
  layout: UseDashboardLayoutResult,
  geometryFor: WidgetGeometrySource
): LayoutEditor {
  // `null` means "not editing" and a draft means "editing", so the two facts
  // cannot disagree the way a separate boolean and an array would — there is no
  // state in which the reader is editing and there is nothing to edit.
  //
  // 🔴 The GUARDS are captured with the placements, not read at save time. They
  // are what the reader's arrangement is a modification OF, so they belong to
  // the snapshot the way the placements do. Read fresh at save, the query's own
  // `refetchOnWindowFocus` defeated them: another tab saves, this tab regains
  // focus and refetches, `version` advances underneath an untouched draft, and
  // the save then succeeds against the NEW version — silently overwriting the
  // other tab with an arrangement built from a version that no longer exists.
  // The guard was configured out of existence by the refresh policy beside it.
  const [draft, setDraft] = useState<LayoutDraft | null>(null);

  const server = useMemo(
    () => layout.layout?.placements ?? [],
    [layout.layout]
  );

  const { begin, cancel, save, reset } = useLayoutLifecycle(
    layout,
    draft,
    setDraft
  );

  const reload = useCallback(() => {
    // The draft goes first: it is the thing the reader was warned they would
    // lose, and it is what stands between the refetched arrangement and being
    // drawn.
    setDraft(null);
    // BOTH mutations, because `isConflict` reads both errors — a reset can lose
    // the same race a save can, and clearing only the save left a conflict
    // raised by the other one permanently on screen.
    layout.save.reset();
    layout.reset.reset();
    void layout.reload();
  }, [layout]);

  // BOTH paths move by identity, through one function. The drag handler gets
  // ids from dnd-kit and the buttons read them off the row they render for, so
  // neither has to translate a position in the FILTERED view into a position in
  // the stored array — which is exactly the translation that was wrong: with an
  // unresolvable placement between two visible ones, a view index moved the
  // wrong card and persisted it.
  // The reader's own count, from the SERVER's answer. `resolveDrop` clamps a
  // target against it, so a count guessed here would let a drop land in a
  // column the dashboard does not draw.
  // The DRAFT's count while editing, the saved one otherwise. A drop resolved
  // against the saved count while the reader is looking at a different one
  // would land a card in a column they cannot see.
  const columnCount =
    draft?.columnCount ?? layout.layout?.columnCount ?? DEFAULT_COLUMN_COUNT;

  const setColumnCount = useCallback(
    (next: number) =>
      setDraft(current =>
        current ? { ...current, columnCount: next } : current
      ),
    []
  );

  const { move, dropOn, toggleHidden, remove } = usePlacementMutations(
    setDraft,
    columnCount
  );

  const add = useCallback(
    (widgetId: string) =>
      setDraft(current => {
        if (!current) return current;
        // The capacity refusal lives in `addPlacement`, which is the one path
        // every add takes and is pure, so it can be asserted directly. Stating
        // it again here would be a second answer to drift from.
        return {
          ...current,
          placements: addPlacement(
            current.placements,
            widgetId,
            geometryFor(widgetId)
          ),
        };
      }),
    [geometryFor]
  );

  const placements = draft?.placements ?? server;

  // What the picker offers, recomputed against the DRAFT rather than taken from
  // the server's answer. `available` was true when the read landed; a card the
  // reader has just added is placed now, and one they have just removed is
  // offerable again. Reading the server's list would keep offering a card that
  // is already on the grid.
  const available = useMemo(() => {
    const placed = new Set(placements.map(placement => placement.widgetId));
    const offered = layout.layout?.available ?? [];
    const removed = server
      .map(placement => placement.widgetId)
      .filter(widgetId => !placed.has(widgetId));
    return [...new Set([...offered, ...removed])].filter(
      widgetId => !placed.has(widgetId)
    );
  }, [placements, layout.layout, server]);

  return {
    isEditing: draft !== null,
    placements,
    available,
    atCapacity: placements.length >= MAX_PLACEMENTS,
    hasUnsavedChanges:
      draft !== null &&
      draftDiffers(
        server,
        layout.layout?.columnCount ?? DEFAULT_COLUMN_COUNT,
        draft.placements,
        draft.columnCount
      ),
    isSaving: layout.save.isPending || layout.reset.isPending,
    isConflict: layout.isConflict,
    begin,
    cancel,
    save,
    reset,
    reload,
    move,
    dropOn,
    setColumnCount,
    columnCount,
    toggleHidden,
    remove,
    add,
  };
}
