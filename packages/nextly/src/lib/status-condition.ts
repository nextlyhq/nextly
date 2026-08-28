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
 * So the reveal has to happen here, where the condition is built.
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

import { eq, inArray, or, type SQL, type SQLWrapper } from "drizzle-orm";

import type { StatusFilterValue } from "./status-filter";

export interface StatusConditionInput {
  /** The resolved filter, or `null` when the read is not lifecycle-bounded. */
  filter: { value: StatusFilterValue } | null;
  /** The lifecycle column on the table being read. */
  statusColumn: SQLWrapper | undefined;
  /** The identity column, for the reveal set. */
  idColumn: SQLWrapper | undefined;
  /**
   * Documents a due release would PUBLISH.
   *
   * Empty in the overwhelmingly common case — nothing scheduled, or nothing due
   * — and the caller is expected to have skipped the lookup entirely rather
   * than passing an empty array it paid for.
   */
  revealIds: readonly string[];
}

/**
 * The condition to apply, or `null` when the read is not lifecycle-bounded.
 *
 * Returns `null` for an unbounded read (`status: "all"`, or a trusted caller
 * that said nothing) exactly as before: such a read already sees every row, so
 * there is nothing for a release to reveal.
 */
export function statusCondition(input: StatusConditionInput): SQL | undefined {
  const { filter, statusColumn, idColumn, revealIds } = input;
  if (filter === null || statusColumn === undefined) return undefined;

  const base = eq(statusColumn, filter.value);

  // Only a PUBLISHED read is widened. A draft-only read is asking for pending
  // work, and a document a release is about to publish is not that; adding it
  // would answer a question nobody asked. An unbounded read never reaches here.
  if (filter.value !== "published") return base;
  if (revealIds.length === 0 || idColumn === undefined) return base;

  return or(base, inArray(idColumn, [...revealIds]));
}
