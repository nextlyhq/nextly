"use client";

/**
 * What a custom card answered by a list draws in place of its rows, or the
 * list it was answered with.
 *
 * Its loading rows while the first answer is on the way, nothing when no
 * request is in flight, the frame's own "not available" or error with Retry,
 * and an error for an answer that is not a list. ONE reading, so the custom
 * list cards say each of these alike.
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

import { CardError, CardSkeleton, CardSlotFailure } from "./states";
import { rowsDrawn, useCardTier, useRowsTier } from "./tier";

/** A list answer, the one shape these cards are drawn from. */
export type ListAnswer = Extract<WidgetResult, { op: "list" }>;

/** What the card draws instead of its rows, or the answer to draw them from. */
export type ListSlotReading =
  | { node: JSX.Element | null }
  | { list: ListAnswer };

export function readListSlot({
  slot,
  isFetching,
  rows,
  title,
  onRetry,
}: {
  slot: WidgetSlot | undefined;
  isFetching: boolean | undefined;
  /** How many rows the card draws, so its loading rows hold their place. */
  rows: number;
  /** The card's heading in its error state. */
  title: string;
  onRetry?: (() => void) | undefined;
}): ListSlotReading {
  if (!slot) {
    return {
      node: isFetching ? (
        <CardSkeleton shape="rows" rows={rows} layout={{ kind: "list" }} />
      ) : null,
    };
  }
  if (!slot.ok) {
    return {
      node: <CardSlotFailure slot={slot} title={title} onRetry={onRetry} />,
    };
  }
  if (slot.result.op !== "list") {
    return {
      node: (
        <CardError
          message="This card was answered with something other than a list."
          title={title}
        />
      ),
    };
  }
  return { list: slot.result };
}

/**
 * A custom list card's tier, the rows it draws, the instant its relative times
 * are read from, and its slot read: what every such card starts with.
 *
 * The rows are the card's tier's, at most the reader's "Number of items", from
 * the query it was handed; the clock ticks, so "5m ago" moves on as time passes.
 */
export function useListCard(
  {
    slot,
    isFetching,
    query,
    onRetry,
  }: Pick<WidgetComponentProps, "slot" | "isFetching" | "query" | "onRetry">,
  title: string
): {
  tier: NonNullable<ReturnType<typeof useCardTier>>;
  drawn: number;
  now: number;
  read: ListSlotReading;
} {
  // Medium until the card has measured itself, which it does before its first paint.
  const tier = useCardTier() ?? "medium";
  const drawn = rowsDrawn(useRowsTier(tier), query?.limit);
  const now = useNowTick();
  const read = readListSlot({ slot, isFetching, rows: drawn, title, onRetry });
  return { tier, drawn, now, read };
}
