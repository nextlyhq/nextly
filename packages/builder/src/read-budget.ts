/**
 * What a page costs to read, as the editor tells an author.
 *
 * A published page makes every read it needs (a list's entries, an image, a
 * link to an entry, a related entry, the page's own data) under one allowance
 * per visit, 500 unless the site's code says otherwise. Past it, reads stop and
 * each block that needed one is drawn as it is when its data is missing. An
 * author cannot see that happening on the page itself, so the editor counts
 * the reads its own draw makes, by the same rules, and says how close the page
 * is to the limit, warning from 80% of it.
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
 * - `near`: from 80%, still within it;
 * - `over`: it needed more than it may make, so some blocks went unread.
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
  return report.used >= warningAt(report.cap) ? "near" : "within";
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

/** What each kind is called, as a count of it reads: "3 lists' entries". */
export const READ_KIND_WORDS: Readonly<
  Record<ReadKind, { readonly label: string; readonly unread: string }>
> = {
  entries: { label: "List entries", unread: "Its entries weren't read" },
  related: {
    label: "Related entries",
    unread: "Its related entries weren't read",
  },
  image: { label: "Images", unread: "Its image wasn't read" },
  link: { label: "Links to entries", unread: "Its link wasn't read" },
  page: { label: "Page data", unread: "Its data wasn't read" },
  component: { label: "Components", unread: "Its component wasn't read" },
};

/** A count as the editor writes it: grouped digits, `∞` for no limit. */
export function readCount(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString("en-US") : "∞";
}

/** The trigger's accessible name: the count and where it stands, in words. */
export function readBudgetName(report: PageReadReport | undefined): string {
  const standing = readBudgetStanding(report);
  if (report === undefined || standing === "counting") {
    return "Page reads: counting";
  }
  const count = `${readCount(report.used)} of ${readCount(report.cap)}`;
  if (standing === "over") {
    const blocks = report.unread.length;
    return `Page reads: over the limit of ${readCount(report.cap)}, ${String(blocks)} ${blocks === 1 ? "block" : "blocks"} not read`;
  }
  return standing === "near"
    ? `Page reads: ${count}, near the limit`
    : `Page reads: ${count}`;
}
