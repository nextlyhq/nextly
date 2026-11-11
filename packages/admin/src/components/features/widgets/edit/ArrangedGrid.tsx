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
import type {
  GridSize,
  PublishedContentSource,
  WidgetSizeBounds,
} from "nextly/config";
import { useContext, useMemo, type JSX, type RefObject } from "react";

import type { AskedWith } from "@admin/hooks/queries/useWidgetQueries";
import { cn } from "@admin/lib/utils";
import type {
  DashboardWidget,
  WidgetPlacement,
  WidgetSlot,
} from "@admin/types/dashboard/widgets";

import type { AnswerSize } from "../frame/tier";
import {
  moveAvailability,
  type IsDrawn,
  type MoveDirection,
} from "../layout-editor";
import { widenLoneOfPair, WidenLonePairContext } from "../lone-pair";
import { useReportedPlacements } from "../reported-placements";
import { GRID_CLASS } from "../sizes";
import { settingsAsAsked, titleAsAsked } from "../widget-as-asked";

import { ArrangedCell, type ArrangedCellProps } from "./ArrangedCell";
import type { CardDrag } from "./drag/useCardDrag";
import type { CardResize } from "./drag/useCardResize";
import type { CellDrag, CellResize } from "./DraggableWidgetCell";
import { isEntriesSetting } from "./drawer-choices";
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
   * The drag, for its handles and the order it has reached. Its handles are drawn only while it
   * is `enabled`: at one column the card menu moves cards.
   */
  drag?: Pick<CardDrag, "enabled" | "drag">;
  /**
   * The edge resize, for each card's right edge and the width one is held at. Its edges are
   * drawn only from 1,024px, and never while a card is dragged.
   */
  resize?: Pick<CardResize, "resizing" | "edgeFor">;
  /** What a card may write now, and how: one prop, as they are one concern. */
  writes: {
    /** Whether a layout write is in flight anywhere on this dashboard. */
    isWriting: boolean;
    /**
     * The reader's collections, as the server published them: what a card is titled by, and so
     * what a write or a removal names it by (`shownTitleOf`).
     */
    sources?: readonly PublishedContentSource[] | undefined;
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
            callbacks: CardSettingsWriteCallbacks,
            /** The title the reader gave the card, where the change sets it. */
            ownTitle?: string,
            /**
             * The card's size, where the change sets it (the settings drawer's Width), with its
             * widget's bounds, which the size is held to.
             */
            size?: { size: GridSize; bounds: WidgetSizeBounds }
          ) => void;
          isWriting: boolean;
          unavailable?: string;
          /**
           * Say a setting changed, in the grid's live region: for a card body's own controls,
           * which offer no Undo. A quick setting says its change in the toast that offers one.
           */
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
  requested: ReadonlySet<string>;
  /** When the answer one card shows arrived: its own retry's, or the batch's. */
  updatedAtFor: (placementId: string) => Date | null;
  /** When one card's own answer arrived: its own retry's, or its own request's in the batch. */
  answeredAtFor: (placementId: string) => Date | null;
  /**
   * What the answer one card shows was asked with, its size and settings: its own re-ask's, or
   * the batch's.
   */
  fetchedAskFor: (placementId: string) => AskedWith | undefined;
  /** The placements whose OWN request is still in flight. */
  fetchingPlacementIds: ReadonlySet<string>;
  /** Reload one card's data on its own, from its error state's Retry. */
  retry: (placementId: string) => void;
  announcement: string;
  focus: Pick<DashboardFocus, "menuRef" | "dismissRef">;
  /** The region's own ref: where focus lands when nothing nearer can take it. */
  gridRef: RefObject<HTMLElement | null>;
  on: {
    move: (placementId: string, direction: MoveDirection) => void;
    setSize: (placementId: string, size: GridSize) => void;
    remove: (placementId: string) => void;
    /** ABSENT before an arrangement has been read. */
    dismiss?: (placementId: string, title: string) => void;
    /** A card's settings, and its own title where the change sets one. */
    saveSettings: (
      placementId: string,
      config: Record<string, unknown>,
      ownTitle?: string
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
      className="col-span-full flex items-center justify-center rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
    >
      {isEditing
        ? "Every card is removed. Put one back from Add widget, or reset to the default dashboard."
        : // Customise mode is offered at every width, so the way back is the same on a phone.
          "Your dashboard has no cards on it. Customize it to bring one back, or reset to the default dashboard."}
    </p>
  );
}

/** One card's handle drag; absent while dragging is off. */
function cellDragFor(
  drag: ArrangedGridProps["drag"],
  placementId: string
): CellDrag | undefined {
  if (!drag?.enabled) return undefined;
  return { held: drag.drag?.placementId === placementId };
}

/** One card's edge, and the width it is held at; absent where it has none or a card is held. */
function cellResizeFor(
  drag: ArrangedGridProps["drag"],
  resize: ArrangedGridProps["resize"],
  row: ArrangedWidget
): CellResize | undefined {
  if (resize === undefined || drag?.drag) return undefined;
  const edge = resize.edgeFor(row);
  if (edge === undefined) return undefined;
  const held = resize.resizing;
  return held?.placementId === row.placementId
    ? { edge, resizingTo: held.w }
    : { edge };
}

