/**
 * What the Releases Board says, as plain functions: its columns and the line
 * each release's tile reads.
 *
 * The board is the list's four tabs side by side, so every column is a tab
 * and every rule about where a release belongs is the server's, read through
 * the same tab query the list pages through. Nothing here decides a column.
 *
 * @module components/features/releases/release-board
 */
import type { Release, ReleaseListTab } from "@admin/types/releases";

import {
  releaseRowStatus,
  releaseWhenInstant,
  type ReleaseRowStatus,
} from "./release-list";
import { releaseTimeText, type ReleaseTimeContext } from "./release-time";

/** How many releases a column shows before it leads to the rest in the list. */
export const RELEASE_BOARD_LIMIT = 8;

/**
 * The columns, in the order a release moves through them, each named for the
 * state its releases are in: a column holds releases, where a tab is a place
 * the list can be turned to.
 */
export const RELEASE_BOARD_COLUMNS: readonly {
  tab: ReleaseListTab;
  label: string;
}[] = [
  { tab: "drafts", label: "Draft" },
  { tab: "upcoming", label: "Scheduled" },
  { tab: "attention", label: "Needs attention" },
  { tab: "done", label: "Done" },
];

/** What a tile says before its time, by where the release stands. */
const WHEN_LEAD: Record<ReleaseRowStatus, string> = {
  scheduled: "Goes live",
  overdue: "Was due",
  stopped: "Was due",
  draft: "Created",
  published: "Went live",
  cancelled: "Cancelled",
};

/**
 * A tile's time line: what happens or happened, and when, in the reader's
 * time ("Goes live 28 Nov 2026, 09:00"). The instant is the list's own for the
 * tab, so the board and the list never name a different moment.
 */
export function releaseBoardWhen(
  release: Pick<
    Release,
    "state" | "scheduledAt" | "publishedAt" | "createdAt" | "updatedAt"
  >,
  tab: ReleaseListTab,
  context: ReleaseTimeContext
): string {
  const status = releaseRowStatus(release, tab);
  const text = releaseTimeText(releaseWhenInstant(release, tab), context);
  return text ? `${WHEN_LEAD[status]} ${text.local}` : "Not scheduled";
}

/** How many of a column's releases the board does not show. */
export function releaseBoardMore(total: number, shown: number): number {
  return Math.max(0, total - shown);
}
