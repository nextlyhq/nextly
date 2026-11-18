/**
 * The address of one item of a list of words an author types on the canvas.
 *
 * A block that holds its items as an array of strings (a List) opts the array
 * into canvas editing with `inline`, as any other value, and marks each item's
 * element with `markProp(itemPropName("items", index))`. The editor then edits
 * each item as a line of text of its own and writes the array back.
 *
 * One spelling, here, because three packages read it: the renderer marks it,
 * the editor finds the element by it and writes the array from it. Spelled in
 * each, the three agree on the day they are written and the first to drift
 * leaves an item marked under a name the editor no longer reads, which an
 * author sees as an item that will not take the caret.
 *
 * @module inline-items
 */

import type { PropSchema } from "./block";

/**
 * A prop name, a dot, and an index without leading zeros. The name part is
 * an identifier, so a declared prop name holding a dot is never read as an
 * item, and `items.01` addresses nothing rather than item 1.
 */
const ITEM_ADDRESS = /^([A-Za-z_$][\w$]*)\.(0|[1-9]\d*)$/;

/** One item of an array prop, as its address names it. */
export interface InlineItemAddress {
  /** The array prop holding the item. */
  readonly prop: string;
  /** The item's place in that array, from zero. */
  readonly index: number;
}

/**
 * The address of the item at `index` of the array prop `prop`.
 *
 * @example itemPropName("items", 2) // "items.2"
 */
export function itemPropName(prop: string, index: number): string {
  return `${prop}.${String(index)}`;
}

/**
 * The array prop and index an address names, or `null` for a name that is not
 * an item's address (an ordinary prop's own name among them).
 */
export function itemOfPropName(name: string): InlineItemAddress | null {
  const match = ITEM_ADDRESS.exec(name);
  if (match === null) return null;
  const [, prop, index] = match;
  if (prop === undefined || index === undefined) return null;
  return { prop, index: Number(index) };
}

/**
 * Whether a prop is an array of words whose items an author may type on the
 * canvas: declared `inline`, of type `array`, and holding text.
 *
 * An array of anything else (records, media) has no line of text to edit, so
 * declaring it `inline` offers nothing.
 */
export function isInlineItemsProp(
  schema: PropSchema | undefined
): boolean {
  return (
    schema?.inline === true &&
    schema.type === "array" &&
    (schema.of === undefined || schema.of === "text")
  );
}
