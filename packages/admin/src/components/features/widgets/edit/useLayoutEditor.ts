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
  movePlacement,
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
  move: (from: number, to: number) => void;
  moveBy: (index: number, delta: number) => void;
  toggleHidden: (placementId: string) => void;
  remove: (placementId: string) => void;
  add: (widgetId: string) => void;
}

export function useLayoutEditor(
  layout: UseDashboardLayoutResult,
  geometryFor: WidgetGeometrySource
): LayoutEditor {
  // `null` means "not editing" and an array means "editing", so the two facts
  // cannot disagree the way a separate boolean and a draft array would — there
  // is no state in which the reader is editing and there is nothing to edit.
  const [draft, setDraft] = useState<WidgetPlacement[] | null>(null);

  const server = useMemo(
    () => layout.layout?.placements ?? [],
    [layout.layout]
  );

  const begin = useCallback(() => setDraft([...server]), [server]);
  const cancel = useCallback(() => setDraft(null), []);

  const save = useCallback(() => {
    const current = draft;
    const version = layout.layout?.version;
    const scope = layout.layout?.scope;
    // Nothing to send, or nothing to send it against. A missing guard is a read
    // that never landed, and inventing one would be inventing the very
    // assertion the server checks.
    if (!current || version === undefined || scope === undefined) return;
    layout.save.mutate(
      // Renumbered on the way out: the editor reorders an ARRAY, so a moved
      // card still carries the `order` it had before. Sent as-is, the server
      // sorts by a number that no longer matches what the reader sees.
      { placements: renumber(current), version, scope },
      // Only on success. A conflict must LEAVE the draft in place, because
      // dropping it here would discard the reader's work at the exact moment
      // they are being told to try again.
      { onSuccess: () => setDraft(null) }
    );
  }, [draft, layout]);

  const reset = useCallback(() => {
    layout.reset.mutate(undefined, { onSuccess: () => setDraft(null) });
  }, [layout]);

  const move = useCallback(
    (from: number, to: number) =>
      setDraft(current =>
        current ? movePlacement(current, from, to) : current
      ),
    []
  );

  // The keyboard and button path. Expressed as a DELTA rather than as a target
  // index so a caller cannot compute the destination differently from the way
  // the drag path computes it.
  const moveBy = useCallback(
    (index: number, delta: number) =>
      setDraft(current =>
        current ? movePlacement(current, index, index + delta) : current
      ),
    []
  );

  const toggleHidden = useCallback(
    (placementId: string) =>
      setDraft(current =>
        current ? togglePlacementHidden(current, placementId) : current
      ),
    []
  );

  const remove = useCallback(
    (placementId: string) =>
      setDraft(current =>
        current ? removePlacement(current, placementId) : current
      ),
    []
  );

  const add = useCallback(
    (widgetId: string) =>
      setDraft(current =>
        current
          ? addPlacement(current, widgetId, geometryFor(widgetId))
          : current
      ),
    [geometryFor]
  );

  const placements = draft ?? server;

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
    hasUnsavedChanges: draft !== null && hasChanges(server, draft),
    isSaving: layout.save.isPending || layout.reset.isPending,
    isConflict: layout.isConflict,
    begin,
    cancel,
    save,
    reset,
    move,
    moveBy,
    toggleHidden,
    remove,
    add,
  };
}
