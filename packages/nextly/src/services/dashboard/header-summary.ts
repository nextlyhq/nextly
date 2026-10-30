/**
 * The dashboard header's live summary, part by part, from what each part's own
 * source answered for the reader: the attention total, the releases due within
 * a week, and each widget on the reader's dashboard that declares a `summary`.
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
import {
  attentionTotalOf,
  type AttentionKind,
  type AttentionTotalBucket,
} from "../../domains/widgets/attention-keys";

/** One part of the summary line, before it is worded: the wire shape's part. */
export type HeaderSummaryPart = DashboardSummaryPart;

/** What one part's read gave: a part, nothing to say, or a failure. */
export type PartRead = HeaderSummaryPart | null | "failed";

/** How far ahead a release counts: the week from now. */
export const RELEASES_WITHIN_DAYS = 7;

/**
 * The attention part from the Needs attention card's own grouped answer: its
 * total, by the one rule the card draws its total by (`attentionTotalOf`), so
 * the header counts exactly what the card counts.
 *
 * Failed when the total is none but a floor: some lists went unread, so the
 * card says "Not all checked" rather than "All clear", and the line must not
 * call the reader caught up. Nothing to say when nothing is waiting.
 *
 * @param overdueLink where the overdue releases are listed: the line's link
 * when the answer holds overdue releases, the kind with one list of its own.
 */
export function attentionPart(
  buckets: readonly AttentionTotalBucket[],
  overdueLink: string
): PartRead {
  const { count, atLeast } = attentionTotalOf(buckets);
  if (count === 0) return atLeast ? "failed" : null;
  const overdueKind: AttentionKind = "overdue";
  const overdue = buckets.some(
    bucket => bucket.value === overdueKind && bucket.count > 0
  );
  return {
    kind: "attention",
    count,
    ...(atLeast ? { atLeast: true } : {}),
    ...(overdue ? { link: overdueLink } : {}),
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

/** A widget's summary part, or nothing to say when its count is none. */
export function widgetPart(
  widget: string,
  card: string,
  label: string,
  count: number
): PartRead {
  if (!Number.isFinite(count) || count <= 0) return null;
  return { kind: "widget", widget, card, label, count: Math.floor(count) };
}
