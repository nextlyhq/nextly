/**
 * Which cards that hide while empty this dashboard is drawn without: the
 * layout read's verdict (`hiddenWhileEmpty`), taken from the first answer the
 * dashboard is drawn from and held until it is left.
 *
 * A card that hides while empty and decided so from its own answer was drawn,
 * then taken out, moving every card after it; one that waited for its answer
 * moved them the other way when it had something. The server answers these
 * cards before the layout is handed over, so the first paint is final, and the
 * verdict is held for the visit: an item that arrives or clears while the
 * reader is looking changes the card's own content, never the page around it.
 * The next visit reads the verdict anew. One thing moves a hidden card back
 * onto the page during the visit: an answer that finds it with something, a
 * later layout read's or the card's own batch answer, judged by the rule the
 * layout read hid it by (`cardAnswerIsEmpty`). New work is worth the one move.
 * And one thing ends the verdict itself: the dashboard resized to a width that
 * draws its cards at other tiers than the width it was judged at, where what
 * was judged of them no longer holds, so the cards it hid are shown.
 *
 * A widget the layout read cannot answer (one whose data a query asks rather
 * than a `load`) is named in its `hiddenWhenAnswerEmpty`
 * instead: its card leaves the dashboard while its own answer is empty, as it
 * is drawn (`useHidesWhenAnswerEmpty`).
 *
 * Whichever rule takes a card off, the card decides it and reports it to its
 * cell (`useReportCardHidden`), and the grid counts the cards on show from
 * those reports alone.
 *
 * @module components/features/widgets/hidden-while-empty
 */

import { cardAnswerIsEmpty, type WidgetSlot } from "nextly/widget-result";
import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type Context,
} from "react";

import type { DashboardLayoutRead } from "../../../types/dashboard/widgets";

import { tierBandAt } from "./frame/tier";

const NONE: ReadonlySet<string> = new Set();

/**
 * The cards a dashboard is drawn without while empty (`hidden`), and those it was drawn without
 * and has since shown because a later answer found them with something waiting (`revealed`); and the widgets whose cards leave by their own answer instead
 * (`hiddenWhenAnswerEmpty`), from the latest layout answer.
 */
export interface HeldVerdict {
  hidden: ReadonlySet<string>;
  revealed: ReadonlySet<string>;
  hiddenWhenAnswerEmpty: ReadonlySet<string>;
}

const NOTHING_HELD: HeldVerdict = {
  hidden: NONE,
  revealed: NONE,
  hiddenWhenAnswerEmpty: NONE,
};

/** The verdict this dashboard holds; nothing outside a dashboard. */
export const HiddenWhileEmptyContext = createContext<HeldVerdict>(NOTHING_HELD);

/** Whether the card at `placementId` is taken off this dashboard while empty. */
export function useHiddenWhileEmpty(placementId: string | undefined): boolean {
  const { hidden } = useContext(HiddenWhileEmptyContext);
  return placementId !== undefined && hidden.has(placementId);
}

/**
 * Whether a card of the widget `widgetId` leaves the dashboard while its own answer is empty:
 * the widget hides while empty and the layout read named it as one it cannot answer ahead.
 */
export function useHidesWhenAnswerEmpty(widgetId: string): boolean {
  return useContext(HiddenWhileEmptyContext).hiddenWhenAnswerEmpty.has(
    widgetId
  );
}

/**
 * Whether the card at `placementId` joined the dashboard while the reader was on it: drawn
 * without at first, then found with something waiting. Such a card says so, since a reader who
 * is not looking at that part of the page would otherwise not know it arrived.
 */
export function useRevealedWhileViewed(
  placementId: string | undefined
): boolean {
  const { revealed } = useContext(HiddenWhileEmptyContext);
  return placementId !== undefined && revealed.has(placementId);
}

/**
 * Where a card tells the cell holding it whether it is off the dashboard, bound to that cell's
 * placement by the cell; absent outside a grid. The grid counts the cards on show from these
 * reports (`ArrangedGrid`), so the card's own decision, its body's reported state included, is
 * the only one.
 */
