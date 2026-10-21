"use client";
/**
 * The dashboard's cards, drawn as ONE ordered list on a twelve-track grid.
 *
 * Lifted out of `WidgetGrid` so the grid component reads as what it
 * orchestrates -- permissions, the arrangement, the batch, the drag context --
 * rather than as those plus a nested render.
 *
 * ## Sized by the dashboard, not the window
 *
 * The tracks sit inside the `@container/dashboard` wrapper `WidgetGrid` draws,
 * and each card's span answers to that container (`sizes.ts`). A dashboard squeezed by an open
 * sidebar therefore draws the band that fits the space it actually has. The
 * wrapper is a separate element because a container query cannot be answered
 * by the element it styles.
 *
 * No dense packing: cards are laid out in list order, so the order a reader
 * arranged is the order they read, left to right and down.
 *
 * @module components/features/widgets/edit/ArrangedGrid
 */
import type { SizeTier } from "@nextlyhq/ui/format";
import type { RefObject } from "react";

import type { CellSlots } from "@admin/hooks/queries/useWidgetQueries";
import type {
  WidgetPlacement,
  WidgetSlot,
  WidgetWidth,
} from "@admin/types/dashboard/widgets";

import {
  moveAvailability,
  type IsDrawn,
  type MoveDirection,
} from "../layout-editor";

import { ArrangedCell } from "./ArrangedCell";
import type { DropLine } from "./drag/drop-geometry";
import type { CardDrag } from "./drag/useCardDrag";
import type { ArrangedWidget } from "./useDashboardArrangement";
import type { DashboardFocus } from "./useDashboardFocus";

export interface ArrangedGridProps {
  /** The cards to draw, in order. */
  rows: ArrangedWidget[];
  /** The whole list the rows came from, which a move's availability counts. */
  placements: readonly WidgetPlacement[];
  isDrawn: IsDrawn;
  isEditing: boolean;
  /** The card just placed (moved, resized, added or put back), ringed until the next. */
  highlightedId?: string | null;
  /**
   * The drag, for its handles and its line. Its handles are drawn only while it is `enabled`:
   * at one column the card menu moves cards.
   */
  drag?: Pick<
    CardDrag,
    | "enabled"
    | "oneColumn"
    | "drag"
    | "line"
    | "onHandleKeyDown"
    | "onHandleBlur"
  >;
  /** Whether a layout write is in flight anywhere on this dashboard. */
  isWriting: boolean;
  /** Why a single-card write is unavailable right now, when it is. */
  singleCardWriteBlocked?: string;
  slots: Record<string, WidgetSlot>;
  cellSlots: CellSlots;
  requested: ReadonlySet<string>;
  /** When the answer one card shows arrived: its own retry's, or the batch's. */
  updatedAtFor: (placementId: string) => Date | null;
  /** The tier the answer one card shows was fetched at. */
  fetchedTierFor: (placementId: string) => SizeTier | undefined;
  /** The placements whose OWN request is still in flight. */
  fetchingPlacementIds: ReadonlySet<string>;
  /** Reload one card's data on its own, from its error state's Retry. */
  retry: (placementId: string) => void;
  announcement: string;
  focus: Pick<DashboardFocus, "menuRef" | "dismissRef" | "handleRef">;
  /** The region's own ref: where focus lands when nothing nearer can take it. */
  gridRef: RefObject<HTMLElement | null>;
  on: {
    move: (placementId: string, direction: MoveDirection) => void;
    setWidth: (placementId: string, width: WidgetWidth) => void;
    remove: (placementId: string) => void;
    /** ABSENT before an arrangement has been read. */
    dismiss?: (placementId: string, title: string) => void;
    saveSettings: (
      placementId: string,
      config: Record<string, unknown>
    ) => void;
  };
}

function EmptyArrangement({
  count,
  isEditing,
}: {
  count: number;
  isEditing: boolean;
}) {
  if (count > 0) return null;
  return (
    <p
      data-testid="widget-grid-empty"
      className="col-span-full rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground"
    >
      {isEditing
        ? "Every card is removed. Put one back from Add widget, or reset to the default dashboard."
        : // Customise mode is offered at every width, so the way back is the same on a phone.
          "Your dashboard has no cards on it. Customize it to bring one back, or reset to the default dashboard."}
    </p>
  );
}

