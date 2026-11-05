"use client";

/**
 * What every one of core's own list cards drawn by its own component starts
 * with: its tier, the rows it draws, their density, and the instant its
 * relative times are read from.
 *
 * The rows are the card's tier's, at most the reader's "Number of items" (the
 * rule's own default for a card that offers none), by the rule the card's
 * `load` asked them by, one more than drawn; the clock ticks, so "5m ago"
 * moves on as time passes. The frame drew loading, no permission and error
 * before such a card is reached, so there is no answer to read here.
 *
 * @module components/features/widgets/frame/list-card-hook
 */

import type { ListDensity } from "nextly/config";

import { useNowTick } from "@admin/hooks/useNowTick";

import { useListDensity } from "./list-rows";
import { useCardTier, useRowsDrawn } from "./tier";

export function useListCard(
  /** The reader's "Number of items", as the card's settings hold it. */
  limit: unknown
): {
  tier: NonNullable<ReturnType<typeof useCardTier>>;
  drawn: number;
  /** The density the card's rows are drawn at. */
  density: ListDensity;
  now: number;
} {
  // Medium until the card has measured itself, which it does before its first paint.
  const tier = useCardTier() ?? "medium";
  const density = useListDensity();
  const drawn = useRowsDrawn(tier, limit, density);
  const now = useNowTick();
  return { tier, drawn, density, now };
}