export const CardHiddenReportContext: Context<
  ((hidden: boolean) => void) | undefined
> = createContext<((hidden: boolean) => void) | undefined>(undefined);

/**
 * Reports `hidden`, whether this card is off the dashboard as it decides it (`WidgetCard`), to
 * the cell holding it: before paint, so the grid's count is right from the first frame, again
 * whenever it changes, and withdrawn when the card unmounts.
 */
export function useReportCardHidden(hidden: boolean): void {
  const report = useContext(CardHiddenReportContext);
  useLayoutEffect(() => {
    report?.(hidden);
    return () => report?.(false);
  }, [report, hidden]);
}

/**
 * The cards held hidden and those revealed since, once the dashboard has a width to judge at, and
 * `judgedAt`, the dashboard width the held verdict was judged at (the `askedAtWidth` of the answer
 * it was taken from); `undefined` when no verdict was taken, so nothing is held hidden.
 */
type Held = Pick<HeldVerdict, "hidden" | "revealed"> & {
  judgedAt: number | undefined;
};

/** An answer's verdict at this width: the cards it found empty, and the width it judged them at. */
interface Verdict {
  hidden: ReadonlySet<string>;
  judgedAt: number;
}

/**
 * The verdict of the layout answer the dashboard is first drawn from, held for as long as it is
 * mounted: asked where the grid mounts, which waits for that answer. A cached answer on a return
 * visit is that answer, so a return is drawn as it was left and nothing on it moves.
 *
 * Taken once the dashboard has a width (`dashboardWidth`), which it has before its first paint,
 * and only from an answer judged at a width that draws every card at the tier this one does
 * (`tierBandAt` of its `askedAtWidth`). A cached answer read at another width, a narrower window
 * or another device, judged each card at a tier it is not drawn at here, so it is no verdict.
 *
 * Each later answer (the refetch a return visit makes, a save, a focus) may only show a card,
 * never take one away. A card hidden at first that a later read finds with something waiting
 * is shown: new work for the reader is worth the one move of the cards after it. So is one
 * whose own batch answer (`answers`) holds something, once that card is not being asked any
 * more: its load found work the layout read had not, and a refetch of the batch is the reader's
 * one way to learn of it while on the page. An answer still being asked is not judged, since it
 * may be the previous load's, carried while the new one runs. A card shown
 * at first that a later read finds empty stays, saying nothing is waiting, until the next visit,
 * so what the reader is looking at never jumps up. A dashboard resized, after the verdict was
 * taken, to a width that draws its cards at other tiers than the one judged at (`tierBandAt`
 * differs; opening the sidebar, turning a tablet) shows every card held hidden: the verdict says
 * nothing about a card at a tier it was not judged at, so each is drawn and shows its own empty
 * state. Not marked revealed, since nothing new arrived, and never hidden again in the visit,
 * which keeps every later move a showing one. A dashboard drawn without any answer (the
 * layout could not be read) hides nothing, and so does one drawn from an answer that judged no
 * card (no `hiddenWhileEmpty`: it was asked before the dashboard had a width, or at a width of
 * another tier); such an answer is no verdict, so arriving later it shows nothing it hid either.
 */
export function useHiddenWhileEmptyAtFirstPaint(
  layout: DashboardLayoutRead | undefined,
  dashboardWidth: number | undefined,
  answers: CardAnswers = NO_ANSWERS
): HeldVerdict {
  const fresh = verdictAt(layout, dashboardWidth);
  const [held, setHeld] = useState<Held | undefined>(() =>
    firstHeld(fresh, dashboardWidth)
  );
  const ownAnswer = useMemo(
    () => new Set(layout?.hiddenWhenAnswerEmpty ?? []),
    [layout?.hiddenWhenAnswerEmpty]
  );
  // Set during render, React's way to keep what an earlier render saw: it renders again before
  // anything is painted, so no frame draws the card hidden after its answer showed it.
  const kept = nextHeld(held, fresh, dashboardWidth, answers);
  if (kept !== held) setHeld(kept);
  // Read from the held state: a render that changed it above is discarded and rendered again
  // with it before anything is painted.
  return useMemo(
    () => ({
      hidden: held?.hidden ?? NONE,
      revealed: held?.revealed ?? NONE,
      hiddenWhenAnswerEmpty: ownAnswer,
    }),
    [held, ownAnswer]
  );
}

