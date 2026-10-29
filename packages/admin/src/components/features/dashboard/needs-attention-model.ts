/**
 * What the Needs your attention card draws, read from its `load` answer: one
 * row per item of the attention digest, in the order the server ranked them.
 *
 * Kept apart from the component so the reading is tested without rendering:
 * which links are drawn, how a count reads, and which items are failed.
 */

import { adminHref } from "@admin/constants/routes";

import { countSpoken, countText } from "../widgets/frame/list-card";

/** How urgent an item is, as the server ranked it. */
export type AttentionSeverity = "critical" | "warning";

/** One item as the card draws it. */
export interface AttentionRow {
  id: string;
  label: string;
  severity: AttentionSeverity;
  /** The item's label with its count: "Overdue releases · 2". Just the label on a failed item. */
  title: string;
  /** The same, as assistive technology reads it: "Overdue releases: 2 or more". */
  spoken: string;
  /** Why it is waiting, when its owner said; drawn on the row's meta line. */
  reason?: string;
  /** Where Review leads, when the item's link is one the admin draws. */
  href?: string;
  /** The count could not be read: the row says so and offers Retry. */
  failed: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isText = (value: unknown): value is string =>
  typeof value === "string" && value !== "";

/** One item of the answer, or `null` for anything the card cannot draw. */
function attentionRow(item: unknown): AttentionRow | null {
  if (!isRecord(item) || !isText(item.id) || !isText(item.label)) return null;
  const { id, label } = item;
  const severity: AttentionSeverity =
    item.severity === "critical" ? "critical" : "warning";
  const failed = item.failed === true;
  const count = typeof item.count === "number" ? item.count : 0;
  const atLeast = item.atLeast === true;
  // The link is the one rule startup holds a plugin's link to: a path inside
  // the admin. One that breaks it is drawn with no Review rather than as a link
  // that leaves the admin.
  const href = isText(item.link) ? adminHref(item.link) : undefined;
  return {
    id,
    label,
    severity,
    title: failed ? label : `${label} · ${countText(count, atLeast)}`,
    spoken: failed ? label : `${label}: ${countSpoken(count, atLeast)}`,
    ...(isText(item.reason) ? { reason: item.reason } : {}),
    ...(href === undefined ? {} : { href }),
    failed,
  };
}

/**
 * The rows of the card's answer, in the answer's own order: the server ranks
 * them (critical first, then most waiting, then by label), and the card keeps
 * that rank so it folds only the least urgent.
 */
export function attentionRows(data: unknown): AttentionRow[] {
  const items = isRecord(data) ? data.items : undefined;
  if (!Array.isArray(items)) return [];
  return items.flatMap(item => {
    const row = attentionRow(item);
    return row === null ? [] : [row];
  });
}