/**
 * Each card's place in the order a drag has reached, for the grid to lay them out by; empty
 * while no card is held, when the cards are drawn in their own order.
 */
function dragOrder(
  drag: ArrangedGridProps["drag"]
): ReadonlyMap<string, number> {
  const order = drag?.drag?.order;
  return new Map(order?.map((id, index) => [id, index]) ?? []);
}

/**
 * The card as its cell draws it: at the width its edge is held at while it is resized, so the
 * card, its width label and the cards around it show the width the release would keep.
 */
function shownRow(
  row: ArrangedWidget,
  resizing: CardResize["resizing"] | undefined
): ArrangedWidget {
  if (resizing?.placementId !== row.placementId) return row;
  return { ...row, size: { ...row.size, w: resizing.w } };
}

/**
 * The grid's settings write, bound to one card: its placement, its title and its bounds. No
 * prop at all while the grid has none, so the cell draws no control that could not save.
 */
function cellSettingsWrite(
  settingsWrite: ArrangedGridProps["writes"]["settings"],
  row: ArrangedWidget,
  /** The title the card is drawn under, which what a write says names it by. */
  shownTitle: string
): { settingsWrite?: CellSettingsWrite } {
  if (!settingsWrite) return {};
  return {
    settingsWrite: {
      write: (config, callbacks, ownTitle, size) =>
        settingsWrite.write(
          row.placementId,
          shownTitle,
          config,
          callbacks,
          ownTitle,
          size === undefined ? undefined : { size, bounds: row.widget.size }
        ),
      isWriting: settingsWrite.isWriting,
      ...(settingsWrite.unavailable === undefined
        ? {}
        : { unavailable: settingsWrite.unavailable }),
    },
  };
}

/**
 * How many cards are on show: every one while customising, where a hidden card is shown marked;
 * at rest, those whose card has not reported itself off the dashboard (`hidden`), so a dashboard
 * whose every card is hidden says it is empty rather than drawing nothing. Counted from the cards'
 * own reports (`useReportCardHidden`), the decision each card is drawn by, its body's reported
 * state included; a card that reports nothing is on show.
 */
function shownCount(
  rows: readonly ArrangedWidget[],
  isEditing: boolean,
  hidden: ReadonlySet<string>
): number {
  if (isEditing) return rows.length;
  return rows.filter(row => !hidden.has(row.placementId)).length;
}

/**
 * When the OLDEST answer on show arrived, or `undefined` before any has: the time the page's one
 * freshness line is true of, since every card on show is at least that fresh. Only a card that
 * asked and is drawn counts: a card that reported itself off the dashboard (`hidden`) is not on
 * show.
 */
function oldestAnswer(
  rows: readonly ArrangedWidget[],
  answers: {
    hidden: ReadonlySet<string>;
    requested: ReadonlySet<string>;
    updatedAtFor: (placementId: string) => Date | null;
  }
): Date | undefined {
  let oldest: Date | undefined;
  for (const row of rows) {
    if (!answers.requested.has(row.placementId)) continue;
    if (answers.hidden.has(row.placementId)) continue;
    const at = answers.updatedAtFor(row.placementId);
    if (at !== null && (oldest === undefined || at < oldest)) oldest = at;
  }
  return oldest;
}

/**
 * The title a card is drawn under, as its cell draws it (`titleAsAsked`): what a write or a
 * removal says names the card by it, so two copies of one widget are told apart.
 */
function shownTitleOf(
  row: ArrangedWidget,
  sources: ArrangedGridProps["writes"]["sources"]
): string {
  return titleAsAsked(row.widget, row.config, sources, row.ownTitle).title;
}

/**
 * What an answer was fetched with, as a card counts its rows by it: the "Number of entries" its
 * settings asked for, read as the card reads its own (`settingsAsAsked`), so a number its widget
 * sets by default counts as the card would have drawn it. Only for a widget that declares that
 * setting (`limit`), whose `load` reads by it: a widget's own component may hand its list a
 * limit of its own with no such setting, and its answer then holds what its `load` chose, which
 * no setting says. `undefined` for that, and for an answer not asked.
 */
export function answerSizeOf(
  widget: DashboardWidget,
  asked: AskedWith | undefined,
  sources: ArrangedGridProps["writes"]["sources"]
): AnswerSize | undefined {
  if (asked === undefined) return undefined;
  if (!(widget.settings ?? []).some(isEntriesSetting)) {
    return undefined;
  }
  return { items: settingsAsAsked(widget, asked.settings, sources).limit };
}

