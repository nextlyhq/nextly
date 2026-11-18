/**
 * How the binding picker shows a field's value: its start, as text, cut
 * short; a picture as its small thumbnail; a field holding nothing as empty.
 * One rule for every value the picker shows, the host's listing of a page's,
 * a Single's and the site's fields and the sample of a list's entry alike,
 * so a value reads the same wherever it is listed.
 *
 * Pure, with no server import, so the server route and the editor in the
 * browser both read it.
 *
 * @module binding-preview
 */
import { isPlainRecord } from "@nextlyhq/blocks-engine";

/** A preview's length, in characters, before it is cut. */
const PREVIEW_LENGTH = 80;

/**
 * A value's preview: text, a number or a yes-or-no, cut short; else none.
 *
 * @param value - the stored value
 * @returns its start as text, or `undefined` for a value with none to show
 */
export function previewOf(value: unknown): string | undefined {
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (text === "") return undefined;
  return text.length > PREVIEW_LENGTH
    ? `${text.slice(0, PREVIEW_LENGTH - 1)}…`
    : text;
}

/**
 * Whether a value holds nothing: absent, blank text or an empty list. A zero,
 * a no and a record are values.
 *
 * @param value - the stored value
 * @returns whether the picker says "(empty)" for it
 */
export function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  return Array.isArray(value) && value.length === 0;
}

/** An address a picture may be drawn from: the site's own path, or the web's. */
function drawable(address: unknown): address is string {
  return (
    typeof address === "string" && /^(?:https?:\/\/|\/(?!\/))/i.test(address)
  );
}

/**
 * A picture's small thumbnail, as a media record read with its entry holds
 * it: its thumbnail's address, else its own; none for a file that is no
 * image, a bare id, or an address no picture is drawn from.
 *
 * @param value - the stored value, a media record where it was read as one
 * @returns the address the picker draws a thumbnail from
 */
export function thumbnailOf(value: unknown): string | undefined {
  if (!isPlainRecord(value)) return undefined;
  const type = value.mimeType;
  if (typeof type !== "string" || !type.startsWith("image/")) return undefined;
  if (drawable(value.thumbnailUrl)) return value.thumbnailUrl;
  return drawable(value.url) ? value.url : undefined;
}

/** One value as a list's sample says it: text, a thumbnail, or empty. */
export type SampleValue =
  | string
  | { readonly thumbnail: string }
  | { readonly empty: true };

/** A value's sample, or `undefined` for one with nothing to show. */
function sampleOf(value: unknown): SampleValue | undefined {
  const text = previewOf(value);
  if (text !== undefined) return text;
  const thumbnail = thumbnailOf(value);
  if (thumbnail !== undefined) return { thumbnail };
  return isEmptyValue(value) ? { empty: true } : undefined;
}

/**
 * Each field's sample in one entry, by its path: its own fields, and one
 * step into a group or a populated relation (`author.name`), as far as the
 * picker lists fields. Text is previewed, a picture is its thumbnail, and a
 * field holding nothing is said empty; a field with nothing to show is left
 * out.
 *
 * @param row - the entry, as a list read returns it
 * @returns the samples by path
 */
export function rowPreviews(
  row: Readonly<Record<string, unknown>>
): Readonly<Record<string, SampleValue>> {
  const previews: Record<string, SampleValue> = {};
  for (const [name, value] of Object.entries(row)) {
    const own = sampleOf(value);
    if (own !== undefined) previews[name] = own;
    if (!isPlainRecord(value)) continue;
    for (const [inner, innerValue] of Object.entries(value)) {
      const shown = sampleOf(innerValue);
      if (shown !== undefined) previews[`${name}.${inner}`] = shown;
    }
  }
  return previews;
}
