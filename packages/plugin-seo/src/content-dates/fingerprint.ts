/**
 * The fingerprint of a page's published content, which a sitemap date moves
 * on: what a visitor sees, written the same way however it was read.
 *
 * Left out: the page's `seo` group, which changes how the page is listed and
 * shared but not what it shows, and Nextly's bookkeeping (its id, its
 * stamps, its status and every `_`-prefixed field), which a save rewrites
 * whatever it changes. The same stamps are left out at every depth, and a
 * field group's row leaves out its own id too: a save that sends a group
 * back unchanged rewrites its rows, moving their stamps, and stores a
 * repeatable group's item sent without its id again under a new one.
 * Another document read with the page, such as its author, is named by its
 * id alone: its own stamps move on its own saves.
 * Keys are sorted, a date is its ISO text and a field read back empty is no
 * field, so two reads of one content give one fingerprint.
 *
 * Earlier releases read a field group's rows as stored, their ids and stamps
 * included. `earlierContentFingerprints` gives what they kept for the same
 * content, so a row kept then is brought up to date without moving its date.
 *
 * Pure, so the save hook and its tests share it.
 *
 * @module content-dates/fingerprint
 */
import { createHash } from "node:crypto";

import { isRecord } from "../plain-values";

/**
 * Nextly's stamps on a stored row, by the names a read gives them and by the
 * column names a save hook, or a field group's row, is handed them under.
 */
const STAMPS: ReadonlySet<string> = new Set([
  "createdAt",
  "updatedAt",
  "createdBy",
  "updatedBy",
  "firstPublishedAt",
  "created_at",
  "updated_at",
  "created_by",
  "updated_by",
  "first_published_at",
]);

/** A page's own fields that are not its content: its stamps, id, SEO and status. */
const NOT_CONTENT: ReadonlySet<string> = new Set([
  ...STAMPS,
  "id",
  "seo",
  "status",
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

/**
 * A row a field group keeps, told by the column-named stamps its read
 * carries; a stored document is read with them named `createdAt` and
 * `updatedAt`, and a value naming what content links to has none.
 */
function isFieldGroupRow(value: Record<string, unknown>): boolean {
  return value.created_at !== undefined || value.updated_at !== undefined;
}

/**
 * How records inside the page are read: `current` leaves out their stamps
 * and a field group row's id; `asStored`, as earlier releases did, keeps
 * every key.
 */
type NestedReading = "current" | "asStored";

/** Whether `key` of a record read inside the page is not content. */
function isNestedBookkeeping(
  key: string,
  row: boolean,
  reading: NestedReading
): boolean {
  if (reading === "asStored") return false;
  return STAMPS.has(key) || (row && key === "id");
}

/** `value` in one spelling: sorted keys, dates as text, no empty fields. */
function canonical(
  value: unknown,
  depth: number,
  reading: NestedReading
): unknown {
  if (depth > MAX_DEPTH) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value))
    return value.map(each => canonical(each, depth + 1, reading));
  if (!isRecord(value)) return value;
  if (depth > 0 && isOtherDocument(value)) return { id: String(value.id) };
  const row = depth > 0 && isFieldGroupRow(value);
  const entries = Object.entries(value)
    .filter(([key, inner]) => {
      if (inner === null || inner === undefined) return false;
      // Below the page, a `_`-prefixed key can be content, such as the kind
      // of field group a block is, so only the stamps and a row's id go.
      return depth > 0
        ? !isNestedBookkeeping(key, row, reading)
        : !NOT_CONTENT.has(key) && !key.startsWith("_");
    })
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(
      ([key, inner]) => [key, canonical(inner, depth + 1, reading)] as const
    );
  return Object.fromEntries(entries);
}

/** The SHA-256 of `document`'s content read as `reading` says, as hex. */
function fingerprintOf(
  document: Readonly<Record<string, unknown>>,
  reading: NestedReading
): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(document, 0, reading)), "utf8")
    .digest("hex");
}

/** The SHA-256 of the page's content, as hex: the same on every dialect. */
export function contentFingerprint(
  document: Readonly<Record<string, unknown>>
): string {
  return fingerprintOf(document, "current");
}

/**
 * The fingerprints earlier releases kept for the same content, which read
 * a field group's rows as stored. A kept row holding one of them holds this
 * content, so its date stays. Only what differs from the current one.
 */
export function earlierContentFingerprints(
  document: Readonly<Record<string, unknown>>
): string[] {
  const current = contentFingerprint(document);
  const earlier = fingerprintOf(document, "asStored");
  return earlier === current ? [] : [earlier];
}
