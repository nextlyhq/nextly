/**
 * The SQL condition a resolved status filter becomes — including what a due
 * release makes visible.
 *
 * `./status-filter` decides WHICH lifecycle a read should see and is
 * deliberately pure, with no database coupling. This is the other half: turning
 * that decision into a condition, in ONE place, because a release makes it more
 * than a column comparison.
 *
 * ## Why a release changes the condition rather than the result
 *
 * A release member says publish-or-unpublish at a time. Suppressing a document
 * afterwards is easy — the row was fetched, and a decision can drop it. Showing
 * one is not: a published-only read filters `status` in SQL, so a document
 * stored as a draft is excluded by the DATABASE, and no amount of post-filtering
 * adds back a row the query never returned.
 *
 * So the reveal has to happen here, where the condition is built. The
 * suppression is applied here too — not because it has to be, but because a
 * filter and a post-filter that each know half the decision disagree the moment
 * one of them is changed alone, and the disagreement surfaces as a listing
 * whose count does not match its own contents.
 *
 * ## Why this is one function and not six
 *
 * `resolveStatusFilter` has six call sites — three collection read paths, two
 * expansion paths and Singles. If each widened itself, "is this published,
 * given releases" would have six implementations that must agree forever, and
 * the ones that drifted would disagree in the least visible way available: a
 * count that does not match its own listing.
 *
 * @module lib/status-condition
 */

import {
  and,
  eq,
  inArray,
  notInArray,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";

import type { ReleaseDecisions } from "../domains/releases/release-scope";

import type { StatusFilter } from "./status-filter";

export interface StatusConditionInput {
  /** The resolved filter, or `null` when the read is not lifecycle-bounded. */
  filter: StatusFilter | null;
  /** The lifecycle column on the table being read. */
  statusColumn: SQLWrapper | undefined;
  /** The identity column, for the reveal and hide sets. */
  idColumn: SQLWrapper | undefined;
  /**
   * What a due release does to this scope, in both directions.
   *
   * Two empty sets in the overwhelmingly common case — nothing scheduled, or
   * nothing due — and the caller is expected to have skipped the lookup
   * entirely rather than paying for a query that returns them.
   */
  decisions: ReleaseDecisions;
}

/**
 * The condition to apply, or `null` when the read is not lifecycle-bounded.
 *
 * Returns `null` for an unbounded read (`status: "all"`, or a trusted caller
 * that said nothing) exactly as before: such a read already sees every row, so
 * there is nothing for a release to reveal.
 */
export function statusCondition(input: StatusConditionInput): SQL | undefined {
  const { filter, statusColumn, idColumn, decisions } = input;
  if (filter === null || statusColumn === undefined) return undefined;

  /*
   * One state is an equality and several are a set membership.
   *
   * Kept as two forms rather than always emitting `IN`, because a single-value
   * `IN` is the shape every existing query planner and every existing test sees
   * today — and this widening should be invisible to a workflow that declares
   * one public state, which is every workflow that exists before a team writes
   * its own.
   */
  /*
   * An EMPTY set is a read bounded to nothing — reachable when a workflow calls
   * every state public and a caller asks explicitly for drafts. It must select
   * no rows rather than select every row, and it must not reach the driver as
   * `IN ()`, which two dialects reject outright.
   */
  const base =
    filter.values.length === 0
      ? sql`1 = 0`
      : filter.values.length === 1
        ? eq(statusColumn, filter.values[0])
        : inArray(statusColumn, [...filter.values]);

  // Only a PUBLIC read is adjusted. A read bounded to the non-public states is
  // asking for pending work: a document a release is about to publish is not
  // that, and one it is about to withdraw is not pending work either. An
  // unbounded read never reaches here.
  //
  // Read off the filter rather than re-derived from its values. The resolver is
  // the only place that knows why a set was chosen, and asking the values again
  // here would be a second answer to that question — one that disagrees the
  // moment a workflow's public and non-public sets are not complementary.
  if (!filter.isPublicRead) return base;
  if (idColumn === undefined) return base;

  const { reveal, hide } = decisions;
  if (reveal.length === 0 && hide.length === 0) return base;

  // Withdraw first, then admit. The two sets are disjoint — one winning member
  // decides each document — so the order cannot change the answer; it is fixed
  // only so the generated SQL is stable to read.
  const published =
    hide.length === 0 ? base : and(base, notInArray(idColumn, [...hide]));

  return reveal.length === 0
    ? published
    : or(published, inArray(idColumn, [...reveal]));
}
