"use client";

/**
 * Which cards the grid draws, in what order and at what width, and everything
 * customising them needs.
 *
 * The grid keeps the jobs that belong to drawing and fetching -- batching
 * queries, gating them, announcing outcomes. The ones that belong to the
 * ARRANGEMENT live here: resolving the list into cards, holding the draft, and
 * the gestures that move, resize and reset it.
 *
 * @module components/features/widgets/edit/useDashboardArrangement
 */

import { useCallback, useMemo } from "react";

import type { UseDashboardLayoutResult } from "@admin/hooks/queries/useDashboardLayout";
import type {
  DashboardWidget,
  WidgetPlacement,
  WidgetWidth,
} from "@admin/types/dashboard/widgets";

import {
  drawnPosition,
  movePlacement,
  movePlacementToPosition,
  type IsDrawn,
  type MoveDirection,
} from "../layout-editor";
import { WIDTH_NAMES, widthFromDeclaredSize } from "../sizes";

import type { ArrangementAnnouncer } from "./useArrangementAnnouncer";
import { useCardHighlight, type CardHighlight } from "./useCardHighlight";
import type { DashboardFocus } from "./useDashboardFocus";
import { useLayoutEditor, type LayoutEditor } from "./useLayoutEditor";
import type { SaveOptions, SaveOutcome } from "./useLayoutLifecycle";

/** One card to draw: which placement put it there, and how wide it is. */
export interface ArrangedWidget {
  placementId: string;
  widget: DashboardWidget;
  /**
   * The width the reader's arrangement STORED, as stored.
   *
   * A `string` for the reason the placement's is: it may name a width from a
   * newer core. The cell draws it through `cardSpanClass`, which also applies
   * the widget's allowed widths, so nothing here decides a drawn width.
   */
  width: string;
  /** The widths the widget allows, when the read described it. */
  allowedWidths?: readonly WidgetWidth[];
  /**
   * The settings this reader stored for this card, as stored.
   *
   * Carried RAW rather than resolved: the reading that turns it into values is
   * the widget's declaration, which lives with the widget, not here.
   */
  config?: Record<string, unknown>;
}

export interface DashboardArrangement {
  /** The cards to draw, in the arrangement's order. Removed cards are not. */
  visible: ArrangedWidget[];
  editor: LayoutEditor;
  /** Whether a placement is one the grid draws, which is what positions count. */
  isDrawn: IsDrawn;
  /**
   * Whether an arrangement has been READ — not whether it holds anything.
   *
   * 🔴 Absent means the request is in flight or it failed; empty means this
   * reader has arranged their dashboard down to nothing. Folding the two
   * together blanked the whole dashboard for the duration of every page load
   * and the whole of any outage.
   */
  hasArrangement: boolean;
  /**
   * Whether the arrangement is still on its way, with nothing to draw yet.
   *
   * 🔴 Distinct from a FAILED read, which draws the declared default and says
   * so. Until the first read answers, the page cannot know which cards this
   * person has, so it draws none and asks for no card's data: the declared
   * set drawn in the meantime was a dashboard they may not have, redrawn when
   * theirs arrived. A return visit in the same session never waits here,
   * because the cached arrangement is drawn while it is read again.
   */
  awaitingArrangement: boolean;
  /**
   * The one card ringed for having just been placed: moved, resized, added or put back. Each
   * of those gestures moves the ring to its card.
   */
  ring: CardHighlight;
  /** Move one card from its menu, saying where it went. */
  moveCard: (placementId: string, direction: MoveDirection) => void;
  /**
   * Put a dragged card down at `final` among the drawn cards, saying where it went, with focus
   * back on its handle. The menu's sentence, so a drag and a menu move are heard alike.
   */
  dropCard: (placementId: string, final: number) => void;
  /** Set one card's width from its menu, saying so. */
  setCardWidth: (placementId: string, width: WidgetWidth) => void;
  /** Put the default dashboard in the draft, saying nothing is saved yet. */
  stageReset: () => void;
  /** Open customise mode, with focus on its bar, saying what it means. */
  begin: () => void;
  /** Leave customise mode unsaved, with focus back on Customize, saying so. */
  cancel: () => void;
  /**
   * Save the draft and say how that went; focus goes back to Customize once
   * it has landed. A refused or failed save keeps the draft, and focus stays
   * where the reader left it.
   */
  save: (options?: SaveOptions) => Promise<SaveOutcome>;
}

/**
 * The cards drawn when the arrangement could not be read: the declarations, in
 * their declared order, each at the width of its declared size.
 */
function declaredRows(declared: readonly DashboardWidget[]): ArrangedWidget[] {
  return declared.map(widget => ({
    placementId: widget.id,
    widget,
    width: widthFromDeclaredSize(widget.size),
  }));
}

/** The arrangement's list resolved into the cards the grid draws. */
function arrangedRows(
  placements: readonly WidgetPlacement[],
  byId: ReadonlyMap<string, DashboardWidget>,
  factsFor: LayoutEditor["factsFor"]
): ArrangedWidget[] {
  const rows: ArrangedWidget[] = [];
  for (const placement of placements) {
    const widget = byId.get(placement.widgetId);
    // A placement whose declaration this admin cannot resolve is SKIPPED rather
    // than drawn as an empty cell: a plugin's client bundle can be absent, and
    // a titled card with nothing under it reads as a product bug. A removed
    // card is not drawn either; the add panel lists it to put back.
    if (!widget || placement.removed) continue;
    const allowed = factsFor(placement.widgetId)?.allowedWidths;
    rows.push({
      placementId: placement.id,
      widget,
      width: placement.width,
      ...(allowed === undefined ? {} : { allowedWidths: allowed }),
      ...(placement.config === undefined ? {} : { config: placement.config }),
    });
  }
  return rows;
}

