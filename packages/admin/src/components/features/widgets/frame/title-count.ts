/**
 * A count a card's body shows beside its title: "Needs your attention 2", or a short phrase of
 * progress, "Set up your project 2 of 5 done". Drawn by the frame's header, muted, and read with
 * the title as "Needs your attention, 2 items" or "Set up your project, 2 of 5 done"; reported by
 * the body, which is the one that knows what it counts.
 *
 * Reported before the paint (a layout effect), so the title is drawn with its count from the first
 * frame its body is drawn in; withdrawn when the body unmounts.
 *
 * @module components/features/widgets/frame/title-count
 */

import { createContext, useContext, useLayoutEffect } from "react";

/** A title count: a number of items, or a short phrase said as it is written. */
export type TitleCount = number | string;

/** Where a card's body reports its title count; absent outside a frame. */
export const CardTitleCountContext = createContext<
  ((count: TitleCount | undefined) => void) | undefined
>(undefined);

/** Shows `count` beside the card's title while this body is drawn. */
export function useCardTitleCount(count: TitleCount | undefined): void {
  const report = useContext(CardTitleCountContext);
  useLayoutEffect(() => {
    report?.(count);
  }, [report, count]);
  useLayoutEffect(() => () => report?.(undefined), [report]);
}

/** What a count beside a title says to assistive technology, after the title. */
export function titleCountSpoken(count: TitleCount): string {
  if (typeof count === "string") return `, ${count}`;
  return `, ${count} ${count === 1 ? "item" : "items"}`;
}
