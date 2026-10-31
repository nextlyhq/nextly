/**
 * A count a card's body shows beside its title: "Needs your attention 2". Drawn by the frame's
 * header, muted, and read with the title as "Needs your attention, 2 items"; reported by the body,
 * which is the one that knows what it counts. A count that is a floor reads "2+", heard as "2 or
 * more items", as the dashboard header words a floor.
 *
 * Reported before the paint (a layout effect), so the title is drawn with its count from the first
 * frame its body is drawn in; withdrawn when the body unmounts.
 *
 * @module components/features/widgets/frame/title-count
 */

import {
  createContext,
  useContext,
  useLayoutEffect,
  type Context,
} from "react";

/** A count beside a card's title: how many, and whether that is a floor (there are at least that many). */
export interface CardTitleCount {
  count: number;
  atLeast: boolean;
}

/** What a card's body reports its title count with: a count, or none. */
type ReportTitleCount = (count: CardTitleCount | undefined) => void;

/** Where a card's body reports its title count; absent outside a frame. */
export const CardTitleCountContext: Context<ReportTitleCount | undefined> =
  createContext<ReportTitleCount | undefined>(undefined);

/**
 * Shows `count` beside the card's title while this body is drawn, as a floor ("2+") when
 * `atLeast` says the body counted only so far.
 */
export function useCardTitleCount(
  count: number | undefined,
  atLeast = false
): void {
  const report = useContext(CardTitleCountContext);
  useLayoutEffect(() => {
    report?.(count === undefined ? undefined : { count, atLeast });
  }, [report, count, atLeast]);
  useLayoutEffect(() => () => report?.(undefined), [report]);
}

/** A count beside a title as drawn: a floor reads "N+". */
export function titleCountText({ count, atLeast }: CardTitleCount): string {
  return atLeast ? `${count}+` : String(count);
}

/** What a count beside a title says to assistive technology, after the title. */
export function titleCountSpoken({ count, atLeast }: CardTitleCount): string {
  if (atLeast) return `, ${count} or more items`;
  return `, ${count} ${count === 1 ? "item" : "items"}`;
}
