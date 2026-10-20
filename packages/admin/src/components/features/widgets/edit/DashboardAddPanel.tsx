"use client";

/**
 * The add panel as the dashboard drives it: its rows from the draft, what an add puts where, and
 * where focus goes once the panel closes.
 *
 * Kept apart from the grid, which already composes the arrangement, its data and its chrome:
 * everything the panel needs from them is handed in.
 *
 * @module components/features/widgets/edit/DashboardAddPanel
 */

import { useCallback, useMemo, useRef, useState } from "react";

import type { UseDashboardLayoutResult } from "@admin/hooks/queries/useDashboardLayout";
import type {
  DashboardWidget,
  WidgetPlacement,
} from "@admin/types/dashboard/widgets";

import type { IsDrawn } from "../layout-editor";

import { addPanelRows } from "./add-panel-model";
import { AddWidgetPanel, type AddedCard } from "./AddWidgetPanel";
import { useCardHighlight, type CardHighlight } from "./useCardHighlight";
import type { DashboardFocus } from "./useDashboardFocus";
import type { LayoutEditor } from "./useLayoutEditor";

export interface DashboardAddPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editor: Pick<
    LayoutEditor,
    "isEditing" | "placements" | "available" | "atCapacity" | "add"
  >;
  /** The layout read, whose widget facts (widths, group and rank) the rows are built from. */
  layout: Pick<UseDashboardLayoutResult, "layout">;
  byId: ReadonlyMap<string, DashboardWidget>;
  isDrawn: IsDrawn;
  /** Put a removed card back where it was. */
  restore: (placementId: string) => void;
  /** Ring the card that was just added, or none. */
  highlight: (placementId: string | null) => void;
  focus: Pick<DashboardFocus, "request">;
}

/**
 * Where a card sits among the cards drawn once `change` has happened: its position counted from
 * one, and how many are drawn. Read from the list as it will be, so the sentence says where the
 * card lands rather than where the list was.
 */
function placeAmongDrawn(
  placements: readonly WidgetPlacement[],
  placementId: string,
  isDrawn: IsDrawn
): Pick<AddedCard, "position" | "count"> {
  const drawn = placements.filter(isDrawn);
  return {
    position: drawn.findIndex(p => p.id === placementId) + 1,
    count: drawn.length,
  };
}

/** Whether the add panel is open, as the grid holds it. */
export interface AddPanelState {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** The card the panel last placed, which the grid rings. */
  ring: CardHighlight;
}

/**
 * The add panel's open state and the ring on the card it last placed. Both follow the mode:
 * leaving customise mode closes the panel, adjusted during render (React's pattern for state
 * that follows a prop), so no frame after Save or Cancel still holds the sheet open; the ring
 * drops with it (`useCardHighlight`).
 */
export function useAddPanelState(isEditing: boolean): AddPanelState {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState(isEditing);
  if (mode !== isEditing) {
    setMode(isEditing);
    setOpen(false);
  }
  const ring = useCardHighlight(isEditing);
  return { open, setOpen, ring };
}

/** No widget described yet: the panel's facts before the layout read has answered. */
const NO_WIDGET_FACTS: Readonly<Record<string, never>> = {};

/** The add panel, which exists only while customising. */
export function DashboardAddPanel(props: DashboardAddPanelProps) {
  return props.editor.isEditing ? <CustomizingAddPanel {...props} /> : null;
}

function CustomizingAddPanel({
  open,
  onOpenChange,
  editor,
  layout,
  byId,
  isDrawn,
  restore,
  highlight,
  focus,
}: DashboardAddPanelProps) {
  // The last card this visit added: where focus goes when the panel closes, in view.
  const lastAdded = useRef<string | null>(null);

  const rows = useMemo(
    () =>
      addPanelRows({
        placements: editor.placements,
        offered: editor.available,
        widgets: layout.layout?.widgets ?? NO_WIDGET_FACTS,
        byId,
      }),
    [editor.placements, editor.available, layout.layout, byId]
  );

  const titleOf = useCallback(
    (widgetId: string) => byId.get(widgetId)?.title ?? widgetId,
    [byId]
  );

  const onAdd = useCallback(
    (widgetId: string): AddedCard | null => {
      const id = editor.add(widgetId);
      if (id === null) return null;
      lastAdded.current = id;
      highlight(id);
      // At the end: the list as it will be once the add lands. A width counts for nothing in a
      // position, so the card stands in at any.
      const after = [
        ...editor.placements,
        { id, widgetId, width: "full" as const, removed: false },
      ];
      return {
        title: titleOf(widgetId),
        ...placeAmongDrawn(after, id, isDrawn),
      };
    },
    [editor, highlight, titleOf, isDrawn]
  );

  const onAddBack = useCallback(
    (placementId: string): AddedCard | null => {
      const card = editor.placements.find(p => p.id === placementId);
      if (card === undefined) return null;
      restore(placementId);
      lastAdded.current = placementId;
      highlight(placementId);
      // Back where it was: the list with this card no longer removed.
      const after = editor.placements.map(p =>
        p.id === placementId ? { ...p, removed: false } : p
      );
      return {
        title: titleOf(card.widgetId),
        ...placeAmongDrawn(after, placementId, isDrawn),
      };
    },
    [editor.placements, restore, highlight, titleOf, isDrawn]
  );

  const onOpen = useCallback(
    (next: boolean) => {
      if (next) lastAdded.current = null;
      onOpenChange(next);
    },
    [onOpenChange]
  );

  const onClosed = useCallback(() => {
    const last = lastAdded.current;
    // The last card added, by its menu, which the focus request scrolls into view; with nothing
    // added, back to Add widget.
    focus.request(
      last === null ? { kind: "add" } : { kind: "menu", placementId: last }
    );
  }, [focus]);

  return (
    <AddWidgetPanel
      open={open}
      onOpenChange={onOpen}
      rows={rows}
      atCapacity={editor.atCapacity}
      onAdd={onAdd}
      onAddBack={onAddBack}
      onClosed={onClosed}
    />
  );
}
