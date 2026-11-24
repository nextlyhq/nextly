/**
 * The value a restore puts back, as one short line the person can check
 * before choosing it: "Puts back “Local dev without Docker”".
 *
 * A quote, not a rendering: the dialog lists every field at once, so each
 * value is said in a line's worth of words, and the comparison is where a
 * value is read in full.
 *
 * @module components/features/versions/restore-value-text
 */

import {
  isLexicalDocument,
  richTextToText,
} from "./value-display/rich-text-to-text";

/** How many characters a quoted value keeps before it is shortened. */
const QUOTE_LENGTH = 84;

/** The words a record carries for a person, where it is shown as one. */
const NAMING_KEYS = ["title", "name", "label", "filename"] as const;

/**
 * The value in words, or `undefined` where it has none to quote: an empty
 * value, or a structure with nothing a person would recognise it by.
 */
function wordsOf(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (isLexicalDocument(value)) return richTextToText(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return undefined;
    const named = value.map(wordsOf);
    return named.every(word => word !== undefined && word !== "")
      ? named.join(", ")
      : `${value.length} ${value.length === 1 ? "item" : "items"}`;
  }
  if (value !== null && typeof value === "object") {
    for (const key of NAMING_KEYS) {
      const word = (value as Record<string, unknown>)[key];
      if (typeof word === "string" && word.trim() !== "") return word;
    }
  }
  return undefined;
}

/** Whether a value holds nothing: what restoring it does is clear the field. */
function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

/**
 * The line the restore list shows for a value it puts back: the value quoted
 * and shortened to a line, "Clears the field" for an empty one, a plain
 * statement for a structure with nothing to quote it by, or `undefined` where
 * nothing reached the dialog to say (a hidden field's value never does).
 */
export function restoreValueText(
  value: unknown,
  present: boolean
): string | undefined {
  if (!present) return undefined;
  if (isEmptyValue(value)) return "Clears the field";
  const words = wordsOf(value)?.replace(/\s+/g, " ").trim();
  // Something is put back, so it is never called a clearing; the comparison
  // is where a value like this is read in full.
  if (words === undefined || words === "") {
    return "Puts back the version's value";
  }
  const quoted =
    words.length > QUOTE_LENGTH
      ? `${words.slice(0, QUOTE_LENGTH).trimEnd()}…`
      : words;
  return `Puts back “${quoted}”`;
}
