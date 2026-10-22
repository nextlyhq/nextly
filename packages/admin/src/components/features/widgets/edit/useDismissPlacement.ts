"use client";

/**
 * Removing one card from the card itself, outside customise mode, and undoing
 * it.
 *
 * ## Why this is not the editor's Remove
 *
 * 🔴 Every editor mutation writes to the DRAFT, and a draft exists only while
 * customising. Outside it the editor's Remove would do nothing at all,
 * silently, and the card would sit there after a click that reported no error.
 *
 * ## Why writing immediately is consistent with customise mode batching
 *
 * Customise mode batches because a reader rearranging several cards would
 * otherwise run the version guard once per gesture, and every conflict there
 * discards work in progress. A dismissal is ONE gesture with nothing in
 * progress behind it: there is no draft to lose, and deferring the write would
 * mean asking a reader to save an arrangement they never opened. The guards
 * still travel with the snapshot they came from — the read's own `version` and
 * `scope` — so a dismissal raced against another tab is refused rather than
 * silently overwriting it.
 *
 * ## Why a dismissal writes with `arranged: false`
 *
 * 🔴 Sending a card away is not taking charge of the dashboard. A write that
 * claimed to be an arrangement would stop every widget declared afterwards
 * from reaching this reader. The server keeps a row that was already arranged
 * arranged, so this cannot undo a reader's own layout.
 *
 * @module components/features/widgets/edit/useDismissPlacement
 */

import { useCallback } from "react";

import { toast } from "@admin/components/ui";
import type { UseDashboardLayoutResult } from "@admin/hooks/queries/useDashboardLayout";

import { removePlacement, restorePlacement } from "../layout-editor";

import { landed, singleCardWrite } from "./single-card-write";
import type { ArrangementAnnouncer } from "./useArrangementAnnouncer";
import type { DashboardFocus } from "./useDashboardFocus";

/** The card the removal notice is about, and which route removed it. */
export interface RemovalNotice {
  placementId: string;
  title: string;
  /** Removed by the card's own control, outside customise mode. */
  standing: boolean;
}

export interface DismissPlacement {
  /** Remove one card now, then offer Undo. */
  dismiss: (placementId: string, title: string) => void;
  /** Put the noticed card back, now. */
  undo: (notice: RemovalNotice) => void;
}

const REFRESH_FAILED = (title: string) =>
  `${title} was updated, but the dashboard could not be refreshed. Reload the page to see it.`;

/**
 * The standing route: write at once, then offer Undo through the notice.
 *
 * `setNotice` is the notice's own state, which the caller owns because the
 * customise route raises the same notice.
 */
export function useDismissPlacement(
  layout: UseDashboardLayoutResult,
  announce: ArrangementAnnouncer,
  focus: Pick<DashboardFocus, "request">,
  setNotice: (notice: RemovalNotice | null) => void
): DismissPlacement {
  const dismiss = useCallback(
    (placementId: string, title: string) => {
      const stored = layout.layout;
      // Refused while the stored row is unreadable: the server refuses any
      // single-card write to it, and the control says why it is unavailable.
      if (!stored || layout.isUnreadable) return;
      if (!stored.placements.some(p => p.id === placementId)) return;
      // Cleared before the attempt, so a retry that succeeds does not leave an
      // earlier failure reported.
      layout.dismiss.reset();
      layout.dismiss.mutate(
        singleCardWrite(
          stored,
          removePlacement(stored.placements, placementId)
        ),
        {
          onSuccess: () => {
            if (!landed(layout, placementId, p => p.removed)) {
              toast.error(REFRESH_FAILED(title));
              return;
            }
            // Spoken only once the card has actually gone.
            announce.removed(title);
            setNotice({ placementId, title, standing: true });
            // The control that had focus went with its card; Undo is the one
            // thing the reader is most likely to want next.
            focus.request({ kind: "undo" });
          },
          // A toast rather than the customise chrome's own error, which a
          // reader who never opened customise mode is not looking at.
          onError: error =>
            toast.error(`Could not dismiss ${title}: ${error.message}`),
        }
      );
    },
    [layout, announce, focus, setNotice]
  );

  const undo = useCallback(
    (notice: RemovalNotice) => {
      // The CACHED copy, which is the arrangement after the removal landed and
      // carries the version that write produced.
      const stored = layout.cached() ?? layout.layout;
      if (!stored) return;
      const { placementId, title } = notice;
      layout.dismiss.reset();
      layout.dismiss.mutate(
        singleCardWrite(
          stored,
          restorePlacement(stored.placements, placementId)
        ),
        {
          onSuccess: () => {
            if (!landed(layout, placementId, p => !p.removed)) {
              toast.error(REFRESH_FAILED(title));
              return;
            }
            announce.restored(title);
            setNotice(null);
            // Back to the control the reader pressed to remove it, on the card
            // that is now back.
            focus.request({ kind: "dismiss", placementId });
          },
          onError: error =>
            toast.error(`Could not undo removing ${title}: ${error.message}`),
        }
      );
    },
    [layout, announce, focus, setNotice]
  );

  return { dismiss, undo };
}
