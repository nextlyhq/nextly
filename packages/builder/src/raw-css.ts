/**
 * A value written as CSS in a field's own text row, committed as typed.
 *
 * @module raw-css
 */
import { trimCssWhitespace } from "@nextlyhq/blocks-engine";

/**
 * Commit what was typed into a "Write as CSS" row: as typed, with CSS's own
 * whitespace deciding only whether the row is empty.
 *
 * Trimmed, a stored value with whitespace around it read as changed when
 * nothing was, and a no-break space, which is no CSS whitespace, cleared the
 * value rather than being judged as the value it is. Emptied, the row clears
 * a value set here; an empty row over nothing writes nothing.
 */
export function commitRawCss<Outcome>(
  text: string,
  stored: string | undefined,
  onCommit: (value: string | null) => Outcome
): Outcome | undefined {
  if (text === (stored ?? "")) return undefined;
  if (trimCssWhitespace(text) === "") {
    return stored === undefined ? undefined : onCommit(null);
  }
  return onCommit(text);
}
