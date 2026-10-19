/**
 * How a count is written when it may be a FLOOR rather than a total.
 *
 * 🔴 One implementation, used by every archetype that draws a count. `metric`
 * and `stats` each formatted their own, and when `WidgetResult` gained
 * `atLeast` only one of them was taught about it — so the same query rendered
 * `2,000+` on a metric card and `2,000` on a stats cell, the second stating as
 * exact a number its own source had declined to vouch for. Two renderers of one
 * value agree on the day they are written; the drift is silent because each
 * reads correctly on its own.
 *
 * @module components/features/widgets/archetypes/count-value
 */

import type { SizeTier } from "@nextlyhq/ui/format";
import type { JSX } from "react";

import { CardFigure } from "../frame/figure";
import { cardNumber } from "../frame/format";

/**
 * What assistive technology should HEAR for a count.
 *
 * 🔴 Exported because a rendered node is not always what gets announced. A
 * stats cell that links wraps its number in an `aria-label`, and an
 * `aria-label` REPLACES the element's descendants as its accessible name — so
 * everything {@link CountValue} renders, the number included, was dropped from
 * what a screen reader read out. Composing that name from this keeps one
 * spoken form wherever a count is announced.
 */
export function countLabel(total: number, atLeast?: boolean): string {
  // The card formatter's spoken form: the full grouped value, "N or more" for a floor.
  return cardNumber(total, { floor: atLeast === true }).label;
}

/**
 * `total`, with a trailing `+` when the source could only establish a floor.
 *
 * The marker is punctuation a screen reader may not voice, so the words are
 * given separately rather than relying on it: `aria-hidden` on the glyph and an
 * `sr-only` phrase beside it means both readings carry the same claim, and a
 * reader using assistive technology is not told a bounded number is a whole one.
 */
export function CountValue({
  total,
  atLeast,
  tier,
}: {
  total: number;
  atLeast?: boolean;
  /** The card's size tier: only `small` compacts ("1.2k"). */
  tier?: SizeTier;
}): JSX.Element {
  // The frame's one figure, so a count is written for the card's measured tier like every
  // other number on it: a compact "1.2k" is still heard as "1,248", and a floor's "+" as "or
  // more".
  return <CardFigure value={total} floor={atLeast === true} tier={tier} />;
}
