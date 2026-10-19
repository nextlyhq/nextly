"use client";

/**
 * Taking a card off the dashboard, and the one notice that offers it back.
 *
 * Two routes, one notice. While customising, Remove marks the card removed in
 * the DRAFT and nothing is written until Save. Outside customise mode a card
 * that declared `dismissible` carries its own control, which writes at once
 * (`useDismissPlacement`). Either way the card stays in the list marked
 * removed, so Undo puts back the same card in the same place, width and
 * settings included.
 *
 * @module components/features/widgets/edit/useCardRemoval
 */

import { useCallback, useState } from "react";

import type { UseDashboardLayoutResult } from "@admin/hooks/queries/useDashboardLayout";

import type { ArrangementAnnouncer } from "./useArrangementAnnouncer";
import type { DashboardFocus } from "./useDashboardFocus";
import { useDismissPlacement, type RemovalNotice } from "./useDismissPlacement";
import type { LayoutEditor } from "./useLayoutEditor";

export type { RemovalNotice };

export interface CardRemoval {
  /** What the notice says, or `null` when none is showing. */
  notice: RemovalNotice | null;
  /** Remove one card from the draft, while customising. */
  remove: (placementId: string) => void;
  /** Put a removed card back from the add picker, while customising. */
  restore: (placementId: string, title: string) => void;
  /**
   * Remove one card from the card itself, outside customise mode.
   *
   * 🔴 ABSENT before an arrangement has been read: the grid draws the
   * DECLARATIONS while the request is in flight, and those rows carry no
   * stored placement to remove, so a control drawn then would do nothing.
   */
  dismiss: ((placementId: string, title: string) => void) | undefined;
  /** Put the noticed card back where it was. */
  undo: () => void;
  /** Close the notice without undoing. */
  close: () => void;
}

/** One card fact the routes need: what a drawn card is called. */
interface TitledRow {
  placementId: string;
  widget: { title: string };
}

export function useCardRemoval(
  layout: UseDashboardLayoutResult,
  editor: LayoutEditor,
  rows: readonly TitledRow[],
  announce: ArrangementAnnouncer,
  focus: Pick<DashboardFocus, "request">
): CardRemoval {
  const [notice, setNotice] = useState<RemovalNotice | null>(null);

  // 🔴 A notice belongs to the mode it was raised in. One raised while
  // customising offers to undo a DRAFT change, which Save or Cancel has made
  // meaningless; one raised outside it would write underneath an open draft.
  // So entering or leaving customise mode closes it. Adjusted during render,
  // React's pattern for state that follows a prop, so no stale frame shows it.
  const [noticeMode, setNoticeMode] = useState(editor.isEditing);
  if (noticeMode !== editor.isEditing) {
    setNoticeMode(editor.isEditing);
    setNotice(null);
  }

  const standing = useDismissPlacement(layout, announce, focus, setNotice);

  const remove = useCallback(
    (placementId: string) => {
      const index = rows.findIndex(row => row.placementId === placementId);
      if (index === -1) return;
      const title = rows[index].widget.title;
      // Where focus goes, decided BEFORE the card leaves: the next card's menu,
      // else the previous card's, else the add picker when it was the last.
      const neighbour = rows[index + 1] ?? rows[index - 1];
      editor.remove(placementId);
      announce.removed(title);
      setNotice({ placementId, title, standing: false });
      focus.request(
        neighbour
          ? { kind: "menu", placementId: neighbour.placementId }
          : { kind: "add" }
      );
    },
    [rows, editor, announce, focus]
  );

  const restoreDraft = useCallback(
    (placementId: string, title: string) => {
      editor.restore(placementId);
      announce.restored(title);
      focus.request({ kind: "menu", placementId });
    },
    [editor, announce, focus]
  );

  const restore = useCallback(
    (placementId: string, title: string) => {
      // Putting back the very card the notice offers to undo answers it.
      if (notice?.placementId === placementId) setNotice(null);
      restoreDraft(placementId, title);
    },
    [notice, restoreDraft]
  );

  const undo = useCallback(() => {
    if (!notice) return;
    if (notice.standing) {
      standing.undo(notice);
      return;
    }
    setNotice(null);
    restoreDraft(notice.placementId, notice.title);
  }, [notice, standing, restoreDraft]);

  const close = useCallback(() => {
    setNotice(null);
    // The notice's own button had focus. The page's heading is the one place
    // every state of the dashboard draws, so the reader lands at the top of
    // what they were reading rather than on `body`.
    focus.request({ kind: "heading" });
  }, [focus]);

  return {
    notice,
    remove,
    restore,
    dismiss: layout.layout ? standing.dismiss : undefined,
    undo,
    close,
  };
}
