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
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";

import type { ReleaseDecisions } from "../domains/releases/release-scope";

import {
  DEFAULT_WORKFLOW,
  isPublicState,
  type ContentWorkflow,
} from "./content-states";
import type { StatusFilterValue } from "./status-filter";

export interface StatusConditionInput {
  /** The resolved filter, or `null` when the read is not lifecycle-bounded. */
  filter: { value: StatusFilterValue } | null;
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
  /**
   * The workflow whose flags decide whether {@link StatusConditionInput.filter}
   * names a public state.
   *
   * Defaults to the only workflow that exists today. It is an input rather than
   * a lookup because the alternative is this module deciding for itself what a
   * state means, which is the comparison it was written to remove.
   */
  workflow?: ContentWorkflow;
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
  const workflow = input.workflow ?? DEFAULT_WORKFLOW;
  if (filter === null || statusColumn === undefined) return undefined;

  const base = eq(statusColumn, filter.value);

  // Only a PUBLIC read is adjusted. A read bounded to a non-public state is
  // asking for pending work: a document a release is about to publish is not
  // that, and one it is about to withdraw is not pending work either. An
  // unbounded read never reaches here.
  //
  // Asked of the workflow rather than compared against the word `published`.
  // A release publishes into whatever state the workflow calls public, so a
  // literal here would stop widening the read the moment a team renamed it —
  // and the failure is invisible: the scheduled publication simply never
  // appears, on a query that returns rows and looks like it worked.
  if (!isPublicState(filter.value, workflow)) return base;
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
