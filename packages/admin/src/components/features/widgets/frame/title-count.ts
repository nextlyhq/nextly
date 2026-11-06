/**
 * A count a card's body shows beside its title: "Needs your attention 2", or a short phrase of
 * progress, "Set up your project 2 of 5 done". Drawn by the frame's header, muted, and read with
 * the title as "Needs your attention, 2 items" or "Set up your project, 2 of 5 done"; reported by
 * the body, which is the one that knows what it counts. A count that is a floor reads "2+", heard
 * as "2 or more items", as the dashboard header words a floor.
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

/** A count that is a floor: there are at least `count`, drawn "N+". */
export interface TitleCountFloor {
  readonly count: number;
  readonly atLeast: true;
}

/** A title count: a number of items, a short phrase said as it is written, or a floor. */
export type TitleCount = number | string | TitleCountFloor;

/** What a card's body reports its title count with: a count, or none. */
type ReportTitleCount = (count: TitleCount | undefined) => void;

/** Where a card's body reports its title count; absent outside a frame. */
export const CardTitleCountContext: Context<ReportTitleCount | undefined> =
  createContext<ReportTitleCount | undefined>(undefined);

/**
 * Shows `count` beside the card's title while this body is drawn: a number, or a short phrase;
 * a number as a floor ("2+") when `atLeast` says the body counted only so far.
 *
 * Taken as plain values and made into a floor inside the effect, so a body re-rendering with the
 * same count reports nothing new: a floor object built by the caller would be a new value on every
 * render, and each report re-renders the frame that renders the body.
 */
export function useCardTitleCount(
  count: number | string | undefined,
  atLeast = false
): void {
  const report = useContext(CardTitleCountContext);
  useLayoutEffect(() => {
    report?.(
      atLeast && typeof count === "number" ? { count, atLeast: true } : count
    );
  }, [report, count, atLeast]);
  useLayoutEffect(() => () => report?.(undefined), [report]);
}

/** A title count as drawn: a floor reads "N+"; a number or a phrase as it is. */
export function titleCountText(count: TitleCount): string {
  return typeof count === "object" ? `${count.count}+` : String(count);
}

/** What a count beside a title says to assistive technology, after the title. */
export function titleCountSpoken(count: TitleCount): string {
  if (typeof count === "string") return `, ${count}`;
  if (typeof count === "object") return `, ${count.count} or more items`;
  return `, ${count} ${count === 1 ? "item" : "items"}`;
}
