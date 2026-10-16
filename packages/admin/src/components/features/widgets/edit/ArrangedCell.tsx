"use client";

/**
 * One cell of the grid: its width, its spacing, its customise controls and the
 * widget inside it.
 *
 * Its own component because the split is by SUBJECT: everything here is about
 * one card, and everything left in the grid is about the set.
 *
 * @module components/features/widgets/edit/ArrangedCell
 */

import { resolveWidgetSettings } from "nextly/config";
import { useMemo, useState, type ReactNode } from "react";

import { cn } from "@admin/lib/utils";
import type {
  DashboardWidget,
  WidgetSlot,
  WidgetWidth,
} from "@admin/types/dashboard/widgets";

import type { CellSlotLookup } from "../archetypes/types";
import type { MoveDirection } from "../layout-editor";
import { cardSpanClass, drawnWidth } from "../sizes";
import { WidgetRenderer } from "../WidgetRenderer";

import { CardActionsMenu, CardWidthLabel } from "./CardActionsMenu";
import { DismissWidgetButton } from "./DismissWidgetButton";
import { SortableWidgetCell } from "./SortableWidgetCell";
import type { ArrangedWidget } from "./useDashboardArrangement";
import { WidgetSettingsSheet } from "./WidgetSettingsSheet";

export interface ArrangedCellProps {
  row: ArrangedWidget;
  isEditing: boolean;
  /**
   * Whether a layout write is in flight anywhere on this dashboard.
   *
   * Dashboard-wide rather than per-card, because every write is a whole-layout
   * snapshot guarded by one cached version: two in flight at once carry the
   * same guard, so the server honours one and refuses the other as a conflict
   * the reader never caused.
   */
  isWriting: boolean;
  /**
   * Why a single-card write is unavailable right now, or absent when it is
   * available. Present while the stored layout is unreadable.
   */
  singleCardWriteBlocked?: string;
  /** Which of the four moves would move this card. */
  can: Record<MoveDirection, boolean>;
  /**
   * What the batch answered for this card, or its absence.
   *
   * One group because it is one answer: the renderer takes all four together,
   * and `updatedAt`/`isFetching` are `null`/`false` for a card that took no
   * part in the batch rather than being separately meaningful.
   */
  data: {
    slot: WidgetSlot | undefined;
    /** How a `stats` card reaches each cell's answer; absent otherwise. */
    slotFor?: CellSlotLookup;
    /** `null` when this card took no part in the batch. */
    updatedAt: Date | null;
    isFetching: boolean;
    /** Reload this card's data on its own, offered in its error state. */
    onRetry?: () => void;
  };
  /** Registers the card's controls, so focus can be sent back to them. */
  refs: {
    menu: (element: HTMLElement | null) => void;
    dismiss: (element: HTMLElement | null) => void;
  };
  /**
   * What acting on this card does, each already bound to this placement by
   * the caller: the writes are keyed by placement, and the cell should not
   * have to know how the editor addresses one.
   */
  on: {
    move: (direction: MoveDirection) => void;
    setWidth: (width: WidgetWidth) => void;
    remove: () => void;
    /**
     * Send this card away from the card itself, outside customise mode.
     *
     * 🔴 ABSENT rather than present-and-inert before an arrangement has been
     * read: the rows drawn then carry no stored placement to remove, so a
     * control drawn then would answer a click by doing nothing at all.
     */
    dismiss?: () => void;
    /** Records what a reader chose for THIS card. */
    saveSettings: (config: Record<string, unknown>) => void;
  };
}

/**
 * This card's dismiss control, and where it is drawn.
 *
 * A FRAMED card has a header that reserves space beside the declared icon; an
 * UNFRAMED one has no header, so the cell floats the control in the corner the
 * drag handle leaves free while not customising. Both are `undefined` for a
 * card whose author offered no dismiss, and while customising, where Remove in
 * the card's menu does the same thing.
 *
 * 🔴 `=== true`, not truthiness. A registration arrives over the wire from a
 * server that may be a different version and the admin copies the field
 * verbatim, so a malformed `dismissible: "false"` would otherwise DRAW the
 * control, which is the one reading the declaration cannot have meant.
 */
function dismissAffordance(
  widget: DashboardWidget,
  props: Pick<
    ArrangedCellProps,
    "isEditing" | "isWriting" | "singleCardWriteBlocked" | "refs"
  >,
  dismiss: (() => void) | undefined
): { floating?: ReactNode; header?: ReactNode } {
  if (!dismiss || props.isEditing || widget.dismissible !== true) return {};
  const button = (floating: boolean) => (
    <DismissWidgetButton
      title={widget.title}
      isDismissing={props.isWriting}
      unavailableReason={props.singleCardWriteBlocked}
      floating={floating}
      buttonRef={props.refs.dismiss}
      onDismiss={dismiss}
    />
  );
  return widget.chrome === "none"
    ? { floating: button(true) }
    : { header: button(false) };
}

