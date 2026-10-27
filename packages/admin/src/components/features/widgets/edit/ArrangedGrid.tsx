"use client";
/**
 * The dashboard's cards, drawn as ONE ordered list on a twelve-column grid.
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
 * No dense packing: cards are laid out in list order, each spanning its `w`
 * columns and `h` rows, so the order a reader arranged is the order they read,
 * left to right and down. A short card beside a tall one can leave a gap below
 * it; no later card is moved up to fill it.
 *
 * @module components/features/widgets/edit/ArrangedGrid
 */
import type { SizeTier } from "@nextlyhq/ui/format";
import type { GridSize } from "nextly/config";
import type { JSX, RefObject } from "react";

import type { CellSlots } from "@admin/hooks/queries/useWidgetQueries";
import { cn } from "@admin/lib/utils";
import type {
  WidgetPlacement,
  WidgetSlot,
} from "@admin/types/dashboard/widgets";

import {
  moveAvailability,
  type IsDrawn,
  type MoveDirection,
} from "../layout-editor";
import { resolveWidgetOutcome } from "../outcome";
import { cardRowStyle, GRID_CLASS } from "../sizes";

import { ArrangedCell } from "./ArrangedCell";
import type { DropLine } from "./drag/drop-geometry";
import type { CardDrag } from "./drag/useCardDrag";
import type { CellDrag } from "./DraggableWidgetCell";
import type { CellSettingsWrite } from "./useCardQuickSetting";
import type { CardSettingsWriteCallbacks } from "./useCardSettingsWrite";
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
  /** What a card may write now, and how: one prop, as they are one concern. */
  writes: {
    /** Whether a layout write is in flight anywhere on this dashboard. */
    isWriting: boolean;
    /** Why a single-card write is unavailable right now, when it is. */
    singleCardWriteBlocked?: string | undefined;
    /**
     * How a card's settings are saved at once, outside customise mode. ABSENT while customising
     * and before an arrangement has been read; see `ArrangedCell`'s `settingsWrite`.
     */
    settings?:
      | {
          write: (
            placementId: string,
            title: string,
            config: Record<string, unknown>,
            callbacks: CardSettingsWriteCallbacks
          ) => void;
          isWriting: boolean;
          unavailable?: string;
          announce: (
            title: string,
            setting: string,
            value: string,
            shown: boolean
          ) => void;
        }
      | undefined;
  };
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
    setSize: (placementId: string, size: GridSize) => void;
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
      // Two rows, so its sentence fits inside the grid's fixed row height.
      style={cardRowStyle(2)}
      className="col-span-full flex items-center justify-center rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
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

/** One card's handle drag, bound to its placement; absent while dragging is off. */
function cellDragFor(
  drag: ArrangedGridProps["drag"],
  focus: ArrangedGridProps["focus"],
  placementId: string
): CellDrag | undefined {
  if (!drag?.enabled) return undefined;
  return {
    held: drag.drag?.placementId === placementId,
    onKeyDown: event => drag.onHandleKeyDown(placementId, event),
    onBlur: () => drag.onHandleBlur(placementId),
    handleRef: focus.handleRef(placementId),
  };
}

/**
 * The grid's settings write, bound to one card: its placement, and its title to announce by. No
 * prop at all while the grid has none, so the cell draws no control that could not save.
 */
function cellSettingsWrite(
  settingsWrite: ArrangedGridProps["writes"]["settings"],
  row: ArrangedWidget
): { settingsWrite?: CellSettingsWrite } {
  if (!settingsWrite) return {};
  return {
    settingsWrite: {
      write: (config, callbacks) =>
        settingsWrite.write(
          row.placementId,
          row.widget.title,
          config,
          callbacks
        ),
      isWriting: settingsWrite.isWriting,
      ...(settingsWrite.unavailable === undefined
        ? {}
        : { unavailable: settingsWrite.unavailable }),
      announce: (setting, value, shown) =>
        settingsWrite.announce(row.widget.title, setting, value, shown),
    },
  };
}

/**
 * Whether a card is off the dashboard because its widget hides when empty and its answer is, by
 * the outcome the renderer draws from (`resolveWidgetOutcome`), so the two cannot disagree.
 */
function hiddenWhileEmpty(
  row: ArrangedWidget,
  slots: Record<string, WidgetSlot>,
  cellSlots: CellSlots
): boolean {
  if (row.widget.hidesWhenEmpty !== true) return false;
  const outcome = resolveWidgetOutcome(
    row.widget,
    slots[row.placementId],
    key => cellSlots[row.placementId]?.[key]
  );
  return outcome.state === "empty";
}

/**
 * When the OLDEST answer on show arrived, or `undefined` before any has: the time the page's one
 * freshness line is true of, since every card on show is at least that fresh. Only a card that
 * asked and is drawn counts: a card hidden while its answer is empty is not on show.
 */
function oldestAnswer(
  rows: readonly ArrangedWidget[],
  answers: {
    requested: ReadonlySet<string>;
    slots: Record<string, WidgetSlot>;
    cellSlots: CellSlots;
    updatedAtFor: (placementId: string) => Date | null;
  }
): Date | undefined {
  let oldest: Date | undefined;
  for (const row of rows) {
    if (!answers.requested.has(row.placementId)) continue;
    if (hiddenWhileEmpty(row, answers.slots, answers.cellSlots)) continue;
    const at = answers.updatedAtFor(row.placementId);
    if (at !== null && (oldest === undefined || at < oldest)) oldest = at;
  }
  return oldest;
}

export function ArrangedGrid({
  rows,
  placements,
  isDrawn,
  isEditing,
  highlightedId = null,
  drag,
  writes,
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
}: ArrangedGridProps): JSX.Element {
  const answeredAt = oldestAnswer(rows, {
    requested,
    slots,
    cellSlots,
    updatedAtFor,
  });
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
        // The grid's columns, rows and gaps (`GRID_CLASS`), the ones a card's predicted width
        // counts. `relative` so the drop line is placed from the grid's own corner, where the
        // drag measures from.
        className={cn("relative", GRID_CLASS)}
        // When the oldest answer on show arrived, for the page's one freshness line: no card
        // says when its own data arrived.
        data-answered-at={answeredAt?.toISOString()}
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
            // At one column each card menu lists its sizes in place, where a submenu has no room.
            sizesInPlace={drag?.oneColumn === true}
            drag={cellDragFor(drag, focus, row.placementId)}
            isWriting={writes.isWriting}
            singleCardWriteBlocked={writes.singleCardWriteBlocked}
            {...cellSettingsWrite(writes.settings, row)}
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
              setSize: size => on.setSize(row.placementId, size),
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