/**
 * The line where a dragged card will land: beside the card it goes after, or across the grid
 * where it starts a row. Centred in the gap between cards, in the primary colour, and drawn
 * only, never announced: the drag says the same in words.
 */
function DropLineMark({ line }: { line: DropLine | undefined }) {
  if (line === undefined) return null;
  const style =
    line.orientation === "vertical"
      ? { left: line.x - 1, top: line.top, width: 2, height: line.length }
      : { left: line.x, top: line.y - 1, width: line.length, height: 2 };
  return (
    <div
      aria-hidden
      data-testid="widget-drop-line"
      data-orientation={line.orientation}
      className="pointer-events-none absolute z-20 rounded-full bg-primary"
      style={style}
    />
  );
}

export function ArrangedGrid({
  rows,
  placements,
  isDrawn,
  isEditing,
  highlightedId = null,
  drag,
  isWriting,
  singleCardWriteBlocked,
  slots,
  cellSlots,
  requested,
  updatedAtFor,
  fetchedTierFor,
  fetchingPlacementIds,
  retry,
  announcement,
  focus,
  gridRef,
  on,
}: ArrangedGridProps) {
  return (
    // The cards' spans answer to the `@container/dashboard` element `WidgetGrid` draws around
    // this, the one element the dashboard's width is measured from.
    <div>
      <section
        ref={gridRef}
        aria-label="Dashboard widgets"
        // Focusable only PROGRAMMATICALLY (`-1` keeps it out of the Tab
        // sequence), so focus has somewhere to land when the element holding
        // it is taken off the page.
        tabIndex={-1}
        // The gap in pixels, the GRID_GAP_PX a card's predicted width counts. `relative` so the
        // drop line is placed from the grid's own corner, where the drag measures from.
        className="relative grid grid-cols-12 gap-[24px]"
      >
        <span
          role="status"
          aria-live="polite"
          className="sr-only"
          data-testid="widget-grid-live"
        >
          {announcement}
        </span>
        <EmptyArrangement count={rows.length} isEditing={isEditing} />
        <DropLineMark line={drag?.line} />
        {rows.map(row => (
          <ArrangedCell
            key={row.placementId}
            row={row}
            isEditing={isEditing}
            highlighted={highlightedId === row.placementId}
            // At one column each card menu lists its widths in place, where a submenu has no room.
            widthsInPlace={drag?.oneColumn === true}
            drag={
              drag?.enabled
                ? {
                    held: drag.drag?.placementId === row.placementId,
                    onKeyDown: event =>
                      drag.onHandleKeyDown(row.placementId, event),
                    onBlur: () => drag.onHandleBlur(row.placementId),
                    handleRef: focus.handleRef(row.placementId),
                  }
                : undefined
            }
            isWriting={isWriting}
            singleCardWriteBlocked={singleCardWriteBlocked}
            // The same rule the move applies, so an item is enabled exactly
            // when choosing it would move the card.
            can={moveAvailability(placements, row.placementId, isDrawn)}
            data={{
              slot: slots[row.placementId],
              // This card's own answers, by cell key.
              slotFor: key => cellSlots[row.placementId]?.[key],
              // Only a card that actually ASKED can be waiting on an answer.
              updatedAt: requested.has(row.placementId)
                ? updatedAtFor(row.placementId)
                : null,
              // 🔴 This card's own request, not the batch's: partitions
              // settle independently, and a settled card must not dim.
              isFetching: fetchingPlacementIds.has(row.placementId),
              answerTier: fetchedTierFor(row.placementId),
              // Retry only for a card in the batch: one rejected before it was asked has no
              // question to ask again, so the button could change nothing.
              onRetry: requested.has(row.placementId)
                ? () => retry(row.placementId)
                : undefined,
            }}
            refs={{
              menu: focus.menuRef(row.placementId),
              dismiss: focus.dismissRef(row.placementId),
            }}
            on={{
              move: direction => on.move(row.placementId, direction),
              setWidth: width => on.setWidth(row.placementId, width),
              remove: () => on.remove(row.placementId),
              ...(on.dismiss
                ? {
                    dismiss: () =>
                      on.dismiss?.(row.placementId, row.widget.title),
                  }
                : {}),
              saveSettings: config => on.saveSettings(row.placementId, config),
            }}
          />
        ))}
      </section>
    </div>
  );
}
