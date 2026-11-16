/**
 * How the binding picker shows a field's value: its start, as text, cut
 * short. One rule for every value the picker shows, the host's listing of a
 * page's, a Single's and the site's fields and the sample of a list's first
 * entry alike, so a value reads the same wherever it is listed.
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
 * Each field's preview in one entry, by its path: its own fields, and one
 * step into a group or a populated relation (`author.name`), as far as the
 * picker lists fields. A field with nothing to show is left out.
 *
 * @param row - the entry, as a list read returns it
 * @returns the previews by path
 */
export function rowPreviews(
  row: Readonly<Record<string, unknown>>
): Readonly<Record<string, string>> {
  const previews: Record<string, string> = {};
  for (const [name, value] of Object.entries(row)) {
    const own = previewOf(value);
    if (own !== undefined) previews[name] = own;
    if (!isPlainRecord(value)) continue;
    for (const [inner, innerValue] of Object.entries(value)) {
      const shown = previewOf(innerValue);
      if (shown !== undefined) previews[`${name}.${inner}`] = shown;
    }
  }
  return previews;
}