/** What the batch answered for one card, as its cell draws it (`ArrangedCellProps.data`). */
function cellData(
  row: ArrangedWidget,
  answers: Pick<
    ArrangedGridProps,
    | "slots"
    | "requested"
    | "answeredAtFor"
    | "fetchingPlacementIds"
    | "fetchedAskFor"
    | "retry"
  >,
  sources: ArrangedGridProps["writes"]["sources"]
): ArrangedCellProps["data"] {
  const { placementId } = row;
  const asked = answers.requested.has(placementId);
  return {
    slot: answers.slots[placementId],
    // Only a card that actually ASKED can be waiting on an answer. Its own answer's time, not
    // the page's oldest: its quick change is said once its own answer is in.
    updatedAt: asked ? answers.answeredAtFor(placementId) : null,
    // 🔴 This card's own request, not the batch's: partitions settle independently, and a
    // settled card must not dim.
    isFetching: answers.fetchingPlacementIds.has(placementId),
    // The "Number of entries" its answer was fetched with: a card whose reader asked for more
    // keeps its old answer on screen while the new one loads, and drawn by the new number that
    // answer's one row past its rows, the sign that more exist, would read as a row.
    answerSize: answerSizeOf(
      row.widget,
      answers.fetchedAskFor(placementId),
      sources
    ),
    // Retry only for a card in the batch: one rejected before it was asked has no question to
    // ask again, so the button could change nothing.
    onRetry: asked ? () => answers.retry(placementId) : undefined,
  };
}

/** No card drawn at another width than its own. */
const NONE_WIDENED: ReadonlyMap<string, number> = new Map();

/**
 * The widths cards are drawn at in place of their own, by placement: at rest where the lone card
 * of the pair is widened (`widenLoneOfPair`), a card being on show unless it reported itself off
 * the dashboard (`hidden`, the same reports the grid counts by), so no second rule decides it.
 * While customising every card is shown, hidden ones marked, so nothing is widened and each card
 * shows the size a save would keep. Only a cell's column span reads these: the card, its
 * controls and every write keep its stored size.
 */
function drawnWidths(
  rows: ArrangedWidget[],
  widen: boolean,
  hidden: ReadonlySet<string>
): ReadonlyMap<string, number> {
  if (!widen) return NONE_WIDENED;
  return widenLoneOfPair(rows, row => !hidden.has(row.placementId));
}

/**
 * What the grid draws its cards from: the cards that reported themselves off the dashboard
 * (`useReportedPlacements`), the oldest answer on show, and the widths cards are drawn at in place
 * of their own ({@link drawnWidths}), only where `WidenLonePairContext` says so and never while
 * customising. Memoised, so the cells are handed the same widths until a report or the
 * arrangement moves.
 */
function useGridRows(
  rows: ArrangedWidget[],
  isEditing: boolean,
  answers: Omit<Parameters<typeof oldestAnswer>[1], "hidden">
) {
  const { placements: hidden, report: reportHidden } = useReportedPlacements();
  const widen = useContext(WidenLonePairContext) && !isEditing;
  const widths = useMemo(
    () => drawnWidths(rows, widen, hidden),
    [rows, widen, hidden]
  );
  return {
    hidden,
    reportHidden,
    widths,
    answeredAt: oldestAnswer(rows, { hidden, ...answers }),
  };
}

export function ArrangedGrid({
  rows,
  placements,
  isDrawn,
  isEditing,
  highlightedId = null,
  drag,
  resize,
  writes,
  announcement,
  focus,
  gridRef,
  on,
  // What the batch answered, handed to each card as one (`cellData`).
  ...answers
}: ArrangedGridProps): JSX.Element {
  // The cards that reported themselves off the dashboard, each as it is drawn, and the widths
  // cards are drawn at in place of their own.
  const { hidden, reportHidden, widths, answeredAt } = useGridRows(
    rows,
    isEditing,
    answers
  );
  const order = dragOrder(drag);
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
        // counts: rows as tall as their tallest card, at rest and while customising.
        // `relative` so each cell's layout offsets are from the grid's own corner, where the
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
        <EmptyArrangement
          count={shownCount(rows, isEditing, hidden)}
          isEditing={isEditing}
        />
        {rows.map(row => (
          <ArrangedCell
            key={row.placementId}
            row={shownRow(row, resize?.resizing)}
            drawnW={widths.get(row.placementId)}
            isEditing={isEditing}
            highlighted={highlightedId === row.placementId}
            drag={cellDragFor(drag, row.placementId)}
            resize={cellResizeFor(drag, resize, row)}
            order={order.get(row.placementId)}
            isWriting={writes.isWriting}
            singleCardWriteBlocked={writes.singleCardWriteBlocked}
            {...cellSettingsWrite(
              writes.settings,
              row,
              shownTitleOf(row, writes.sources)
            )}
            reportHidden={reportHidden}
            // The same rule the move applies, so an item is enabled exactly
            // when choosing it would move the card.
            can={moveAvailability(placements, row.placementId, isDrawn)}
            data={cellData(row, answers, writes.sources)}
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
                      on.dismiss?.(
                        row.placementId,
                        shownTitleOf(row, writes.sources)
                      ),
                  }
                : {}),
              saveSettings: (config, ownTitle) =>
                on.saveSettings(row.placementId, config, ownTitle),
            }}
          />
        ))}
      </section>
    </div>
  );
}