export function ArrangedCell(props: ArrangedCellProps) {
  const { row, isEditing, isWriting, can, data, refs, on } = props;
  /*
   * Open state lives with the CELL rather than with the grid: the sheet belongs
   * to one card, and hoisting it would make the grid track which of many is
   * open for no benefit to either.
   */
  const [settingsOpen, setSettingsOpen] = useState(false);
  const hasSettings = (row.widget.settings?.length ?? 0) > 0;
  const widget = row.widget;
  /*
   * Resolved HERE, the one place a card's declaration and its reader's stored
   * config are both in scope. `resolveWidgetSettings` returns only DECLARED
   * names, so a component cannot act on a key its widget never offered.
   */
  const placement = useMemo(
    () => ({
      id: row.placementId,
      settings: resolveWidgetSettings(widget.settings, row.config),
    }),
    [row.placementId, widget.settings, row.config]
  );
  const { floating: floatingControl, header: dismissControl } =
    dismissAffordance(widget, props, on.dismiss);
  const width = drawnWidth(row.width, row.allowedWidths);

  // While customising, the card's width and its one menu, side by side. A
  // framed card shows them in its own header; an unframed one in the small
  // header the cell draws for it below.
  const editActions = isEditing ? (
    <span className="flex items-center gap-1" data-testid="card-edit-actions">
      <CardWidthLabel width={width} />
      <CardActionsMenu
        title={widget.title}
        width={width}
        allowedWidths={row.allowedWidths}
        can={can}
        disabled={isWriting}
        triggerRef={refs.menu}
        on={{
          move: on.move,
          setWidth: on.setWidth,
          remove: on.remove,
          ...(hasSettings ? { openSettings: () => setSettingsOpen(true) } : {}),
        }}
      />
    </span>
  ) : null;
  const unframed = widget.chrome === "none";
  const headerAction = unframed ? undefined : (editActions ?? dismissControl);

  return (
    <SortableWidgetCell
      id={row.placementId}
      title={widget.title}
      isEditing={isEditing}
      data-testid={`widget-cell-${widget.id}`}
      className={cn(
        // `relative` so the drag handle, which is absolutely positioned, lands
        // on this cell rather than on the grid.
        "relative",
        // 🔴 The PLACEMENT's width, drawn at the nearest width its widget
        // allows. The stored width IS the reader's arrangement, so it is never
        // replaced by the declaration's default here.
        cardSpanClass(row.width, row.allowedWidths),
        // `empty:hidden` so a widget that drew NOTHING costs no grid row: an
        // unframed widget whose component returned null, which core's
        // conditional sections do. A framed widget always renders its card.
        "empty:hidden",
        // The same collapse, asked of the BODY, for a cell that also carries a
        // floated dismiss control: that control comes from the declaration, so
        // it is present even when the widget renders nothing. `:empty` on the
        // body counts text nodes, which `:only-child` on the control would not.
        "has-[>[data-widget-body]:empty]:hidden",
        // An unframed widget is a SECTION, and sections on this page sit 48px
        // apart: 24px of trailing margin plus the grid's 24px gap. Bottom only,
        // so the first row is not pushed down from the welcome header.
        unframed && "mb-6"
      )}
    >
      {unframed && editActions ? (
        // An unframed widget draws no header of its own, so while customising
        // the cell gives it a small one: the card's name and its controls.
        // `pl-9` leaves room for the drag handle, which sits over its left end.
        <div
          className="flex items-center gap-2 rounded-t-lg border-b border-border bg-muted/40 py-1 pl-9 pr-2"
          data-testid="widget-edit-header"
        >
          <span className="mr-auto truncate text-xs font-medium text-muted-foreground">
            {widget.title}
          </span>
          {editActions}
        </div>
      ) : null}
      {floatingControl}
      {/* Mounted whenever the widget offers settings, not only while
          customising. A closed `Sheet` renders nothing, so this costs a card
          nothing — and it is what lets the panel outlive customise mode rather
          than being torn out from under a reader still filling it in. */}
      {hasSettings ? (
        <WidgetSettingsSheet
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          title={widget.title}
          settings={widget.settings ?? []}
          config={row.config}
          onSave={on.saveSettings}
        />
      ) : null}
      {floatingControl !== undefined ? (
        // The body's own slot, so the cell can ask whether the widget drew
        // anything. Present only where a floated control shares the cell.
        <div data-widget-body>
          <WidgetRenderer definition={widget} placement={placement} {...data} />
        </div>
      ) : (
        // 🔴 A DIRECT child otherwise, because the cell's `empty:hidden` reads
        // `:empty` -- which counts element children, not rendered output. An
        // always-present wrapper made every cell non-empty.
        <WidgetRenderer
          definition={widget}
          placement={placement}
          headerAction={headerAction}
          customizing={isEditing}
          {...data}
        />
      )}
    </SortableWidgetCell>
  );
}