/**
 * The batch's answers the dashboard's cards are drawn from: each card's slot by its placement,
 * and the placements still being asked.
 */
export interface CardAnswers {
  slots: Readonly<Record<string, WidgetSlot>>;
  fetching: ReadonlySet<string>;
}

const NO_ANSWERS: CardAnswers = { slots: {}, fetching: NONE };

/**
 * Whether the card at `placementId` has its own answer and it holds something, by the rule the
 * layout read judged it by. A card still being asked is not judged: its slot may be the answer
 * the previous load left, carried while this one's request runs.
 */
function answeredSomething(answers: CardAnswers, placementId: string): boolean {
  if (answers.fetching.has(placementId)) return false;
  const slot = answers.slots[placementId];
  return slot?.ok === true && !cardAnswerIsEmpty(slot);
}

/**
 * The verdict taken where the dashboard first has a width, with the width it was judged at;
 * nothing before it has one.
 */
function firstHeld(
  fresh: Verdict | undefined,
  dashboardWidth: number | undefined
): Held | undefined {
  return dashboardWidth === undefined
    ? undefined
    : {
        hidden: fresh?.hidden ?? NONE,
        revealed: NONE,
        judgedAt: fresh?.judgedAt,
      };
}

/**
 * Whether the dashboard, now `dashboardWidth` wide, draws its cards at other tiers than the width
 * `held` was judged at, while it still holds a card hidden. All spans are compared at once
 * (`tierBandAt`), so every card held hidden is released together, not only those whose own tier
 * moved. Guarded by the hidden cards so that, once released, it answers no and nothing changes.
 */
function crossedTierBand(
  held: Held,
  dashboardWidth: number | undefined
): boolean {
  return (
    held.hidden.size > 0 &&
    held.judgedAt !== undefined &&
    dashboardWidth !== undefined &&
    tierBandAt(held.judgedAt) !== tierBandAt(dashboardWidth)
  );
}

/**
 * What the dashboard holds after `fresh`, the latest answer's verdict at this width: the first
 * verdict once there is a width; then, on a resize to another tier band than the verdict was
 * judged at (`crossedTierBand`), no card hidden and none newly revealed; and otherwise each card
 * a later verdict finds with something waiting, or whose own batch answer holds something
 * (`answeredSomething`), moved from hidden to revealed. `held` itself when nothing changes.
 */
function nextHeld(
  held: Held | undefined,
  fresh: Verdict | undefined,
  dashboardWidth: number | undefined,
  answers: CardAnswers
): Held | undefined {
  if (held === undefined) return firstHeld(fresh, dashboardWidth);
  if (crossedTierBand(held, dashboardWidth)) return { ...held, hidden: NONE };
  const appearing = new Set(
    [...held.hidden].filter(
      id =>
        (fresh !== undefined && !fresh.hidden.has(id)) ||
        answeredSomething(answers, id)
    )
  );
  if (appearing.size === 0) return held;
  return {
    ...held,
    hidden: new Set([...held.hidden].filter(id => !appearing.has(id))),
    revealed: new Set([...held.revealed, ...appearing]),
  };
}

/**
 * The cards an answer found empty, judged at the tier each is drawn at on a dashboard
 * `dashboardWidth` wide, with the width they were judged at; `undefined` for an answer that
 * judged none, or one judged at a width that draws some card at another tier, and before the
 * dashboard has a width.
 */
function verdictAt(
  layout: DashboardLayoutRead | undefined,
  dashboardWidth: number | undefined
): Verdict | undefined {
  const judgedAt = layout?.askedAtWidth;
  if (
    layout?.hiddenWhileEmpty === undefined ||
    judgedAt === undefined ||
    dashboardWidth === undefined ||
    tierBandAt(judgedAt) !== tierBandAt(dashboardWidth)
  ) {
    return undefined;
  }
  return { hidden: new Set(layout.hiddenWhileEmpty), judgedAt };
}
