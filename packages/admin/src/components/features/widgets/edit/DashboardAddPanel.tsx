"use client";

/**
 * The add gallery as the dashboard drives it: the server's gallery read, what an add puts where,
 * and where focus goes once the panel closes.
 *
 * Kept apart from the grid, which already composes the arrangement, its data and its chrome:
 * everything the panel needs from them is handed in.
 *
 * @module components/features/widgets/edit/DashboardAddPanel
 */

import { useQuery } from "@tanstack/react-query";
import type { JSX } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useBranding } from "@admin/context/providers/BrandingProvider";
import { protectedApi } from "@admin/lib/api/protectedApi";
import type { DashboardWidget } from "@admin/types/dashboard/widgets";

import { titleAsAsked } from "../widget-as-asked";

import type { GalleryRead } from "./add-panel-model";
import { AddWidgetPanel, type AddedCard } from "./AddWidgetPanel";
import { CELL_PLACEMENT_ATTRIBUTE } from "./drag/cell-placement";
import type { DashboardFocus } from "./useDashboardFocus";
import type { LayoutEditor } from "./useLayoutEditor";

export interface DashboardAddPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editor: Pick<
    LayoutEditor,
    "isEditing" | "placements" | "atCapacity" | "add" | "setSize"
  >;
  byId: ReadonlyMap<string, DashboardWidget>;
  /** Put a removed card back where it was. */
  restore: (placementId: string) => void;
  /** Ring the card that was just added, or none. */
  highlight: (placementId: string | null) => void;
  focus: Pick<DashboardFocus, "request">;
}

/** Whether the add panel is open, as the grid holds it. */
export interface AddPanelState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

/**
 * The add panel's open state, which follows the mode: leaving customise mode closes the panel,
 * adjusted during render (React's pattern for state that follows a prop), so no frame after Save
 * or Cancel still holds the sheet open. The card an add places is ringed by the arrangement's
 * ring, the one every placing gesture moves.
 */
export function useAddPanelState(isEditing: boolean): AddPanelState {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState(isEditing);
  if (mode !== isEditing) {
    setMode(isEditing);
    setOpen(false);
  }
  return { open, setOpen };
}

/** The gallery read's own query key. */
const DASHBOARD_GALLERY_KEY = ["dashboard", "gallery"] as const;

const GALLERY_PATH = "/dashboard/gallery";

/**
 * What the gallery offers this reader, read each time the panel opens: an answer kept from an
 * earlier visit is drawn at once and asked again, since a grant, a collection or a save of the
 * reader's may have changed what it holds.
 */
function useDashboardGallery(open: boolean) {
  return useQuery({
    queryKey: DASHBOARD_GALLERY_KEY,
    queryFn: () => protectedApi.get<GalleryRead>(GALLERY_PATH),
    enabled: open,
    staleTime: 0,
  });
}

/**
 * Brings the card just added into view once it is drawn, without moving focus out of the panel:
 * the card is found by the placement its cell carries (`CELL_PLACEMENT_ATTRIBUTE`), after the
 * render that draws it.
 */
function useScrollIntoView(): (placementId: string) => void {
  const pending = useRef<string | null>(null);
  const [, setAsked] = useState(0);
  // No dependency list: a held request is tried after every render, which is when the card can
  // have appeared.
  useEffect(() => {
    const id = pending.current;
    if (id === null) return;
    const card = document.querySelector(
      `[${CELL_PLACEMENT_ATTRIBUTE}="${CSS.escape(id)}"]`
    );
    if (card === null) return;
    pending.current = null;
    // `nearest`, so a card already in view does not jump.
    card.scrollIntoView({ block: "nearest" });
  });
  return useCallback((placementId: string) => {
    pending.current = placementId;
    setAsked(count => count + 1);
  }, []);
}

/** The add panel, which exists only while customising. */
export function DashboardAddPanel(
  props: DashboardAddPanelProps
): JSX.Element | null {
  return props.editor.isEditing ? <CustomizingAddPanel {...props} /> : null;
}

function CustomizingAddPanel({
  open,
  onOpenChange,
  editor,
  byId,
  restore,
  highlight,
  focus,
}: DashboardAddPanelProps) {
  // The last card this visit added: where focus goes when the panel closes, in view.
  const lastAdded = useRef<string | null>(null);
  // Each visit starts with none. Read from `open` itself, since the bar opens the panel
  // by setting it, not through the sheet's own open callback.
  useEffect(() => {
    if (open) lastAdded.current = null;
  }, [open]);

  const gallery = useDashboardGallery(open);
  const sources = useBranding().widgetSources;
  const scrollIntoView = useScrollIntoView();

  /** The card's title as the dashboard will draw it, its collection named where it has one. */
  const titleOf = useCallback(
    (widgetId: string, settings?: Record<string, unknown>) => {
      const widget = byId.get(widgetId);
      return widget === undefined
        ? widgetId
        : titleAsAsked(widget, settings, sources).title;
    },
    [byId, sources]
  );

  const landed = useCallback(
    (placementId: string) => {
      lastAdded.current = placementId;
      highlight(placementId);
      scrollIntoView(placementId);
    },
    [highlight, scrollIntoView]
  );

  const onAdd = useCallback(
    (
      widgetId: string,
      settings?: Record<string, unknown>,
      width?: number
    ): AddedCard | null => {
      // At the end of the order, at its widget's starting size; then at the width chosen, held
      // to the widget's bounds as every resize is.
      const id = editor.add(widgetId, settings);
      if (id === null) return null;
      const start = byId.get(widgetId)?.size.default;
      if (width !== undefined && start !== undefined && width !== start.w) {
        editor.setSize(id, { w: width, h: start.h });
      }
      landed(id);
      return { title: titleOf(widgetId, settings) };
    },
    [editor, byId, landed, titleOf]
  );

  const onAddBack = useCallback(
    (placementId: string): AddedCard | null => {
      const card = editor.placements.find(p => p.id === placementId);
      if (card === undefined) return null;
      restore(placementId);
      landed(placementId);
      return { title: titleOf(card.widgetId, card.config) };
    },
    [editor.placements, restore, landed, titleOf]
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
      onOpenChange={onOpenChange}
      gallery={{
        read: gallery.data,
        isError: gallery.isError,
        retry: () => void gallery.refetch(),
      }}
      placements={editor.placements}
      byId={byId}
      atCapacity={editor.atCapacity}
      onAdd={onAdd}
      onAddBack={onAddBack}
      onClosed={onClosed}
    />
  );
}
