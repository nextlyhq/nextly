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

/** The placements this dashboard is drawn without; none outside a dashboard. */
export const HiddenWhileEmptyContext = createContext<ReadonlySet<string>>(NONE);

/** Whether the card at `placementId` is taken off this dashboard while empty. */
export function useHiddenWhileEmpty(placementId: string | undefined): boolean {
  const hidden = useContext(HiddenWhileEmptyContext);
  return placementId !== undefined && hidden.has(placementId);
}

/**
 * The verdict of the layout answer the dashboard is first drawn from, held for as long as it is
 * mounted: asked where the grid mounts, which waits for that answer. A cached answer on a return
 * visit is that answer, so the return is drawn as it will stay; a refetch after a save, a focus
 * or a reset does not move a card in or out. A dashboard drawn without any answer (the layout
 * could not be read) hides nothing, and nothing joins or leaves it if one arrives later.
 */
export function useHiddenWhileEmptyAtFirstPaint(
  layout: DashboardLayoutResponse | undefined
): ReadonlySet<string> {
  const [held] = useState(() =>
    layout === undefined ? NONE : verdictOf(layout)
  );
  return held;
}

function verdictOf(layout: DashboardLayoutResponse): ReadonlySet<string> {
  return new Set(layout.hiddenWhileEmpty ?? []);
}
