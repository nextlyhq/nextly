/**
 * A field's stored value as plain text, for two of its versions to be compared
 * word by word. The same reading for both, so text nobody changed is never
 * marked as changed.
 *
 * @module components/features/translations/review/field-text
 */

import {
  isLexicalDocument,
  richTextToText,
} from "@admin/components/features/versions/value-display/rich-text-to-text";

/** A rich text value kept as a string of its own document. */
function parsedDocument(value: string): unknown {
  if (!value.trimStart().startsWith("{")) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return isLexicalDocument(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** The value in words; nothing held is no words. */
export function fieldText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") {
    const document = parsedDocument(value);
    return document === undefined ? value : richTextToText(document);
  }
  if (isLexicalDocument(value)) return richTextToText(value);
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value, null, 2);
}
