"use client";
/**
 * Beginning, abandoning, saving and resetting a dashboard edit.
 *
 * The LIFECYCLE of a draft, as opposed to the mutations that change one. Lifted
 * out of `useLayoutEditor` for the same reason those were: each is small, and a
 * hook holding all of them is a body nobody reads end to end -- which matters
 * most here, because these are the four that decide whether a reader's work
 * survives.
 *
 * @module components/features/widgets/edit/useLayoutLifecycle
 */
import { DEFAULT_COLUMN_COUNT } from "nextly/config";
import { useCallback, type Dispatch, type SetStateAction } from "react";

import type { UseDashboardLayoutResult } from "@admin/hooks/queries/useDashboardLayout";

import { renumber } from "../layout-editor";

import type { LayoutDraft } from "./useLayoutEditor";

export interface LayoutLifecycle {
  begin: () => void;
  cancel: () => void;
  save: () => void;
  reset: () => void;
}

export function useLayoutLifecycle(
  layout: UseDashboardLayoutResult,
  draft: LayoutDraft | null,
  setDraft: Dispatch<SetStateAction<LayoutDraft | null>>
): LayoutLifecycle {
  const begin = useCallback(() => {
    const current = layout.layout;
    // Nothing to edit against. Editing is offered only once a read has landed,
    // so this is a guard rather than a state the UI can reach.
    if (!current) return;
    setDraft({
      placements: [...current.placements],
      version: current.version,
      scope: current.scope,
      // Seeded from what was READ, so an edit that never touches the picker
      // saves the count back unchanged rather than resetting it to a default.
      columnCount: current.columnCount ?? DEFAULT_COLUMN_COUNT,
    });
  }, [layout.layout, setDraft]);
  // 🔴 The failed-write state goes with the draft, because the message it
  // renders describes the draft. After a non-conflict failure the chrome says
  // "your changes are still here -- try again"; Cancel discarded them and left
  // that sentence on screen, pointing at nothing, and it was still there when
  // the reader next entered edit mode. A mutation error outlives the thing it
  // is about unless something clears it.
  const cancel = useCallback(() => {
    setDraft(null);
    layout.save.reset();
    layout.reset.reset();
  }, [layout, setDraft]);

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
        columnCount: draft.columnCount,
      },
      // Only on success. A conflict must LEAVE the draft in place, because
      // dropping it here would discard the reader's work at the exact moment
      // they are being told to try again.
      { onSuccess: () => setDraft(null) }
    );
  }, [draft, layout, setDraft]);

  const reset = useCallback(() => {
    layout.reset.mutate(undefined, { onSuccess: () => setDraft(null) });
  }, [layout, setDraft]);
  return { begin, cancel, save, reset };
}
