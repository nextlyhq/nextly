/**
 * The four views of the release list, and the one rule that puts each release
 * in exactly one of them.
 *
 * A tab is DECLARED here as data — the conditions a release must meet and the
 * order its rows come in — and both of its readers derive from that one
 * declaration: the repository hands the conditions to the database, and
 * {@link releaseTabOf} evaluates the same conditions against a row already in
 * hand. Two hand-written versions of "which tab is this release in", one in SQL
 * and one in JavaScript, would agree on the day they were written and drift the
 * first time either changed, and the symptom would be a release counted under
 * one tab and listed under another.
 *
 * Overdue is worked out here, on read, and never stored: a stored flag is a
 * second copy of something the scheduled instant and the clock already say, and
 * it goes stale the moment the release runs.
 *
 * @module domains/releases/release-tabs
 * @experimental The tab vocabulary and its rules may change until the releases
 *   list redesign is complete.
 */
import type { ReleaseState } from "../../schemas/releases/types";
import type { VersionsWhereCondition } from "../versions/db-api";

import { meetsCondition, type ReleaseCondition } from "./release-conditions";
import type { ReleaseListOrder, ReleaseRow } from "./releases-repository";

/**
 * The tabs, in the order the list shows them.
 *
 * A const array with the type derived from it, so a value from a query string
 * can be checked against the runtime form rather than trusted from a type.
 *
 * @experimental
 */
export const RELEASE_TABS = [
  "upcoming",
  "attention",
  "drafts",
  "done",
] as const;

/** @experimental */
export type ReleaseTab = (typeof RELEASE_TABS)[number];

/** Runtime guard: true iff `v` is one of the release tabs. @experimental */
export function isReleaseTab(v: unknown): v is ReleaseTab {
  return (
    typeof v === "string" && (RELEASE_TABS as readonly string[]).includes(v)
  );
}

/**
 * Why a release is in Needs attention: it stopped, or it is overdue.
 *
 * The two parts of that tab, named so a reader that needs only one — a
 * dashboard counting overdue releases, say — narrows the tab rather than
 * writing its own rule beside it.
 *
 * @experimental
 */
export const RELEASE_ATTENTION_REASONS = ["stopped", "overdue"] as const;

/** @experimental */
export type ReleaseAttentionReason = (typeof RELEASE_ATTENTION_REASONS)[number];

/**
 * How long past its instant a scheduled release may still be waiting before it
 * counts as overdue.
 *
 * Not zero, because the job that runs releases passes on an interval: a release
 * due at 09:00 is normally still `scheduled` for a short while after 09:00, and
 * calling that overdue would put every healthy launch in Needs attention for a
 * few seconds. Ten minutes is several passes of that job, so a release still
 * waiting after it is one the runner is genuinely not reaching.
 *
 * Exported so every reader of "overdue" — the list's tabs, the dashboard, a
 * notice — uses this number rather than a copy of it.
 *
 * @experimental
 */
export const RELEASE_OVERDUE_AFTER_MS = 10 * 60 * 1000;

/** The columns a tab's order is made of. */
type ReleaseOrderColumn =
  | "state"
  | "scheduledAt"
  | "createdAt"
  | "updatedAt"
  | "id";

/** One step of a tab's order. */
export interface ReleaseTabOrder {
  column: ReleaseOrderColumn;
  direction: "asc" | "desc";
  nulls?: "first" | "last";
}

/** A condition on a release row, or a nested group of them. */
export type ReleaseTabCondition = ReleaseCondition;

/**
 * A tab as one query: the conditions a release must meet, and the order.
 *
 * One statement per tab, so the page and its rows are read from one view of
 * the table: a release moving between the two parts of Needs attention while
 * the tab is read is seen once, in one place, never twice or not at all.
 */
export interface ReleaseTabQuery {
  /** All of them must hold. */
  where: ReleaseTabCondition[];
  /** Ends in `id`, so the order is total and a page boundary never splits a tie. */
  orderBy: ReleaseTabOrder[];
}

/**
 * The instant before which a still-scheduled release is overdue.
 *
 * Exported for the same reason as the threshold: a caller asking "is this
 * overdue" asks it of this cutoff, not of its own arithmetic.
 *
 * @experimental
 */
export function overdueCutoff(now: Date): Date {
  // Whole seconds, the coarsest precision any dialect stores an instant in
  // (SQLite keeps epoch seconds). A cutoff with a fractional second is
  // truncated by SQLite when it is bound, so the database and the in-memory
  // check below would disagree about a release in that same second; a cutoff
  // that is already whole is read the same by both, on every dialect.
  const cutoff = now.getTime() - RELEASE_OVERDUE_AFTER_MS;
  return new Date(Math.floor(cutoff / 1000) * 1000);
}

