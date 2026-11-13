/**
 * The fingerprint of a page's published content, which a sitemap date moves
 * on: what a visitor sees, written the same way however it was read.
 *
 * Left out: the page's `seo` group, which changes how the page is listed and
 * shared but not what it shows, and Nextly's bookkeeping (its id, its
 * stamps, its status and every `_`-prefixed field), which a save rewrites
 * whatever it changes. Another document read with the page, such as its
 * author, is named by its id alone: its own stamps move on its own saves.
 * Keys are sorted, a date is its ISO text and a field read back empty is no
 * field, so two reads of one content give one fingerprint.
 *
 * Pure, so the save hook and its tests share it.
 *
 * @module content-dates/fingerprint
 */
import { createHash } from "node:crypto";

import { isRecord } from "../plain-values";

/** A page's own fields that are not its content. */
const NOT_CONTENT: ReadonlySet<string> = new Set([
  "id",
  "seo",
  "status",
  "createdAt",
  "updatedAt",
]);

/** How deep into nested content the fingerprint reads before it stops. */
const MAX_DEPTH = 64;

/**
 * Another document read with the page, told by the stamps every stored
 * document carries; a repeater's item has an id and no stamps.
 */
function isOtherDocument(value: Record<string, unknown>): boolean {
  return (
    value.id !== undefined &&
    (value.createdAt !== undefined || value.updatedAt !== undefined)
  );
}

/** `value` in one spelling: sorted keys, dates as text, no empty fields. */
function canonical(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value))
    return value.map(each => canonical(each, depth + 1));
  if (!isRecord(value)) return value;
  if (depth > 0 && isOtherDocument(value)) return { id: String(value.id) };
  const entries = Object.entries(value)
    .filter(([key, inner]) => {
      if (inner === null || inner === undefined) return false;
      return depth > 0 || (!NOT_CONTENT.has(key) && !key.startsWith("_"));
    })
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, inner]) => [key, canonical(inner, depth + 1)] as const);
  return Object.fromEntries(entries);
}

/** The SHA-256 of the page's content, as hex: the same on every dialect. */
export function contentFingerprint(
  document: Readonly<Record<string, unknown>>
): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(document, 0)), "utf8")
    .digest("hex");
}
