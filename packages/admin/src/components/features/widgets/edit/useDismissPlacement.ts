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
 * ## Why an arranged reader's card is taken out instead
 *
 * A reader who has arranged their dashboard owns the list, so the card leaves
 * it, through the same write with `arranged: true`, the kind any write that
 * drops a placement must be. Hidden instead, it would stay in their list as a
 * copy that adding the widget again from the gallery clashes with. Undo puts it
 * back where it was, with its size and settings.
 *
 * @module components/features/widgets/edit/useDismissPlacement
 */

import { GET_STARTED_WIDGET_ID } from "nextly/config";
import { useCallback } from "react";

import { toast } from "@admin/components/ui";
import type { UseDashboardLayoutResult } from "@admin/hooks/queries/useDashboardLayout";
import type {
  DashboardLayoutResponse,
  WidgetPlacement,
} from "@admin/types/dashboard/widgets";

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
  /**
   * The card as it was and where, when it was taken out of an arranged reader's list rather
   * than hidden: what Undo puts back, at that index.
   */
  taken?: { placement: WidgetPlacement; index: number } | undefined;
}

/** A standing write: the list to send, whether it arranges, and how the card shows it landed. */
interface StandingWrite {
  placements: WidgetPlacement[];
  arranged: boolean;
  /** Whether the list the client holds once the write has landed shows it. */
  shows: (layout: UseDashboardLayoutResult) => boolean;
  taken?: NoticeTaken;
}

type NoticeTaken = NonNullable<RemovalNotice["taken"]>;

/**
 * What removing one card at rest writes: the card taken out of an arranged reader's list, or
 * hidden in the list of a reader still following the default.
 *
 * The Get started card is hidden for an arranged reader too. The server carries it back into a
 * write that leaves it out, as it does a dormant one the reader was never handed, so taken out it
 * would come straight back; held with `removed: true` it is the reader's own choice, kept.
 */
function removalOf(
  stored: DashboardLayoutResponse,
  placementId: string,
  arranged: boolean
): StandingWrite | undefined {
  const index = stored.placements.findIndex(p => p.id === placementId);
  const placement = stored.placements[index];
  if (placement === undefined) return undefined;
  if (!arranged || placement.widgetId === GET_STARTED_WIDGET_ID) {
    return {
      placements: removePlacement(stored.placements, placementId),
      // Said as it is: an arranged reader's write stays an arrangement.
      arranged,
      shows: layout => landed(layout, placementId, p => p.removed),
    };
  }
  return {
    placements: stored.placements.filter(p => p.id !== placementId),
    arranged: true,
    shows: layout =>
      layout.cached()?.placements.some(p => p.id === placementId) === false,
    taken: { placement, index },
  };
}

/** What Undo writes: the card put back where it was taken from, or shown again. */
function restorationOf(
  stored: DashboardLayoutResponse,
  notice: RemovalNotice
): StandingWrite {
  const { placementId, taken } = notice;
  if (taken === undefined) {
    return {
      placements: restorePlacement(stored.placements, placementId),
      arranged: false,
      shows: layout => landed(layout, placementId, p => !p.removed),
    };
  }
  // At its index in the list as it is now, held to the list's end.
  const placements = stored.placements.filter(p => p.id !== placementId);
  placements.splice(
    Math.min(taken.index, placements.length),
    0,
    taken.placement
  );
  return {
    placements,
    arranged: true,
    shows: layout => landed(layout, placementId, p => !p.removed),
  };
}

/** The write `change` makes, under the read's own version and scope. */
function standingInput(stored: DashboardLayoutResponse, change: StandingWrite) {
  return {
    ...singleCardWrite(stored, change.placements),
    arranged: change.arranged,
  };
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
      const removal = removalOf(stored, placementId, layout.isArranged);
      if (removal === undefined) return;
      // Cleared before the attempt, so a retry that succeeds does not leave an
      // earlier failure reported.
      layout.dismiss.reset();
      layout.dismiss.mutate(standingInput(stored, removal), {
        onSuccess: () => {
          if (!removal.shows(layout)) {
            toast.error(REFRESH_FAILED(title));
            return;
          }
          // Spoken only once the card has actually gone.
          announce.removed(title);
          setNotice({
            placementId,
            title,
            standing: true,
            ...(removal.taken ? { taken: removal.taken } : {}),
          });
          // The control that had focus went with its card; Undo is the one
          // thing the reader is most likely to want next.
          focus.request({ kind: "undo" });
        },
        // A toast rather than the customise chrome's own error, which a
        // reader who never opened customise mode is not looking at.
        onError: error =>
          toast.error(`Could not dismiss ${title}: ${error.message}`),
      });
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
      const restoration = restorationOf(stored, notice);
      layout.dismiss.reset();
      layout.dismiss.mutate(standingInput(stored, restoration), {
        onSuccess: () => {
          if (!restoration.shows(layout)) {
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
      });
    },
    [layout, announce, focus, setNotice]
  );

  return { dismiss, undo };
}
