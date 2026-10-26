"use client";
/**
 * Beginning, abandoning, saving and resetting a dashboard customisation.
 *
 * The LIFECYCLE of a draft, as opposed to the mutations that change one. Lifted
 * out of `useLayoutEditor` for the same reason those were: each is small, and a
 * hook holding all of them is a body nobody reads end to end -- which matters
 * most here, because these are the ones that decide whether a reader's work
 * survives.
 *
 * @module components/features/widgets/edit/useLayoutLifecycle
 */
import { useCallback, type Dispatch, type SetStateAction } from "react";

import {
  fetchGetStartedOnRestore,
  isConflictError,
  type UseDashboardLayoutResult,
} from "@admin/hooks/queries/useDashboardLayout";
import type { WidgetPlacement } from "@admin/types/dashboard/widgets";

import { hasChanges, withinSubmissionLimit } from "../layout-editor";

import type { LayoutDraft } from "./useLayoutEditor";

/** What a save may say beyond the draft itself. */
export interface SaveOptions {
  /**
   * The reader confirmed replacing a stored arrangement the server could not
   * read. Sent only after they were asked; the server refuses the save
   * without it.
   */
  replaceUnreadable?: boolean;
}

/**
 * How a save ended: stored; refused because the arrangement or the reader's
 * widgets moved since it was read (nothing written, the remedy is to reload);
 * or failed for any other reason (nothing written, the remedy is to try
 * again). The draft is kept on both of the last two.
 */
export type SaveOutcome = "saved" | "refused" | "failed";

export interface LayoutLifecycle {
  begin: () => void;
  cancel: () => void;
  /**
   * Store the draft in one write, and answer how that went.
   *
   * Answered rather than only reflected in the mutation state, because a
   * caller that saves on the reader's behalf -- the unsaved-changes prompt --
   * decides from the answer whether the reader may now leave.
   */
  save: (options?: SaveOptions) => Promise<SaveOutcome>;
  /**
   * Put the DEFAULT dashboard in the draft, and write nothing.
   *
   * The reset is only staged: Save makes it real, Cancel brings the reader's
   * own arrangement back.
   */
  stageReset: () => void;
}

/**
 * Whether a save should be the saved RESET rather than a write of the list.
 *
 * A staged reset the reader has not touched since: the draft still holds
 * exactly the default it was given. Deleting the row then returns them to
 * following the default, so later changes to it reach them. Once they change
 * the staged default it is their own arrangement, and it is saved like one.
 */
function savesAsReset(draft: LayoutDraft): boolean {
  return (
    draft.stagedReset !== null &&
    !hasChanges(draft.stagedReset, draft.placements)
  );
}

export function useLayoutLifecycle(
  layout: UseDashboardLayoutResult,
  draft: LayoutDraft | null,
  setDraft: Dispatch<SetStateAction<LayoutDraft | null>>
): LayoutLifecycle {
  const begin = useCallback(() => {
    const current = layout.layout;
    // Nothing to edit against. Customising is offered only once a read has
    // landed, so this is a guard rather than a state the UI can reach.
    if (!current) return;
    // 🔴 The GUARDS are captured with the list, not read at save time. They
    // are what the reader's arrangement is a modification OF; read fresh at
    // save, a refetch on window focus would advance them underneath an
    // untouched draft and the save would silently overwrite another tab.
    setDraft({
      placements: [...current.placements],
      version: current.version,
      scope: current.scope,
      stagedReset: null,
    });
  }, [layout.layout, setDraft]);

  // 🔴 The failed-write state goes with the draft, because the message it
  // renders describes the draft. Cancel discarding the draft and leaving "your
  // changes are still here" on screen would point at nothing.
  const cancel = useCallback(() => {
    setDraft(null);
    layout.save.reset();
    layout.reset.reset();
  }, [layout, setDraft]);

  const save = useCallback(
    async (options: SaveOptions = {}): Promise<SaveOutcome> => {
      // Nothing held is nothing lost: there is no draft to keep.
      if (!draft) return "saved";
      try {
        if (savesAsReset(draft)) {
          // The guards the reset was staged against, so a stale tab cannot
          // delete an arrangement another tab saved since.
          await layout.reset.mutateAsync({
            version: draft.version,
            scope: draft.scope,
          });
        } else {
          await layout.save.mutateAsync({
            // The whole ordered list, removed cards included: the order IS
            // the array's, so nothing is renumbered on the way out. Within the
            // endpoint's limit, shedding removed cards if a regained
            // arrangement holds more than one save may carry.
            placements: [...withinSubmissionLimit(draft.placements)],
            version: draft.version,
            scope: draft.scope,
            // The editor is the one route that can reorder, resize or remove
            // several cards, so its save is always the reader taking charge.
            arranged: true,
            ...(options.replaceUnreadable ? { replaceUnreadable: true } : {}),
          });
        }
      } catch (error) {
        // A failure or a conflict must LEAVE the draft in place, because
        // dropping it would discard the reader's work at the exact moment
        // they are being told to try again. The mutation keeps the error for
        // the chrome's message; this answer is for the caller.
        return isConflictError(error instanceof Error ? error : null)
          ? "refused"
          : "failed";
      }
      // Only on success, and only once the write's own re-read has landed:
      // the mutation awaits it before it resolves.
      setDraft(null);
      return "saved";
    },
    [draft, layout, setDraft]
  );

  const stageReset = useCallback(() => {
    const read = layout.layout;
    if (!read?.defaultPlacements) return;
    const staged = (defaults: readonly WidgetPlacement[]) =>
      setDraft(current =>
        current
          ? {
              ...current,
              placements: [...defaults],
              stagedReset: [...defaults],
            }
          : current
      );
    // A read that worked out no Get started steps (the arrangement holds no
    // card of its own) has a default that leaves the card out, though a reset
    // may draw it. The read that works the steps out answers the default a
    // reset would actually land on; if it cannot be had, this one stands.
    if (read.getStarted !== undefined && read.getStarted.answer === null) {
      void fetchGetStartedOnRestore().then(
        fresh => staged(fresh.defaultPlacements),
        () => staged(read.defaultPlacements)
      );
      return;
    }
    staged(read.defaultPlacements);
  }, [layout.layout, setDraft]);

  return { begin, cancel, save, stageReset };
}
