/**
 * What a page costs to read, as the editor tells an author.
 *
 * A published page makes every read it needs (a list's entries, an image, a
 * link to an entry, a related entry, the page's own data) under one allowance
 * per visit, 500 unless the site's code says otherwise. Past it, reads stop and
 * each block that needed one is drawn as it is when its data is missing. An
 * author cannot see that happening on the page itself, so the editor counts
 * the reads its own draw makes, by the same rules, and says how close the page
 * is to the limit: the top bar only from 80% of it, Page settings always.
 *
 * This module is the model: the report a count produces and the one reading
 * of it every surface shares, so the bar's colour, the trigger's words and the
 * panel's sentence cannot disagree about whether a page is near its limit.
 *
 * @module read-budget
 * @experimental Settles with the canvas's read count.
 */

import {
  READ_KINDS,
  type PageReadReport,
  type ReadKind,
  type UnreadBlock,
} from "@nextlyhq/blocks-react";

// The report and its kinds are the renderer's own, so the meter reads
// exactly what the page's budget counted, by the same names.
export { READ_KINDS };
export type { PageReadReport, ReadKind, UnreadBlock };

/**
 * Where a page stands against its allowance:
 * - `counting`: the canvas is still drawing, so there is no count yet;
 * - `within`: under 80% of it;
 * - `near`: from 80%, with room left;
 * - `over`: the whole allowance is spent, so the next read is refused, or it
 *   needed more than it may make, so some blocks went unread.
 */
export type ReadBudgetStanding = "counting" | "within" | "near" | "over";

/** The share of the allowance from which the editor warns. */
export const READ_WARNING_SHARE = 0.8;

/** Where a report puts the page. `undefined` is a draw still counting. */
export function readBudgetStanding(
  report: PageReadReport | undefined
): ReadBudgetStanding {
  if (report === undefined) return "counting";
  if (report.refused > 0 || report.unread.length > 0) return "over";
  // An unlimited route (`maxQueries: Infinity`) is never near its limit.
  if (!Number.isFinite(report.cap)) return "within";
  // A page that spent its whole allowance has no room for one more list or
  // image: the next block that needs data comes up empty.
  if (report.cap > 0 && report.used >= report.cap) return "over";
  return report.used >= warningAt(report.cap) ? "near" : "within";
}

/**
 * Whether the top bar shows the meter: only once the page nears its limit,
 * since a page far from it has nothing to warn of, and never while counting.
 * A count that could not be made is shown too (the meter says so), because a
 * hidden failure could hide a page over its limit.
 */
export function shownInTopBar(standing: ReadBudgetStanding): boolean {
  return standing === "near" || standing === "over";
}

/** The read from which a page of `cap` is warned about. */
export function warningAt(cap: number): number {
  return Math.ceil(cap * READ_WARNING_SHARE);
}

/** How full the allowance is, from 0 to 1, for a bar. */
export function readShare(report: PageReadReport): number {
  if (!Number.isFinite(report.cap) || report.cap <= 0) {
    return report.cap === 0 && report.refused > 0 ? 1 : 0;
  }
  return Math.min(1, Math.max(0, report.used / report.cap));
}

/**
 * What each kind is called in the explanation's rows, and what a block that
 * went without it shows on the live site.
 */
export const READ_KIND_WORDS: Readonly<
  Record<ReadKind, { readonly label: string; readonly unread: string }>
> = {
  entries: { label: "List entries", unread: "Its entries don't load" },
  related: {
    label: "Related entries",
    unread: "Its related entries don't load",
  },
  image: { label: "Images", unread: "Its image doesn't load" },
  link: { label: "Links to entries", unread: "Its link doesn't load" },
  page: { label: "The page itself", unread: "Its data doesn't load" },
  component: { label: "Components", unread: "Its component doesn't load" },
};

/** A count as the editor writes it: grouped digits, `∞` for no limit. */
export function readCount(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString("en-US") : "∞";
}

/**
 * The count as the meter writes it: "Page data: 430 of 500", or for a site
 * with no limit, "Page data: 12 (no limit)".
 */
export function pageDataCount(report: PageReadReport): string {
  return Number.isFinite(report.cap)
    ? `Page data: ${readCount(report.used)} of ${readCount(report.cap)}`
    : `Page data: ${readCount(report.used)} (no limit)`;
}

/** Where a page stands, as the meter's accessible name says it. */
const STANDING_NAME: Record<Exclude<ReadBudgetStanding, "counting">, string> = {
  within: "within the limit",
  near: "near the limit",
  over: "over the limit",
};

/**
 * The meter's accessible name: the count, where it stands, and that pressing
 * it explains ("Page data: 430 of 500, near the limit. What's this?").
 */
export function readBudgetName(report: PageReadReport | undefined): string {
  const standing = readBudgetStanding(report);
  if (report === undefined || standing === "counting") {
    return "Page data: counting. What's this?";
  }
  if (!Number.isFinite(report.cap)) {
    return `Page data: ${readCount(report.used)}, no limit. What's this?`;
  }
  return `${pageDataCount(report)}, ${STANDING_NAME[standing]}. What's this?`;
}

/** The meter's words and name when the count could not be made. */
export const COUNT_FAILED_NAME = "Page data: couldn't count. Retry";

/** One block drawn without its data, with every read it went without. */
export interface UnreadRow {
  readonly nodeId: string;
  readonly what: readonly ReadKind[];
}

/**
 * The blocks a report names as unread, each once in the order it first
 * asked, with every kind of read it missed: what the panel lists and every
 * count of unread blocks says, so a block that missed its image and its link
 * is one block, not two.
 */
export function unreadBlocks(report: PageReadReport): readonly UnreadRow[] {
  const rows = new Map<string, ReadKind[]>();
  for (const { nodeId, what } of report.unread) {
    const missed = rows.get(nodeId) ?? [];
    if (!missed.includes(what)) missed.push(what);
    rows.set(nodeId, missed);
  }
  return [...rows].map(([nodeId, what]) => ({ nodeId, what }));
}
