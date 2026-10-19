/**
 * One figure on a card, written for the card's size tier.
 *
 * Every number a card draws goes through this, so the tier reaches all of them: a count, a
 * bar's value, a table cell. In a small card it may read "1.2k"; assistive technology always
 * hears the full value ("1,248"), and a floor's "+" is heard as "or more".
 *
 * @module components/features/widgets/frame/figure
 */

import type { SizeTier } from "@nextlyhq/ui/format";
import type { JSX } from "react";

import { cardNumber } from "./format";
import { useCardTier } from "./tier";

export function CardFigure({
  value,
  floor = false,
  tier,
}: {
  value: number;
  /** The value is a lower bound: drawn "N+", heard "N or more". */
  floor?: boolean;
  /** Overrides the tier of the card this is drawn in. */
  tier?: SizeTier;
}): JSX.Element {
  const measured = useCardTier();
  // One formatter for the drawn form and the heard one, so the two cannot disagree.
  const figure = cardNumber(value, { floor, tier: tier ?? measured });
  if (figure.text === figure.label) return <>{figure.text}</>;
  return (
    <>
      <span aria-hidden="true">{figure.text}</span>
      <span className="sr-only">{figure.label}</span>
    </>
  );
}
