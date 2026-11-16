/**
 * The groups a breakdown draws at each tier.
 *
 * The chart's cut, made after the chart orders its groups (ties by label), never the read's: a
 * cut where the answer is read breaks ties by stored value instead, so a group the chart's own
 * order keeps could be gone before the chart sees it. So a card's answer carries every group, and
 * the chart keeps the three, five or eight with the most entries for its tier.
 *
 * @module components/features/widgets/tier-query
 */

import type { SizeTier } from "@nextlyhq/ui/format";

/** The groups a breakdown draws at each tier: the three, five or eight with the most entries. */
export const GROUPS_DRAWN: Readonly<Record<SizeTier, number>> = Object.freeze({
  small: 3,
  medium: 5,
  large: 8,
});