/**
 * Entering, leaving and saving customise mode, each saying what happened and
 * sending focus where the reader goes next.
 *
 * Its own hook beside the arrangement's, because these act on the MODE rather
 * than on a card.
 */
function useCustomiseLifecycle(
  editor: LayoutEditor,
  announce: ArrangementAnnouncer,
  focus: Pick<DashboardFocus, "request">
): Pick<DashboardArrangement, "begin" | "cancel" | "save"> {
  const begin = useCallback(() => {
    editor.begin();
    announce.entered();
    focus.request({ kind: "bar" });
  }, [editor, announce, focus]);

  const cancel = useCallback(() => {
    editor.cancel();
    announce.discarded();
    focus.request({ kind: "customize" });
  }, [editor, announce, focus]);

  const save = useCallback(
    async (options?: SaveOptions): Promise<SaveOutcome> => {
      const outcome = await editor.save(options);
      announceSaveOutcome(announce, outcome);
      // Only a save that landed ends the mode; a refused or failed one leaves
      // the reader where they were, with their draft.
      if (outcome === "saved") focus.request({ kind: "customize" });
      return outcome;
    },
    [editor, announce, focus]
  );

  return { begin, cancel, save };
}

/** Say how a save went: each outcome has its own sentence. */
function announceSaveOutcome(
  announce: ArrangementAnnouncer,
  outcome: SaveOutcome
): void {
  if (outcome === "saved") announce.saved();
  else if (outcome === "refused") announce.refused();
  else announce.saveFailed();
}

export function useDashboardArrangement(
  declared: DashboardWidget[],
  layout: UseDashboardLayoutResult,
  announce: ArrangementAnnouncer,
  focus: Pick<DashboardFocus, "request">
): DashboardArrangement {
  // The DECLARATIONS, by id. The arrangement says which cards and in what
  // order; this says what each one actually is.
  const byId = useMemo(
    () => new Map(declared.map(widget => [widget.id, widget])),
    [declared]
  );

  // What a position counts: the cards the grid draws. Given to the editor so a
  // move steps over a card nobody can see, and used for every announcement.
  const isDrawn = useCallback<IsDrawn>(
    placement => !placement.removed && byId.has(placement.widgetId),
    [byId]
  );

  const editor = useLayoutEditor(layout, isDrawn);
  const ring = useCardHighlight(editor.isEditing);
  const hasArrangement = layout.layout !== undefined;
  const awaitingArrangement = !hasArrangement && !layout.isUnavailable;

  const visible = useMemo(() => {
    if (hasArrangement) {
      return arrangedRows(editor.placements, byId, editor.factsFor);
    }
    return awaitingArrangement ? [] : declaredRows(declared);
  }, [
    hasArrangement,
    awaitingArrangement,
    declared,
    editor.placements,
    editor.factsFor,
    byId,
  ]);

  const titleOf = useCallback(
    (placementId: string) =>
      visible.find(row => row.placementId === placementId)?.widget.title,
    [visible]
  );

  /**
   * Say where a card went, counted among the drawn cards before and after.
   *
   * Both positions from the SAME pure rule the draft applies, so the sentence
   * describes the move the reader is about to see rather than a second
   * reckoning of it.
   */
  const announceMove = useCallback(
    (placementId: string, after: readonly WidgetPlacement[]) => {
      const title = titleOf(placementId);
      const from = drawnPosition(editor.placements, placementId, isDrawn);
      const to = drawnPosition(after, placementId, isDrawn);
      if (title === undefined || !from || !to) return;
      if (from.position !== to.position) {
        announce.moved(title, from.position, to.position, to.count);
      }
    },
    [titleOf, editor.placements, isDrawn, announce]
  );

  const moveCard = useCallback(
    (placementId: string, direction: MoveDirection) => {
      announceMove(
        placementId,
        movePlacement(editor.placements, placementId, direction, isDrawn)
      );
      editor.move(placementId, direction);
      ring.highlight(placementId);
      // Back to THIS card's menu, which is now somewhere else on the page: the
      // reader who moved it can move it again without hunting for it.
      focus.request({ kind: "menu", placementId });
    },
    [announceMove, editor, isDrawn, focus, ring]
  );

  const dropCard = useCallback(
    (placementId: string, final: number) => {
      announceMove(
        placementId,
        movePlacementToPosition(editor.placements, placementId, final, isDrawn)
      );
      editor.moveTo(placementId, final);
      ring.highlight(placementId);
      // Back to the handle it was dragged by: the card moved in the page, and React moving a
      // focused element takes the focus with nowhere to go.
      focus.request({ kind: "handle", placementId });
    },
    [announceMove, editor, isDrawn, focus, ring]
  );

  const setCardWidth = useCallback(
    (placementId: string, width: WidgetWidth) => {
      const title = titleOf(placementId);
      editor.setWidth(placementId, width);
      ring.highlight(placementId);
      if (title !== undefined) announce.width(title, WIDTH_NAMES[width].name);
    },
    [titleOf, editor, announce, ring]
  );

  const stageReset = useCallback(() => {
    editor.stageReset();
    announce.reset();
    // The reset is the latest change, so no card is ringed for an earlier one: the default may
    // reuse a ringed card's placement, and it would read as just placed.
    ring.highlight(null);
  }, [editor, announce, ring]);

  const { begin, cancel, save } = useCustomiseLifecycle(
    editor,
    announce,
    focus
  );

  return {
    visible,
    editor,
    isDrawn,
    hasArrangement,
    awaitingArrangement,
    ring,
    moveCard,
    dropCard,
    setCardWidth,
    stageReset,
    begin,
    cancel,
    save,
  };
}
