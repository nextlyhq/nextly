/**
 * Which kind of in-place editing a prop asks for, asked once.
 *
 * A block opts a value into editing on the canvas with `inline`, and what that
 * MEANS depends on the value: a line of text is handed to a `contenteditable`
 * element and read back as a string, while a passage is handed to a rich-text
 * editor and read back as a tree. The two surfaces cannot serve each other —
 * reading a tree as text yields an empty string, and writing a string where a
 * tree belongs breaks every reader of the format.
 *
 * So the question is not "is this inline" but "inline as WHAT", and it is asked
 * here rather than answered separately by each surface. Two predicates —
 * `inline && type !== rich` on one side and `inline && type === rich` on the
 * other — agree today and are one edit apart from disagreeing: the day a third
 * kind arrives, whichever surface was not updated silently claims it, and the
 * failure is a value handed to the wrong editor rather than an error.
 *
 * @module inline-prop-kind
 */

import { RICH_TEXT_PROP_TYPE, type PropSchema } from "@nextlyhq/blocks-engine";

/**
 * How a value may be edited on the canvas, or `null` when it may not be.
 *
 * `"plain"` is the default for anything that opted in without saying otherwise,
 * because that is what every prop type other than rich text is: a scalar an
 * element can hold as its text.
 */
export type InlinePropKind = "plain" | "rich";

/**
 * The kind of in-place editing this schema opted into, or `null` for none.
 *
 * Decided from the declared TYPE, never from the value a node happens to hold.
 * A passage the author has not written yet is still a passage, and asking the
 * value would offer an empty one to the plain-text surface — which would read
 * nothing out of it and write an empty string back over it.
 *
 * @param schema - the prop's schema, or nothing for a prop the block never declared
 * @returns the kind, or `null` when the value is not editable on the canvas
 */
export function inlinePropKind(
  schema: PropSchema | undefined
): InlinePropKind | null {
  if (schema?.inline !== true) return null;
  return schema.type === RICH_TEXT_PROP_TYPE ? "rich" : "plain";
}
