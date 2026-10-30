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
 *
 * A widget the layout read cannot answer (one of the `registerWidget` or
 * `contributes.admin.widgets` channel) is named in its `hiddenWhenAnswerEmpty`
 * instead: its card leaves the dashboard while its own answer is empty, as it
 * is drawn (`useHidesWhenAnswerEmpty`).
 *
 * @module components/features/widgets/hidden-while-empty
 */

import { cardAnswerIsEmpty, type WidgetSlot } from "nextly/widget-result";
import { createContext, useContext, useMemo, useState } from "react";

import type { DashboardLayoutResponse } from "../../../types/dashboard/widgets";

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
 * The verdict of the layout answer the dashboard is first drawn from, held for as long as it is
 * mounted: asked where the grid mounts, which waits for that answer. A cached answer on a return
 * visit is that answer, so a return is drawn as it was left and nothing on it moves.
 *
 * Each later answer (the refetch a return visit makes, a save, a focus) may only show a card,
 * never take one away. A card hidden at first that a later read finds with something waiting
 * is shown: new work for the reader is worth the one move of the cards after it. So is one
 * whose own batch answer (`answers`) holds something, once that card is not being asked any
 * more: its load found work the layout read had not, and a refetch of the batch is the reader's
 * one way to learn of it while on the page. An answer still being asked is not judged, since it
 * may be the previous load's, carried while the new one runs. A card shown
 * at first that a later read finds empty stays, saying nothing is waiting, until the next visit,
 * so what the reader is looking at never jumps up. A dashboard drawn without any answer (the
 * layout could not be read) hides nothing, and so does one drawn from an answer that judged no
 * card (no `hiddenWhileEmpty`: it was asked before the dashboard had a width); such an answer is
 * no verdict, so arriving later it shows nothing it hid either.
 */
export function useHiddenWhileEmptyAtFirstPaint(
  layout: DashboardLayoutResponse | undefined,
  answers: CardAnswers = NO_ANSWERS
): HeldVerdict {
  const [held, setHeld] = useState<Pick<HeldVerdict, "hidden" | "revealed">>(
    () => ({
      hidden: (layout === undefined ? undefined : verdictOf(layout)) ?? NONE,
      revealed: NONE,
    })
  );
  const ownAnswer = useMemo(
    () => new Set(layout?.hiddenWhenAnswerEmpty ?? []),
    [layout?.hiddenWhenAnswerEmpty]
  );
  const fresh = layout === undefined ? undefined : verdictOf(layout);
  const appearing = new Set(
    [...held.hidden].filter(
      id =>
        (fresh !== undefined && !fresh.has(id)) ||
        answeredSomething(answers, id)
    )
  );
  // Set during render, React's way to keep what an earlier render saw: it renders again before
  // anything is painted, so no frame draws the card hidden after its answer showed it.
  const kept =
    appearing.size > 0
      ? {
          hidden: new Set([...held.hidden].filter(id => !appearing.has(id))),
          revealed: new Set([...held.revealed, ...appearing]),
        }
      : held;
  if (kept !== held) setHeld(kept);
  // Read from the held state: a render that changed it above is discarded and rendered again
  // with it before anything is painted.
  return useMemo(
    () => ({ ...held, hiddenWhenAnswerEmpty: ownAnswer }),
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

/** The cards an answer found empty, or `undefined` for an answer that judged none. */
function verdictOf(
  layout: DashboardLayoutResponse
): ReadonlySet<string> | undefined {
  return layout.hiddenWhileEmpty === undefined
    ? undefined
    : new Set(layout.hiddenWhileEmpty);
}
