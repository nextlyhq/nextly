"use client";

/**
 * Putting one card away from the card itself, without entering edit mode.
 *
 * ## Why this is not `editor.toggleHidden`
 *
 * 🔴 Every placement mutation writes to the DRAFT, and a draft exists only
 * while the reader is editing — `mutatePlacements` returns the state unchanged
 * when there is none. So the edit-mode control cannot be reused as-is for a
 * standing one: outside edit mode it would do nothing at all, silently, and the
 * card would sit there after a click that reported no error.
 *
 * ## Why writing immediately is consistent with edit mode batching
 *
 * `useLayoutEditor` batches because a reader rearranging several cards would
 * otherwise run the version guard once per gesture, and every conflict there
 * discards work in progress. A dismiss is ONE gesture with nothing in progress
 * behind it, so that argument does not reach it: there is no draft to lose, and
 * deferring the write would mean asking a reader to save an arrangement they
 * never opened.
 *
 * The guards still travel with the snapshot they came from — the read's own
 * `version` and `scope` — so a dismiss raced against another tab is refused
 * rather than silently overwriting it.
 *
 * @module components/features/widgets/edit/useDismissPlacement
 */

import { DEFAULT_COLUMN_COUNT } from "nextly/config";
import { useCallback } from "react";

import { toast } from "@admin/components/ui";
import type {
  SaveLayoutInput,
  UseDashboardLayoutResult,
} from "@admin/hooks/queries/useDashboardLayout";
import type {
  DashboardLayoutResponse,
  WidgetPlacement,
} from "@admin/types/dashboard/widgets";

import { togglePlacementHidden } from "../layout-editor";

import type { LayoutEditor } from "./useLayoutEditor";

export interface DismissPlacement {
  /**
   * Put one card away, or bring it back.
   *
   * Takes the TITLE as well as the placement, because both things done with it
   * — announcing the outcome and naming the card in a failure — happen after
   * the write, by which point the row the caller rendered may be gone.
   */
  (placementId: string, title: string): void;
}

/**
 * What this reader's dashboard currently holds, whichever copy is live.
 *
 * The DRAFT while editing, the stored snapshot otherwise. A dismiss resolved
 * against the wrong one would read a flag the reader is not looking at, and
 * announce the opposite of what they just saw happen.
 */
function liveArrangement(
  editor: LayoutEditor,
  stored: DashboardLayoutResponse | undefined
): readonly WidgetPlacement[] {
  return editor.isEditing ? editor.placements : (stored?.placements ?? []);
}

/**
 * The whole arrangement, with one card's flag flipped and nothing else touched.
 *
 * NOT renumbered, unlike the editor's own commit. Hiding moves no card, so
 * renumbering here would rewrite every placement's `order` as a side effect of
 * a gesture that changed one flag.
 */
function hiddenFlipped(
  stored: DashboardLayoutResponse,
  placementId: string
): SaveLayoutInput {
  return {
    placements: togglePlacementHidden(stored.placements, placementId),
    version: stored.version,
    scope: stored.scope,
    columnCount: stored.columnCount ?? DEFAULT_COLUMN_COUNT,
  };
}

/**
 * The one route a dismiss takes, or nothing where no arrangement has been read.
 *
 * 🔴 ABSENT rather than present-and-inert before a read lands, so the control
 * it drives is not drawn at all. The grid draws the DECLARATIONS while the
 * layout request is in flight, and those rows carry no stored placement to
 * hide — a handler offered then answers a click by doing nothing, which is the
 * silent no-op this whole path exists to avoid. Deciding it here rather than at
 * the grid keeps one answer to "can a card be dismissed right now".
 *
 * Dispatching by mode here rather than at the control means the card carries
 * one handler instead of a branch, and no caller can pick the route that does
 * nothing. While editing the change joins the draft like any other, so a reader
 * who dismisses a card mid-edit commits it with everything else rather than
 * advancing the version underneath their own unsaved work.
 */
export function useDismissPlacement(
  layout: UseDashboardLayoutResult,
  editor: LayoutEditor,
  announceHidden: (title: string, hidden: boolean) => void,
  onDismissed: () => void
): DismissPlacement | undefined {
  const dismiss = useCallback(
    (placementId: string, title: string) => {
      const stored = layout.layout;
      const placement = liveArrangement(editor, stored).find(
        row => row.id === placementId
      );
      // No such placement means the arrangement moved underneath the render
      // this control was drawn from. Nothing to toggle, and a write built from
      // it would send an unchanged list.
      if (!placement) return;
      // Read BEFORE the change: its negation is what the card becomes, and it
      // is the only reading available, since `toggleHidden` schedules a state
      // update and asking again would answer with the value being replaced.
      const becomesHidden = !placement.hidden;

      if (editor.isEditing) {
        editor.toggleHidden(placementId);
        announceHidden(title, becomesHidden);
        return;
      }
      // Cards are drawn from the arrangement and this hook returns nothing
      // without one, so reaching here means the read was lost between the
      // render and the click.
      if (!stored) return;
      // 🔴 Cleared before the attempt. A failed dismissal leaves the error on
      // the mutation, and a successful retry only invalidates the query -- so
      // anything reading that error would go on reporting a failure the reader
      // has already recovered from.
      layout.dismiss.reset();
      layout.dismiss.mutate(hiddenFlipped(stored, placementId), {
        onSuccess: () => {
          // Announced on SUCCESS, not on click. The card stays on screen until
          // the write lands, so speaking first would describe an arrangement
          // the server may still refuse.
          announceHidden(title, becomesHidden);
          // 🔴 And focus is moved, because the element that had it is about to
          // be unmounted with its card. Left alone, the browser drops focus to
          // `body` and the reader's next Tab restarts at the top of the page --
          // a whole-page relocation reported as one card being hidden.
          onDismissed();
        },
        // A toast rather than the chrome's own `writeError`, which
        // `DashboardEditChrome` renders and a reader who never entered edit
        // mode is not looking at. A dismiss that failed in silence leaves the
        // card on screen with nothing saying why, which reads as the control
        // being broken.
        onError: error =>
          toast.error(`Could not dismiss ${title}: ${error.message}`),
      });
    },
    [editor, layout, announceHidden, onDismissed]
  );

  return layout.layout ? dismiss : undefined;
}
