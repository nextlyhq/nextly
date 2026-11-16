/**
 * The dashboard header's live summary, part by part, from what each part's own
 * source answered for the reader: the items of the attention digest, the
 * releases due within a week, and each widget on the reader's dashboard that
 * declares a `summary`.
 *
 * Each part is read from the source its card reads, as the same reader, so the
 * header and the card cannot disagree. A part with nothing to say is left out;
 * a part whose source failed is reported as failed, so the line is never
 * worded as "all caught up" while something is unknown.
 *
 * Pure: the reads happen in the summary route, and the wording in the admin,
 * which knows the reader's own day for "today" and "tomorrow".
 *
 * @module services/dashboard/header-summary
 */

import type { DashboardSummaryPart } from "../../api/dashboard-summary-types";
import type { AttentionDigestItem } from "../../domains/widgets/attention/digest-item";
import { digestTotal } from "../../domains/widgets/attention-keys";
import type { WidgetSummaryCount } from "../../domains/widgets/declaration/define-widget";

/** One part of the summary line, before it is worded: the wire shape's part. */
export type HeaderSummaryPart = DashboardSummaryPart;

/** What one part's read gave: a part, nothing to say, or a failure. */
export type PartRead = HeaderSummaryPart | null | "failed";

/** How far ahead a release counts: the week from now. */
export const RELEASES_WITHIN_DAYS = 7;

/**
 * The attention part from the attention digest the Needs your attention card
 * draws, read for the same reader: how many items it holds, by the one rule
 * that counts them (`digestTotal`), which is the number the card's title shows.
 *
 * A floor ("N+") when any item failed or its count stopped at a bound: the
 * card then says "Not all checked" or "99+" on that row, and the line must not
 * read as exact. Nothing to say when the digest holds no item, failed ones
 * included, since a failed item is an item.
 *
 * Linked to the overdue releases, by that item's own link, when they are
 * waiting: the line's one link to a list of its own.
 */
export function attentionPart(items: readonly AttentionDigestItem[]): PartRead {
  const { count, atLeast } = digestTotal(items);
  if (count === 0) return null;
  const overdue = items.find(
    item => item.kind === "overdue" && item.failed !== true
  );
  return {
    kind: "attention",
    count,
    ...(atLeast ? { atLeast: true } : {}),
    ...(overdue?.link === undefined ? {} : { link: overdue.link }),
  };
}

/** One release row as the releases source answers it. */
interface ReleaseRow {
  readonly scheduledAt?: unknown;
}

/**
 * The releases part from the source's soonest-first rows: those due within
 * the week from `now`, and when the first is due. When the source answered as
 * many rows as it was asked for, every one within the week, more may follow,
 * so the count is a floor.
 */
export function releasesPart(
  rows: readonly ReleaseRow[],
  now: Date,
  asked: number
): PartRead {
  const until = now.getTime() + RELEASES_WITHIN_DAYS * 24 * 60 * 60 * 1000;
  const due = rows
    .map(row => instantOf(row.scheduledAt))
    .filter(
      (at): at is number =>
        at !== undefined && at >= now.getTime() && at <= until
    );
  if (due.length === 0) return null;
  return {
    kind: "releases",
    count: due.length,
    ...(rows.length >= asked && due.length === rows.length
      ? { atLeast: true as const }
      : {}),
    nearest: new Date(Math.min(...due)).toISOString(),
  };
}

/** A row's date as milliseconds, or `undefined` when it is not one. */
function instantOf(value: unknown): number | undefined {
  if (value instanceof Date) return value.getTime();
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const at = new Date(value).getTime();
  return Number.isNaN(at) ? undefined : at;
}

/**
 * A widget's summary part, or nothing to say when its count is none. A count
 * the widget answered as a floor stays one (`atLeast`), as the attention and
 * releases parts carry theirs.
 */
export function widgetPart(
  widget: string,
  card: string,
  label: string,
  answer: WidgetSummaryCount
): PartRead {
  const { count, atLeast } =
    typeof answer === "number" ? { count: answer, atLeast: false } : answer;
  if (!Number.isFinite(count) || count <= 0) return null;
  return {
    kind: "widget",
    widget,
    card,
    label,
    count: Math.floor(count),
    ...(atLeast === true ? { atLeast: true as const } : {}),
  };
}
