"use client";

/**
 * A card's settings panel with its live preview, as its cell opens it. Its own module, loaded
 * only when a reader first opens a card's settings, so the dashboard's first load does not carry
 * the panel, its sections and its preview.
 *
 * @module components/features/widgets/edit/CellSettings
 */
import type { GridSize } from "nextly/config";
import type { JSX } from "react";

import type { DashboardWidget } from "@admin/types/dashboard/widgets";

import { cardOuterWidth } from "../frame/tier";
import { useDashboardWidthAround } from "../useDashboardWidth";

import type { ArrangedCellProps } from "./ArrangedCell";
import { SettingsPanel, type SettingsPanelProps } from "./SettingsPanel";
import { SettingsPreview } from "./SettingsPreview";

/** What a card's cell hands its settings panel. */
export interface CellSettingsProps {
  row: ArrangedCellProps["row"];
  widget: DashboardWidget;
  data: ArrangedCellProps["data"];
  /** Where the panel's Done goes, and why it cannot keep a change now, when it cannot. */
  done: { done: SettingsPanelProps["onDone"]; blocked: string | undefined };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  focusFirstField: boolean;
  size: GridSize;
  returnFocusTo: () => HTMLElement | null;
  isEditing: boolean;
  /** Whether a layout write is on its way anywhere on the dashboard. */
  isWriting: boolean;
}

/**
 * The card's settings panel, with the card at its top as the panel's values would draw it: the
 * declared widget, the reader's stored settings it was asked with, the answer it shows now, and
 * the size and width it is drawn at on the dashboard.
 */
export default function CellSettings({
  row,
  widget,
  data,
  done,
  open,
  onOpenChange,
  focusFirstField,
  size,
  returnFocusTo,
  isEditing,
  isWriting,
}: CellSettingsProps): JSX.Element {
  // The card's width on the dashboard, from the dashboard's own and the card's span, the rule
  // its first query is sized by: the width it has once the panel closes.
  const dashboardWidth = useDashboardWidthAround();
  const cardWidth =
    dashboardWidth === undefined
      ? undefined
      : cardOuterWidth(size.w, dashboardWidth);
  return (
    <SettingsPanel
      placementId={row.placementId}
      open={open}
      onOpenChange={onOpenChange}
      focusFirstField={focusFirstField}
      returnFocusTo={returnFocusTo}
      // While customising, the dashboard's own leave prompt asks for the panel too.
      defersLeave={isEditing}
      // A dashboard write may be carrying this panel's staged change: frozen until it lands.
      dashboardWriting={isWriting}
      title={widget.title}
      settings={widget.settings ?? []}
      // The declaration, not the card as asked: each candidate collection is
      // judged from it, so this card's own grouping is not carried to another.
      widget={row.widget}
      config={row.config}
      ownTitle={row.ownTitle}
      onDone={done.done}
      {...(done.blocked === undefined ? {} : { blocked: done.blocked })}
      renderPreview={(draft, clearFilters) => (
        <SettingsPreview
          widget={row.widget}
          placementId={row.placementId}
          stored={row.config}
          draft={draft.config}
          ownTitle={draft.ownTitle}
          shown={data}
          size={size}
          cardWidth={cardWidth}
          onClearFilters={clearFilters}
        />
      )}
    />
  );
}
