/**
 * The data each of core's declared cards answers, as its admin component is
 * handed it. Not a public API; it may change in any release.
 *
 * One shape for both ends: each core widget's `load` is typed to answer it,
 * and the admin's component for that card is typed to draw it, so the two
 * cannot come to disagree about a field. Types alone, so the admin reaches
 * them through `nextly/core-widget-data` without loading a core widget.
 *
 * Every shape here is what JSON carries as itself (`TransportableFields`):
 * numbers, strings, booleans, `null`, plain objects and lists of them.
 *
 * @internal
 * @module domains/widgets/core-widgets/data
 */

import type { TransportableRow } from "../declaration/transportable";
import type { RangeInterval } from "../query";
import type { WidgetResultField } from "../result";

/**
 * One interval of a count over time: when it starts, and how many it holds.
 *
 * @internal
 */
export interface CoreSeriesPoint {
  /** The interval's first instant, as a UTC ISO string. */
  start: string;
  count: number;
}

/**
 * What a Count card draws.
 *
 * @internal
 */
export interface CountWidgetData {
  /** How many entries the collection holds under the card's Filter, drafts included. */
  total: number;
  /**
   * The published and draft entries, for a collection with a draft and
   * published lifecycle, from the read that gives the number; absent for a
   * collection without one. A small card draws the number alone.
   */
  split?: { published: number; draft: number };
  /**
   * The entries a scheduled release will publish. Absent below the medium
   * tier, for a collection without a lifecycle, and for a reader with no
   * release to read, who is shown no figure rather than a zero.
   */
  scheduled?: number;
  /**
   * The last 30 days, as a series over that range (a point a UTC day, the
   * first counting only what falls inside the range), and how many entries
   * were created in the 30 days before them. Only a large card draws it, so
   * only a large card is answered it.
   */
  trend?: { points: readonly CoreSeriesPoint[]; prior: number };
}

/**
 * One group of a Breakdown: the value its entries share, and how many hold it.
 *
 * @internal
 */
export interface BreakdownBucket {
  /** The stored value; `null` for entries holding none. */
  value: string | null;
  count: number;
}

/**
 * What a Breakdown card draws.
 *
 * @internal
 */
export interface BreakdownWidgetData {
  /**
   * Each group, largest first, as the read answered them; `null` when the
   * collection has nothing to divide its entries by for this reader, and so
   * nothing was read.
   */
  buckets: readonly BreakdownBucket[] | null;
  /** The field the entries were divided by: its label, and its values' names. */
  field?: WidgetResultField;
  /** Whether more groups exist than were answered. */
  truncated?: boolean;
  /** Whether each count is a floor: at least this many. */
  atLeast?: boolean;
}

/**
 * What an Over time card draws.
 *
 * @internal
 */
export interface OverTimeWidgetData {
  /** Every interval of the card's range, oldest first, a quiet one at zero. */
  points: readonly CoreSeriesPoint[];
  /** What each point counts: a UTC day, an ISO week or a calendar month, as its range sets. */
  interval: RangeInterval;
}

/**
 * One row of a Recent entries card, as JSON carries it.
 *
 * @internal
 */
export type RecentEntryRow = TransportableRow;

/**
 * What a Recent entries card draws.
 *
 * @internal
 */
export interface RecentEntriesWidgetData {
  /**
   * The field that names each row, the collection's title field; `null` when
   * the collection names no title this reader may read, and so nothing was
   * read.
   */
  title: string | null;
  /** The rows, most recently changed first: one more than the card draws, when more exist. */
  rows: readonly RecentEntryRow[];
  /** The columns the rows carry, title first, as the read described them. */
  columns: readonly WidgetResultField[];
  /** How many entries the read matched in all, for "View all (N)". */
  total?: number;
  /** Whether `total` is a floor. */
  atLeast?: boolean;
}
