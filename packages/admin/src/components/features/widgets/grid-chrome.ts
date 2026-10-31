/**
 * The grid's part of the page header: what it publishes for the header to draw
 * (Customize, the freshness line, the cards the summary links to) and the
 * refresh that asks the summary again with the cards.
 *
 * @module components/features/widgets/grid-chrome
 */
import { useQueryClient } from "@tanstack/react-query";

import {
  usePublishDashboardChrome,
  type DashboardChromeActions,
} from "@admin/components/features/dashboard/header/dashboard-chrome";
import { DASHBOARD_SUMMARY_KEY } from "@admin/hooks/queries/useDashboardSummary";

import type {
  ArrangedWidget,
  useDashboardArrangement,
} from "./edit/useDashboardArrangement";

/** When the oldest answer a drawn card shows arrived, or none while no card has one. */
function oldestAnswerAt(
  visible: readonly ArrangedWidget[],
  requested: ReadonlySet<string>,
  updatedAtFor: (placementId: string) => Date | null
): number | null {
  let oldest: number | null = null;
  for (const row of visible) {
    if (!requested.has(row.placementId)) continue;
    const at = updatedAtFor(row.placementId)?.getTime();
    if (at !== undefined && (oldest === null || at < oldest)) oldest = at;
  }
  return oldest;
}

/** Each widget's cards on the dashboard, their placement ids in its order, by widget id. */
function cardsByWidget(
  visible: readonly ArrangedWidget[]
): Record<string, string[]> {
  const cards: Record<string, string[]> = {};
  for (const row of visible) {
    (cards[row.widget.id] ??= []).push(row.placementId);
  }
  return cards;
}

/** What the grid hands the page header: its arrangement and its cards' answers. */
export interface GridChromeSource {
  arrangement: ReturnType<typeof useDashboardArrangement>;
  requested: ReadonlySet<string>;
  updatedAtFor: (placementId: string) => Date | null;
  refresh: () => void;
  customizeRef: DashboardChromeActions["customizeRef"];
}

/**
 * Publishes the grid's part of the page header: Customize, the freshness line
 * and the cards its summary links to. Refreshing from the header asks the
 * summary again with the cards, since it repeats their counts.
 */
export function usePublishGridChrome(source: GridChromeSource): void {
  const { arrangement, requested, updatedAtFor, refresh } = source;
  const { visible, editor, hasArrangement } = arrangement;
  const queryClient = useQueryClient();
  usePublishDashboardChrome(
    {
      customizable: hasArrangement,
      editing: editor.isEditing,
      writing: editor.isWriting,
      oldestAnswerAt: oldestAnswerAt(visible, requested, updatedAtFor),
      cards: cardsByWidget(visible),
    },
    {
      begin: arrangement.begin,
      customizeRef: source.customizeRef,
      refresh: () => {
        refresh();
        void queryClient.invalidateQueries({ queryKey: DASHBOARD_SUMMARY_KEY });
      },
    }
  );
}