const scheduled: VersionsWhereCondition = {
  column: "state",
  op: "=",
  value: "scheduled" satisfies ReleaseState,
};

/** The two parts of Needs attention, each as its own conditions. */
function attentionParts(
  now: Date
): Record<ReleaseAttentionReason, VersionsWhereCondition[]> {
  return {
    stopped: [
      { column: "state", op: "=", value: "blocked" satisfies ReleaseState },
    ],
    overdue: [
      scheduled,
      { column: "scheduledAt", op: "<", value: overdueCutoff(now) },
    ],
  };
}

/**
 * A tab, at this moment, as one query.
 *
 * `order` applies to Upcoming only, the one tab ordered by when releases WILL
 * run, where both ends are real questions ("what ships next", "what is furthest
 * out"). The other tabs have one meaningful order each, so the caller cannot
 * choose one; the service refuses an `order` with them rather than ignore it.
 *
 * `reason` narrows Needs attention to one of its parts, selected from the same
 * definition, so "overdue" is exactly the overdue part of the list.
 *
 * @experimental
 */
export function releaseTabQuery(
  tab: ReleaseTab,
  now: Date,
  order: ReleaseListOrder = "soonest",
  reason?: ReleaseAttentionReason
): ReleaseTabQuery {
  switch (tab) {
    case "upcoming": {
      const direction = order === "soonest" ? "asc" : "desc";
      return {
        // `>=` the cutoff: a release a few minutes past its instant is still
        // Upcoming — the runner reaches it on its next pass — and only one
        // past the cutoff moves to Needs attention. Every scheduled release is
        // therefore in exactly one of the two.
        where: [
          scheduled,
          { column: "scheduledAt", op: ">=", value: overdueCutoff(now) },
        ],
        orderBy: [
          { column: "scheduledAt", direction },
          { column: "id", direction },
        ],
      };
    }
    case "attention": {
      const parts = attentionParts(now);
      return {
        where:
          reason === undefined
            ? [{ or: [{ and: parts.stopped }, { and: parts.overdue }] }]
            : parts[reason],
        orderBy: [
          // Stopped first: a stopped release will not run until somebody
          // acts, while an overdue one may still run on the next pass. The
          // tab holds exactly two states, and "blocked" sorts before
          // "scheduled" on every dialect (plain lowercase ASCII), so ordering
          // by state IS that grouping, in one statement and with no
          // dialect-specific CASE.
          { column: "state", direction: "asc" },
          // Then oldest first, so the release that has waited longest leads.
          // A stopped release keeps the instant it was due at.
          { column: "scheduledAt", direction: "asc", nulls: "last" },
          { column: "id", direction: "asc" },
        ],
      };
    }
    case "drafts":
      return {
        where: [
          { column: "state", op: "=", value: "draft" satisfies ReleaseState },
        ],
        orderBy: [
          { column: "createdAt", direction: "desc" },
          { column: "id", direction: "desc" },
        ],
      };
    case "done":
      return {
        where: [
          {
            column: "state",
            op: "IN",
            value: ["published", "cancelled"] satisfies ReleaseState[],
          },
        ],
        orderBy: [
          // `updatedAt` is the instant a release finished: the move to
          // `published` sets it to the publish instant and the move to
          // `cancelled` to the cancel instant, and a finished release takes no
          // other write that moves it: a rename leaves `updatedAt` alone.
          // Anything that later writes to a finished release must keep that
          // true or move this order to a column of its own.
          //
          // Not served by an index: the release indexes cover `(state,
          // scheduledAt)`, so a Done page sorts the finished releases it
          // matches before taking its page. Releases are few — one per launch
          // — so this is a sort of hundreds of rows, not millions; an index on
          // `(state, updatedAt)` is the remedy if a history ever grows large.
          { column: "updatedAt", direction: "desc" },
          { column: "id", direction: "desc" },
        ],
      };
  }
}

/**
 * The one tab a release is in right now.
 *
 * Evaluates the tabs' own conditions against the row, so it cannot disagree
 * with the list about where a release belongs. `null` is not expected — every
 * state is in some tab — but a state added later without a tab would land
 * there, and answering `null` keeps that visible rather than guessing.
 *
 * @experimental
 */
export function releaseTabOf(row: ReleaseRow, now: Date): ReleaseTab | null {
  for (const tab of RELEASE_TABS) {
    if (releaseTabQuery(tab, now).where.every(c => meetsCondition(row, c)))
      return tab;
  }
  return null;
}

/**
 * Whether a release is overdue: scheduled, and still waiting past the cutoff.
 *
 * Derived from the tab rule rather than written beside it, so "overdue" and
 * "in Needs attention because it is late" are one judgement.
 *
 * @experimental
 */
export function isReleaseOverdue(row: ReleaseRow, now: Date): boolean {
  return row.state === "scheduled" && releaseTabOf(row, now) === "attention";
}
