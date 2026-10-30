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
 * The next visit reads the verdict anew.
 *
 * @module components/features/widgets/hidden-while-empty
 */

import { createContext, useContext, useState } from "react";

import type { DashboardLayoutResponse } from "../../../types/dashboard/widgets";

const NONE: ReadonlySet<string> = new Set();

/**
 * The cards a dashboard is drawn without while empty (`hidden`), and those it was drawn without
 * and has since shown because a later layout read found them with something waiting
 * (`revealed`).
 */
export interface HeldVerdict {
  hidden: ReadonlySet<string>;
  revealed: ReadonlySet<string>;
}

const NOTHING_HELD: HeldVerdict = { hidden: NONE, revealed: NONE };

/** The verdict this dashboard holds; nothing outside a dashboard. */
export const HiddenWhileEmptyContext = createContext<HeldVerdict>(NOTHING_HELD);

/** Whether the card at `placementId` is taken off this dashboard while empty. */
export function useHiddenWhileEmpty(placementId: string | undefined): boolean {
  const { hidden } = useContext(HiddenWhileEmptyContext);
  return placementId !== undefined && hidden.has(placementId);
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
 * is shown: new work for the reader is worth the one move of the cards after it. A card shown
 * at first that a later read finds empty stays, saying nothing is waiting, until the next visit,
 * so what the reader is looking at never jumps up. A dashboard drawn without any answer (the
 * layout could not be read) hides nothing.
 */
export function useHiddenWhileEmptyAtFirstPaint(
  layout: DashboardLayoutResponse | undefined
): HeldVerdict {
  const [held, setHeld] = useState<HeldVerdict>(() => ({
    hidden: layout === undefined ? NONE : verdictOf(layout),
    revealed: NONE,
  }));
  const fresh = layout === undefined ? undefined : verdictOf(layout);
  const appearing =
    fresh === undefined ? [] : [...held.hidden].filter(id => !fresh.has(id));
  // Set during render, React's way to keep what an earlier render saw: it renders again before
  // anything is painted, so no frame draws the card hidden after its answer showed it.
  if (appearing.length > 0) {
    const next: HeldVerdict = {
      hidden: new Set([...held.hidden].filter(id => fresh?.has(id))),
      revealed: new Set([...held.revealed, ...appearing]),
    };
    setHeld(next);
    return next;
  }
  return held;
}

function verdictOf(layout: DashboardLayoutResponse): ReadonlySet<string> {
  return new Set(layout.hiddenWhileEmpty ?? []);
}
