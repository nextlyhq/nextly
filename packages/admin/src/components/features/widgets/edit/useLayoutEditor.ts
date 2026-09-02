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

import { useCallback, useMemo, useState } from "react";

import type { UseDashboardLayoutResult } from "@admin/hooks/queries/useDashboardLayout";
import type { WidgetPlacement } from "@admin/types/dashboard/widgets";

import {
  addPlacement,
  hasChanges,
  movePlacementTo,
  removePlacement,
  renumber,
  togglePlacementHidden,
} from "../layout-editor";

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
  /** Move by IDENTITY: the placement `fromId` takes the position of `toId`. */
  move: (fromId: string, toId: string) => void;
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
interface LayoutDraft {
  placements: WidgetPlacement[];
  version: number;
  scope: string;
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

  const begin = useCallback(() => {
    const current = layout.layout;
    // Nothing to edit against. Editing is offered only once a read has landed,
    // so this is a guard rather than a state the UI can reach.
    if (!current) return;
    setDraft({
      placements: [...current.placements],
      version: current.version,
      scope: current.scope,
    });
  }, [layout.layout]);
  const cancel = useCallback(() => setDraft(null), []);

  const save = useCallback(() => {
    if (!draft) return;
    layout.save.mutate(
      // Renumbered on the way out: the editor reorders an ARRAY, so a moved
      // card still carries the `order` it had before. Sent as-is, the server
      // sorts by a number that no longer matches what the reader sees.
      //
      // The guards come from the DRAFT, so they are the ones this arrangement
      // was derived from rather than whatever the last refetch produced.
      {
        placements: renumber(draft.placements),
        version: draft.version,
        scope: draft.scope,
      },
      // Only on success. A conflict must LEAVE the draft in place, because
      // dropping it here would discard the reader's work at the exact moment
      // they are being told to try again.
      { onSuccess: () => setDraft(null) }
    );
  }, [draft, layout]);

  const reset = useCallback(() => {
    layout.reset.mutate(undefined, { onSuccess: () => setDraft(null) });
  }, [layout]);

  // BOTH paths move by identity, through one function. The drag handler gets
  // ids from dnd-kit and the buttons read them off the row they render for, so
  // neither has to translate a position in the FILTERED view into a position in
  // the stored array — which is exactly the translation that was wrong: with an
  // unresolvable placement between two visible ones, a view index moved the
  // wrong card and persisted it.
  const move = useCallback(
    (fromId: string, toId: string) =>
      setDraft(current =>
        current
          ? {
              ...current,
              placements: movePlacementTo(current.placements, fromId, toId),
            }
          : current
      ),
    []
  );

  const toggleHidden = useCallback(
    (placementId: string) =>
      setDraft(current =>
        current
          ? {
              ...current,
              placements: togglePlacementHidden(
                current.placements,
                placementId
              ),
            }
          : current
      ),
    []
  );

  const remove = useCallback(
    (placementId: string) =>
      setDraft(current =>
        current
          ? {
              ...current,
              placements: removePlacement(current.placements, placementId),
            }
          : current
      ),
    []
  );

  const add = useCallback(
    (widgetId: string) =>
      setDraft(current =>
        current
          ? {
              ...current,
              placements: addPlacement(
                current.placements,
                widgetId,
                geometryFor(widgetId)
              ),
            }
          : current
      ),
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
    hasUnsavedChanges: draft !== null && hasChanges(server, draft.placements),
    isSaving: layout.save.isPending || layout.reset.isPending,
    isConflict: layout.isConflict,
    begin,
    cancel,
    save,
    reset,
    move,
    toggleHidden,
    remove,
    add,
  };
}
