"use client";

/**
 * What a custom card answered by a list reports to the frame in place of its
 * rows, or the list it was answered with.
 *
 * What its slot says while it has no list to draw (`readSlot`), and an error
 * for an answer that is not a list. The frame draws each (`FrameState`); ONE
 * reading, so the custom list cards report them alike.
 *
 * @module components/features/widgets/frame/list-slot
 */

import type {
  WidgetComponentProps,
  WidgetResult,
  WidgetSlot,
} from "nextly/widget-result";
import type { JSX } from "react";

import { useNowTick } from "@admin/hooks/useNowTick";

import { FrameState, readSlot } from "./card-state";
import { rowsDrawn, useCardTier, useRowsTier } from "./tier";

/** A list answer, the one shape these cards are drawn from. */
export type ListAnswer = Extract<WidgetResult, { op: "list" }>;

/** What the card reports instead of its rows, or the answer to draw them from. */
export type ListSlotReading = { node: JSX.Element } | { list: ListAnswer };

export function readListSlot({
  slot,
  isFetching,
  rows,
  onRetry,
}: {
  slot: WidgetSlot | undefined;
  isFetching: boolean | undefined;
  /** How many rows the card draws, so its loading rows hold their place. */
  rows: number;
  onRetry?: (() => void) | undefined;
}): ListSlotReading {
  const read = readSlot(slot, {
    isFetching,
    skeleton: { shape: "rows", rows, layout: { kind: "list" } },
    onRetry,
  });
  if ("state" in read) return { node: <FrameState state={read.state} /> };
  if (read.result.op !== "list") {
    return {
      node: (
        <FrameState
          state={{
            kind: "error",
            message: "This card was answered with something other than a list.",
          }}
        />
      ),
    };
  }
  return { list: read.result };
}

/**
 * A custom list card's tier, the rows it draws, the instant its relative times
 * are read from, and its slot read: what every such card starts with.
 *
 * The rows are the card's tier's, at most the reader's "Number of items", from
 * the query it was handed; the clock ticks, so "5m ago" moves on as time passes.
 */
export function useListCard({
  slot,
  isFetching,
  query,
  onRetry,
}: Pick<WidgetComponentProps, "slot" | "isFetching" | "query" | "onRetry">): {
  tier: NonNullable<ReturnType<typeof useCardTier>>;
  drawn: number;
  now: number;
  read: ListSlotReading;
} {
  // Medium until the card has measured itself, which it does before its first paint.
  const tier = useCardTier() ?? "medium";
  const drawn = rowsDrawn(useRowsTier(tier), query?.limit);
  const now = useNowTick();
  const read = readListSlot({ slot, isFetching, rows: drawn, onRetry });
  return { tier, drawn, now, read };
}
