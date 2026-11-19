/**
 * The words a block gives one of its Style properties' fields, where the
 * catalog's are wrong for what the block draws. A Divider draws one line,
 * which is its top border: "Top", "Bottom", "Left", "Right", "Style" and
 * "Colour" name a box it does not have. It names its own fields (Thickness,
 * Line style, Line colour), draws only those, and says where the line comes
 * from. What is stored, and where, is the catalog's as ever.
 *
 * @module block-style-words
 */
import type { InspectedStyleProperty } from "./inspector/style-inspector/style-inspector";
import type { StyleControl } from "./style-controls";

/** A block's words for one Style property. */
export interface PropertyWords {
  /** Each field's label, by its path (`width.blockStart`). */
  readonly labels: Readonly<Record<string, string>>;
  /** The fields drawn, by path, in this order; the rest are left out. */
  readonly fields: readonly string[];
  /** A line under the property, saying what it is on this block. */
  readonly hint?: string;
}

/** The blocks that word a property their own way, by block and property. */
const BLOCK_STYLE_WORDS: Readonly<
  Record<string, Readonly<Record<string, PropertyWords>>>
> = {
  "core/divider": {
    border: {
      labels: {
        color: "Line colour",
        "width.blockStart": "Thickness",
        style: "Line style",
      },
      fields: ["color", "width.blockStart", "style"],
      hint: "The divider's line is its top border.",
    },
  },
};

/** A block's words for a property, or none where the catalog's stand. */
export function propertyWordsFor(
  blockType: string | undefined,
  property: string
): PropertyWords | undefined {
  return blockType === undefined
    ? undefined
    : BLOCK_STYLE_WORDS[blockType]?.[property];
}

/**
 * The property with only the fields the block's words draw, in their order;
 * a field holding a value here stays, so a value set any other way can still
 * be seen and cleared.
 */
export function wordedProperty(
  property: InspectedStyleProperty,
  words: PropertyWords | undefined
): InspectedStyleProperty {
  if (words === undefined) return property;
  const at = (control: StyleControl) => control.path.join(".");
  const named = words.fields.flatMap(path =>
    property.controls.filter(control => at(control) === path)
  );
  const held = property.controls.filter(
    control =>
      !words.fields.includes(at(control)) &&
      valueAt(property.value, control.path) !== undefined
  );
  return { ...property, controls: [...named, ...held] };
}

/** What a stored value holds at a path, or none. */
function valueAt(value: unknown, path: readonly string[]): unknown {
  let here = value;
  for (const key of path) {
    if (
      typeof here !== "object" ||
      here === null ||
      !Object.hasOwn(here, key)
    ) {
      return undefined;
    }
    here = (here as Record<string, unknown>)[key];
  }
  return here;
}
