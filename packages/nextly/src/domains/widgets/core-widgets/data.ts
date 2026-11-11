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
 * The value a Count card's Source holds for the people on the site rather than
 * a collection: a slug no collection can take, as `users-gate` stores it.
 *
 * @internal
 */
export type CountUsersSource = "users";

/**
 * What a Count card counts of a collection: every entry, or only the
 * published ones, or only the drafts.
 *
 * @internal
 */
export type CountMeasure = "all" | "published" | "draft";

/**
 * The one line a Count card draws under its number: the change this week, a
 * trend over the last 8 weeks, the split by status, or nothing.
 *
 * @internal
 */
export type CountLine = "change" | "trend" | "split" | "none";

/**
 * What a Count card draws: its number, and the one line under it, each about
 * the same set of entries (or people).
 *
 * @internal
 */
export interface CountWidgetData {
  /**
   * How many it counts: the people with an account, or the collection's
   * entries under the card's Filter that its Count setting counts.
   */
  total: number;
  /**
   * What the number counts: `"people"` for Users; for a collection, its Count
   * setting, held to every entry where the collection has no draft and
   * published lifecycle, since it has nothing else to count.
   */
  counted: "people" | CountMeasure;
  /**
   * The line under the number, as answered: the card's "Under the number",
   * except that a status split is drawn only for every entry of a collection
   * with a lifecycle, and is answered as the change this week elsewhere.
   */
  line: CountLine;
  /**
   * For the change line: how many of what the number counts were made in the
   * last 7 days. Absent where it could not be read, and then no line is drawn.
   */
  change?: number;
  /**
   * For the trend line: how many the number counted at the end of each of the
   * last 8 weeks, oldest first, then now (the number itself), each counting
   * only what the number counts, by when it was made. Absent where it could
   * not be read.
   */
  trend?: readonly number[];
  /**
   * For the status split: the published and the draft entries, which together
   * are the number, and the entries scheduled releases will publish where the
   * reader may read releases.
   */
  split?: { published: number; draft: number; scheduled?: number };
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

/**
 * What a list card answered by one of core's own sources draws (Content,
 * Continue where you left off, Upcoming releases, Team activity): the source's
 * rows as JSON carries them, with what the same read counted beside them.
 *
 * @internal
 */
export interface CoreListWidgetData {
  /** The rows, in the source's order: one more than the card draws, when more exist. */
  items: readonly TransportableRow[];
  /** How many rows the read matched in all, for "View all (N)". */
  total?: number;
  /** Whether `total` is a floor. */
  atLeast?: boolean;
  /** How `total` divides among the kinds of row (`{ collection: 8, single: 5 }`). */
  totalByKind?: Readonly<Record<string, number>>;
  /** The span the source looked at, in whole days back from now. */
  window?: { days: number };
}

/**
 * What the Team card draws: how many people and roles there are, each only
 * when the reader may see it, so a count withheld is never drawn as zero.
 *
 * @internal
 */
export interface TeamWidgetData {
  users?: number;
  roles?: number;
}
