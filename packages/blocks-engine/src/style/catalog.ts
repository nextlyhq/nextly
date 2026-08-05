/**
 * The style-property catalog: the closed-but-extensible set of keys legal
 * inside a document's `StyleValues`, with each key's value shape, the CSS it
 * emits, and the design-token kinds it accepts.
 *
 * Storage keys are logical-first: a value says "the edge where text starts",
 * not "the left edge", so one document renders correctly in both writing
 * directions with no per-locale style fork. Editors show physical labels
 * ("Left", "Right") mapped by the canvas direction, so the logical vocabulary
 * never reaches users. Sizing stays physical because width and height are
 * direction-neutral.
 *
 * Adding a property here is backwards-compatible; removing one, or changing an
 * existing one's meaning or value shape, is a document-format migration.
 */
import type {
  ColorLeaf,
  CssValueLeaf,
  DimensionLeaf,
  KeywordLeaf,
  LogicalCornersShape,
  LogicalSidesShape,
  NumberLeaf,
  StyleGroup,
  StyleProperty,
  StyleShape,
  TokenKind,
  UrlLeaf,
} from "./catalog-types";
import { shapeLeaves } from "./catalog-types";

// --- Leaf constructors ------------------------------------------------------
// Terse to author, explicit once built: every leaf carries the literal CSS
// property it emits, so emission is data the compiler walks rather than
// branches the compiler holds.

interface DimensionOptions {
  keywords?: readonly string[];
  maxParts?: number;
  allowNegative?: boolean;
  allowPercentage?: boolean;
  functions?: readonly string[];
  allowNumber?: boolean;
}

function dimension(
  cssProperty: string,
  options: DimensionOptions = {}
): DimensionLeaf {
  return {
    kind: "dimension",
    cssProperty,
    tokenKinds: ["dimension"],
    keywords: options.keywords ?? [],
    maxParts: options.maxParts ?? 1,
    allowNegative: options.allowNegative ?? false,
    allowPercentage: options.allowPercentage ?? false,
    functions: options.functions ?? [],
    allowNumber: options.allowNumber ?? false,
  };
}

/**
 * The CSS Box Alignment vocabularies, built from the grammar rather than
 * written out.
 *
 * `align-items` takes a SELF position, `justify-content` and `align-content`
 * take a CONTENT position, and either may be preceded by an overflow-safety
 * keyword. Spelling every combination by hand is where the gaps came from:
 * each is a legal value with no other way to express it, and one missing entry
 * is a declaration an author cannot store. Generating them means adding a
 * position adds its safe and unsafe forms too.
 *
 * `left` and `right` are absent by policy rather than by oversight: the catalog
 * stores logical values so one document serves both writing directions, and a
 * test holds the whole catalog to it.
 */
const SELF_POSITIONS = [
  "center",
  "start",
  "end",
  "self-start",
  "self-end",
  "flex-start",
  "flex-end",
];

const CONTENT_POSITIONS = ["center", "start", "end", "flex-start", "flex-end"];

/** A position, and the same position with each overflow-safety keyword. */
function withOverflowSafety(positions: readonly string[]): string[] {
  return [
    ...positions,
    ...positions.map(position => `safe ${position}`),
    ...positions.map(position => `unsafe ${position}`),
  ];
}

/**
 * Every legal ordering of a set of optional, unordered components.
 *
 * A grammar written with `||` accepts its parts in any order and any
 * non-empty combination, which is more values than are sensible to write out:
 * `text-transform` alone has thirty-seven. Generating them keeps the list
 * exhaustive and keeps a component from being addable without its
 * combinations.
 */
function unorderedCombinations(
  groups: readonly (readonly string[])[]
): string[] {
  const results: string[] = [];
  const build = (chosen: readonly string[], index: number): void => {
    if (index === groups.length) {
      if (chosen.length > 0) results.push(...orderings(chosen));
      return;
    }
    build(chosen, index + 1);
    for (const option of groups[index] ?? [])
      build([...chosen, option], index + 1);
  };
  build([], 0);
  return [...new Set(results)];
}

/** Every ordering of the chosen parts. */
function orderings(parts: readonly string[]): string[] {
  if (parts.length <= 1) return [parts.join(" ")];
  const out: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const rest = [...parts.slice(0, index), ...parts.slice(index + 1)];
    for (const tail of orderings(rest)) out.push(`${parts[index]} ${tail}`);
  }
  return out;
}

/** Where a baseline may be taken from. */
const BASELINE_POSITIONS = [
  "baseline",
  ...unorderedCombinations([["first", "last"], ["baseline"]]).filter(entry =>
    entry.includes(" ")
  ),
];

/** How leftover space is spread between items. */
const CONTENT_DISTRIBUTION = [
  "space-between",
  "space-around",
  "space-evenly",
  "stretch",
];

/**
 * Functions that produce a size rather than a length. Legal on the properties
 * that take a size and discarded elsewhere, which is why they travel with the
 * sizing keywords instead of being allowed wherever a measurement is.
 */
const SIZING_FUNCTIONS = ["fit-content", "calc-size"];

/** Keyword sets shared by several length-valued properties. */
const SIZING_KEYWORDS = [
  "auto",
  "min-content",
  "max-content",
  "fit-content",
  "stretch",
  // Fits the content while respecting the containing block, which neither
  // `stretch` nor `fit-content` reproduces.
  "contain",
];
const MAX_SIZING_KEYWORDS = [
  "none",
  "min-content",
  "max-content",
  "fit-content",
  "stretch",
  "contain",
];
const FONT_SIZE_KEYWORDS = [
  // Scales with MathML script level; no absolute or relative size reproduces it.
  "math",
  "xx-small",
  "x-small",
  "small",
  "medium",
  "large",
  "x-large",
  "xx-large",
  "xxx-large",
  "smaller",
  "larger",
];

function keyword(
  cssProperty: string,
  values: readonly string[],
  maxParts = 1,
  soloValues: readonly string[] = []
): KeywordLeaf {
  return {
    kind: "keyword",
    cssProperty,
    tokenKinds: [],
    values,
    maxParts,
    soloValues,
  };
}

function color(cssProperty: string, descendant?: string): ColorLeaf {
  return { kind: "color", cssProperty, tokenKinds: ["color"], descendant };
}

function cssValue(
  cssProperty: string,
  tokenKinds: readonly TokenKind[] = []
): CssValueLeaf {
  return { kind: "cssValue", cssProperty, tokenKinds };
}

function numberValue(
  cssProperty: string,
  bounds: { min?: number; max?: number; integer?: boolean } = {},
  tokenKinds: readonly TokenKind[] = ["number"]
): NumberLeaf {
  return { kind: "number", cssProperty, tokenKinds, ...bounds };
}

function url(cssProperty: string, keywords: readonly string[] = []): UrlLeaf {
  return { kind: "url", cssProperty, tokenKinds: [], keywords };
}

/**
 * The four logical box sides of a CSS property family, e.g. `margin` yields
 * `margin-block-start` … `margin-inline-end`, and `("border", "width")` yields
 * `border-block-start-width` … `border-inline-end-width`.
 */
function logicalSides(
  prefix: string,
  suffix: string | undefined,
  options: DimensionOptions = {}
): LogicalSidesShape {
  const name = (side: string): string =>
    suffix ? `${prefix}-${side}-${suffix}` : `${prefix}-${side}`;
  return {
    kind: "logicalSides",
    sides: {
      blockStart: dimension(name("block-start"), options),
      blockEnd: dimension(name("block-end"), options),
      inlineStart: dimension(name("inline-start"), options),
      inlineEnd: dimension(name("inline-end"), options),
    },
  };
}

/** The four logical corners of `border-radius`. */
function logicalCorners(): LogicalCornersShape {
  // Each corner property takes a horizontal and a vertical radius, which is how
  // an elliptical corner is written; one value makes them equal.
  const corner = (cssProperty: string) =>
    dimension(cssProperty, { allowPercentage: true, maxParts: 2 });
  return {
    kind: "logicalCorners",
    corners: {
      startStart: corner("border-start-start-radius"),
      startEnd: corner("border-start-end-radius"),
      endStart: corner("border-end-start-radius"),
      endEnd: corner("border-end-end-radius"),
    },
  };
}

// --- The catalog ------------------------------------------------------------

/**
 * Every legal style property, in group order. The `flag` field, where present,
 * is the `supports` sub-flag that enables the property on its own: a block
 * declaring `supports: { border: { radius: true } }` may set `borderRadius` and
 * nothing else in the border group, while `supports: { border: true }` enables
 * the whole group. Properties with no flag are only reachable through `true`.
 */
export const STYLE_CATALOG: readonly StyleProperty[] = [
  // --- spacing
  {
    property: "margin",
    group: "spacing",
    flag: "margin",
    shape: logicalSides("margin", undefined, {
      keywords: ["auto"],
      allowNegative: true,
      allowPercentage: true,
    }),
    summary: "Space outside the element, per logical side.",
  },
  {
    property: "padding",
    group: "spacing",
    flag: "padding",
    shape: logicalSides("padding", undefined, { allowPercentage: true }),
    summary: "Space inside the element, per logical side.",
  },

  // --- layout
  {
    property: "display",
    group: "layout",
    shape: keyword("display", [
      "block",
      "flex",
      "grid",
      "inline",
      "inline-block",
      "inline-flex",
      "inline-grid",
      "flow-root",
      "contents",
      "none",
      // A marker box, and the table modes: native table layout has no other
      // expression, and `display` has no free-form variant to fall back on.
      // The multi-keyword forms generate a different OUTER display type, so an
      // inline list item is not reachable through the legacy keyword.
      ...unorderedCombinations([
        ["inline", "block"],
        ["flow", "flow-root"],
        ["list-item"],
      ]).filter(entry => entry.includes("list-item")),
      "table",
      "inline-table",
      "table-row-group",
      "table-header-group",
      "table-footer-group",
      "table-row",
      "table-cell",
      "table-column-group",
      "table-column",
      "table-caption",
      // Ruby annotation roles, which no other display mode reproduces.
      "ruby",
      // A ruby box that participates in layout as a block; the legacy keyword
      // is inline-level and cannot reproduce it.
      "block ruby",
      "ruby-base",
      "ruby-text",
      "ruby-base-container",
      "ruby-text-container",
    ]),
    summary: "How the element generates boxes for its children.",
  },
  {
    property: "flexDirection",
    group: "layout",
    shape: keyword("flex-direction", [
      "row",
      "row-reverse",
      "column",
      "column-reverse",
    ]),
    summary: "Main-axis direction of a flex container.",
  },
  {
    property: "flexWrap",
    group: "layout",
    shape: keyword("flex-wrap", ["nowrap", "wrap", "wrap-reverse"]),
    summary: "Whether flex children wrap onto more lines.",
  },
  {
    property: "justifyContent",
    group: "layout",
    shape: keyword("justify-content", [
      "normal",
      ...CONTENT_DISTRIBUTION,
      // Flex-relative rather than physical: these resolve against
      // `flex-direction` and flip with it, which `left` and `right` do not.
      ...withOverflowSafety(CONTENT_POSITIONS),
    ]),
    summary: "Main-axis distribution. Logical by nature: start, never left.",
  },
  {
    property: "alignItems",
    group: "layout",
    shape: keyword("align-items", [
      "normal",
      "stretch",
      ...BASELINE_POSITIONS,
      // A standalone alternative in the grammar rather than a self position,
      // so it takes no overflow-safety keyword: `safe anchor-center` is not a
      // value. It aligns to the centre of the element's anchor, which no other
      // position reproduces.
      "anchor-center",
      ...withOverflowSafety(SELF_POSITIONS),
    ]),
    summary: "Cross-axis alignment of children.",
  },
  {
    property: "alignContent",
    group: "layout",
    shape: keyword("align-content", [
      "normal",
      ...BASELINE_POSITIONS,
      ...CONTENT_DISTRIBUTION,
      ...withOverflowSafety(CONTENT_POSITIONS),
    ]),
    summary: "Cross-axis distribution of wrapped lines.",
  },
  {
    property: "gap",
    group: "layout",
    shape: dimension("gap", {
      keywords: ["normal"],
      maxParts: 2,
      allowPercentage: true,
    }),
    summary: "Space between rows and columns.",
  },
  {
    property: "rowGap",
    group: "layout",
    shape: dimension("row-gap", {
      keywords: ["normal"],
      allowPercentage: true,
    }),
    summary: "Space between rows.",
  },
  {
    property: "columnGap",
    group: "layout",
    shape: dimension("column-gap", {
      keywords: ["normal"],
      allowPercentage: true,
    }),
    summary: "Space between columns.",
  },
  {
    property: "gridTemplateColumns",
    group: "layout",
    shape: cssValue("grid-template-columns"),
    summary: "Grid column track sizes.",
  },
  {
    property: "gridTemplateRows",
    group: "layout",
    shape: cssValue("grid-template-rows"),
    summary: "Grid row track sizes.",
  },
  {
    property: "gridAutoFlow",
    group: "layout",
    shape: keyword("grid-auto-flow", [
      "row",
      "column",
      "dense",
      "row dense",
      "column dense",
      // The grammar is unordered, so a serialisation stricter than CSS would
      // refuse a value the browser accepts.
      "dense row",
      "dense column",
    ]),
    summary: "How auto-placed grid items are inserted.",
  },

  // --- dimensions (physical on purpose: size is direction-neutral)
  {
    property: "width",
    group: "dimensions",
    shape: dimension("width", {
      keywords: SIZING_KEYWORDS,
      functions: SIZING_FUNCTIONS,
      allowPercentage: true,
    }),
    summary: "Element width.",
  },
  {
    property: "height",
    group: "dimensions",
    shape: dimension("height", {
      keywords: SIZING_KEYWORDS,
      functions: SIZING_FUNCTIONS,
      allowPercentage: true,
    }),
    summary: "Element height.",
  },
  {
    property: "minWidth",
    group: "dimensions",
    shape: dimension("min-width", {
      keywords: SIZING_KEYWORDS,
      functions: SIZING_FUNCTIONS,
      allowPercentage: true,
    }),
    summary: "Lower bound on width.",
  },
  {
    property: "minHeight",
    group: "dimensions",
    shape: dimension("min-height", {
      keywords: SIZING_KEYWORDS,
      functions: SIZING_FUNCTIONS,
      allowPercentage: true,
    }),
    summary: "Lower bound on height.",
  },
  {
    property: "maxWidth",
    group: "dimensions",
    shape: dimension("max-width", {
      keywords: MAX_SIZING_KEYWORDS,
      functions: SIZING_FUNCTIONS,
      allowPercentage: true,
    }),
    summary: "Upper bound on width.",
  },
  {
    property: "maxHeight",
    group: "dimensions",
    shape: dimension("max-height", {
      keywords: MAX_SIZING_KEYWORDS,
      functions: SIZING_FUNCTIONS,
      allowPercentage: true,
    }),
    summary: "Upper bound on height.",
  },
  {
    property: "aspectRatio",
    group: "dimensions",
    shape: cssValue("aspect-ratio"),
    summary: "Preferred width-to-height ratio.",
  },
  {
    property: "objectFit",
    group: "dimensions",
    shape: keyword("object-fit", [
      "fill",
      "contain",
      "cover",
      "none",
      "scale-down",
    ]),
    summary: "How replaced content fills its box.",
  },
  {
    property: "overflow",
    group: "dimensions",
    shape: keyword(
      "overflow",
      ["visible", "hidden", "clip", "scroll", "auto"],
      2
    ),
    summary: "How content exceeding the box is handled.",
  },

  // --- typography
  {
    property: "fontFamily",
    group: "typography",
    shape: cssValue("font-family", ["fontFamily"]),
    summary: "Typeface stack. Token-first: reference a typography token.",
    inherits: true,
  },
  {
    property: "fontSize",
    group: "typography",
    shape: dimension("font-size", {
      keywords: FONT_SIZE_KEYWORDS,
      allowPercentage: true,
    }),
    summary: "Text size.",
    inherits: true,
  },
  {
    property: "fontWeight",
    group: "typography",
    shape: {
      kind: "union",
      of: [
        keyword("font-weight", ["normal", "bold", "lighter", "bolder"]),
        numberValue("font-weight", { min: 1, max: 1000 }, [
          "fontWeight",
          "number",
        ]),
      ],
    },
    summary: "Text weight, as a keyword or a numeric weight.",
    inherits: true,
  },
  {
    property: "lineHeight",
    group: "typography",
    shape: {
      kind: "union",
      of: [
        numberValue("line-height", { min: 0 }),
        dimension("line-height", {
          keywords: ["normal"],
          allowPercentage: true,
          // The number leaf takes a stored number; a number written as an
          // expression arrives as a string and reaches this leaf instead, and
          // `line-height: calc(2)` is a value the browser honours.
          allowNumber: true,
        }),
      ],
    },
    summary: "Line box height, unitless (preferred) or as a length.",
    inherits: true,
  },
  {
    property: "letterSpacing",
    group: "typography",
    shape: dimension("letter-spacing", {
      keywords: ["normal"],
      allowNegative: true,
    }),
    summary: "Space between characters.",
    inherits: true,
  },
  {
    property: "wordSpacing",
    group: "typography",
    shape: dimension("word-spacing", {
      keywords: ["normal"],
      allowNegative: true,
      allowPercentage: true,
    }),
    summary: "Space between words.",
    inherits: true,
  },
  {
    property: "textAlign",
    group: "typography",
    shape: keyword("text-align", [
      // Resolves against the PARENT's direction, which neither `start` nor
      // `inherit` reproduces when parent and child directions differ.
      "match-parent",
      // Justifies the last line too, which `justify` leaves alone and no other
      // property here can reach.
      "justify-all",
      "start",
      "center",
      "end",
      "justify",
    ]),
    summary: "Inline alignment. Logical: start flips with writing direction.",
    inherits: true,
  },
  {
    property: "textTransform",
    group: "typography",
    // A case transform, a full-width transform and a kana transform compose in
    // any order; only the case transforms are mutually exclusive, which falls
    // out of each combination taking at most one of them.
    shape: keyword("text-transform", [
      "none",
      // Its own value: MathML italicises single letters through it, and it
      // combines with none of the case or width transforms.
      "math-auto",
      ...unorderedCombinations([
        ["uppercase", "lowercase", "capitalize"],
        ["full-width"],
        ["full-size-kana"],
      ]),
    ]),
    summary: "Letter-case transformation.",
    inherits: true,
  },
  {
    property: "fontStyle",
    group: "typography",
    // `oblique` takes an optional angle, which no closed keyword set can
    // express; the vocabulary stays for an editor to offer, and the free-form
    // variant is what makes `oblique 10deg` storable.
    shape: {
      kind: "union",
      of: [
        keyword("font-style", ["normal", "italic", "oblique"]),
        cssValue("font-style"),
      ],
    },
    summary: "Upright or slanted text, with an optional oblique angle.",
    inherits: true,
  },
  {
    property: "textDecoration",
    group: "typography",
    shape: cssValue("text-decoration"),
    summary: "Underline, overline, or line-through decoration.",
  },
  {
    property: "textShadow",
    group: "typography",
    shape: cssValue("text-shadow", ["shadow"]),
    summary: "Shadow cast by the text.",
    inherits: true,
  },

  // --- color
  {
    property: "color",
    group: "color",
    flag: "text",
    shape: color("color"),
    summary: "Text color.",
    inherits: true,
  },
  {
    property: "linkColor",
    group: "color",
    flag: "link",
    shape: color("color", "a"),
    summary: "Color of links inside the element.",
    inherits: true,
  },
  {
    property: "linkColorHover",
    group: "color",
    flag: "link",
    shape: color("color", "a:hover"),
    summary: "Color of hovered links inside the element.",
    inherits: true,
  },

  // --- background
  {
    property: "backgroundColor",
    group: "background",
    flag: "color",
    shape: color("background-color"),
    summary: "Background fill color.",
  },
  {
    property: "background",
    group: "background",
    flag: "image",
    shape: {
      kind: "object",
      fields: {
        // `none` is what clears an image set at an earlier state, and it has
        // to be a keyword rather than a path or it emits `url("none")`. A file
        // really named `none` is still reachable as `./none`.
        url: url("background-image", ["none"]),
        position: cssValue("background-position"),
        size: cssValue("background-size"),
        // `repeat-x` and `repeat-y` each name both axes already, so they are
        // the whole value; the other four pair up as inline-then-block.
        repeat: keyword(
          "background-repeat",
          ["repeat", "repeat-x", "repeat-y", "no-repeat", "space", "round"],
          2,
          ["repeat-x", "repeat-y"]
        ),
        attachment: keyword("background-attachment", [
          "scroll",
          "fixed",
          "local",
        ]),
      },
    },
    summary: "Background image and how it is placed.",
  },
  {
    property: "backgroundGradient",
    group: "background",
    flag: "gradient",
    shape: cssValue("background-image"),
    summary: "Gradient fill, as a CSS gradient value.",
  },

  // --- border
  {
    property: "border",
    group: "border",
    flag: "line",
    shape: {
      kind: "object",
      fields: {
        width: logicalSides("border", "width", {
          keywords: ["thin", "medium", "thick"],
        }),
        style: keyword("border-style", [
          "none",
          // Distinct from `none` where borders compete: under collapsed-table
          // conflict resolution `hidden` suppresses the neighbouring border.
          "hidden",
          "solid",
          "dashed",
          "dotted",
          "double",
          "groove",
          "ridge",
          "inset",
          "outset",
        ]),
        color: color("border-color"),
      },
    },
    summary: "Border width per logical side, plus style and color.",
  },
  {
    property: "borderRadius",
    group: "border",
    flag: "radius",
    shape: {
      kind: "union",
      of: [
        dimension("border-radius", { allowPercentage: true }),
        logicalCorners(),
      ],
    },
    summary:
      "Corner rounding: one radius for all corners, or per logical corner.",
  },

  // --- shadow
  {
    property: "boxShadow",
    group: "shadow",
    shape: cssValue("box-shadow", ["shadow"]),
    summary: "Shadow cast by the element's box.",
  },

  // --- effects
  {
    property: "opacity",
    group: "effects",
    shape: numberValue("opacity", { min: 0, max: 1 }),
    summary: "Element opacity, 0 to 1.",
  },
  {
    property: "filter",
    group: "effects",
    shape: cssValue("filter"),
    summary: "Graphical effects such as blur or brightness.",
  },
  {
    property: "mixBlendMode",
    group: "effects",
    shape: keyword("mix-blend-mode", [
      "normal",
      "multiply",
      "screen",
      "overlay",
      "darken",
      "lighten",
      "color-dodge",
      "color-burn",
      "hard-light",
      "soft-light",
      "difference",
      "exclusion",
      "hue",
      "saturation",
      "color",
      "luminosity",
      "plus-darker",
      "plus-lighter",
    ]),
    summary: "How the element blends with what is behind it.",
  },
  {
    property: "transform",
    group: "effects",
    shape: cssValue("transform"),
    summary: "Geometric transforms such as translate, scale, or rotate.",
  },
  {
    property: "transition",
    group: "effects",
    shape: cssValue("transition", ["custom", "duration"]),
    summary: "Explicit transitions. Nothing is smoothed automatically.",
  },

  // --- position
  {
    property: "position",
    group: "position",
    shape: {
      kind: "object",
      fields: {
        type: keyword("position", [
          "static",
          "relative",
          "absolute",
          "fixed",
          "sticky",
        ]),
        inset: logicalSides("inset", undefined, {
          keywords: ["auto"],
          allowNegative: true,
          allowPercentage: true,
          functions: ["anchor"],
        }),
        zIndex: {
          kind: "union",
          of: [
            numberValue("z-index", { integer: true }),
            keyword("z-index", ["auto"]),
          ],
        },
      },
    },
    summary: "Positioning scheme, logical offsets, and stacking order.",
  },

  // --- container
  {
    property: "containerType",
    group: "container",
    // A scroll-state container answers a different kind of query from a size
    // one, and the two combine in either order.
    shape: keyword("container-type", [
      "normal",
      ...unorderedCombinations([["inline-size", "size"], ["scroll-state"]]),
    ]),
    summary: "Opt the element in as a query container for its descendants.",
  },
];

// --- Lookups ----------------------------------------------------------------

const CATALOG_BY_PROPERTY: ReadonlyMap<string, StyleProperty> = new Map(
  STYLE_CATALOG.map(entry => [entry.property, entry])
);

/** The catalog row for a storage key, or `undefined` if it is not a style property. */
export function getStyleProperty(property: string): StyleProperty | undefined {
  return CATALOG_BY_PROPERTY.get(property);
}

/**
 * The CSS properties one stored field of a value can turn into.
 *
 * A composite is stored as a record and emitted as separate declarations, so asking whether the
 * compiler wrote a particular FIELD means asking which declarations that field is responsible
 * for. `padding.blockEnd` answers `padding-block-end`; a field that is itself composite answers
 * every leaf beneath it.
 *
 * An empty answer means the path names nothing this catalog defines, which a caller should read
 * as "no claim", not as "emitted nothing" — persisted data reaches here unvalidated.
 */
/**
 * The shape stored under one field of a composite, across whichever branch defines it.
 *
 * A union stores one branch at a time, so a field belongs to whichever of them has it.
 */
function fieldShape(shape: StyleShape, key: string): StyleShape | undefined {
  for (const branch of shape.kind === "union" ? shape.of : [shape]) {
    const fields =
      branch.kind === "logicalSides"
        ? branch.sides
        : branch.kind === "logicalCorners"
          ? branch.corners
          : branch.kind === "object"
            ? branch.fields
            : undefined;
    if (fields === undefined) continue;
    // Read through `entries` rather than by index: the side and corner records are declared with
    // their exact keys, so a lookup by an arbitrary string is not something the types can answer,
    // and persisted data is where these keys come from.
    const found = Object.entries(fields).find(([name]) => name === key)?.[1];
    if (found !== undefined) return found;
  }
  return undefined;
}

export function cssPropertiesForField(
  property: string,
  path: readonly string[]
): readonly string[] {
  let shape = CATALOG_BY_PROPERTY.get(property)?.shape;
  for (const key of path) {
    if (shape === undefined) return [];
    shape = fieldShape(shape, key);
  }
  if (shape === undefined) return [];
  return shapeLeaves(shape).map(leaf => leaf.cssProperty);
}

/** The descendant selector a property's declarations attach to, if any. */
function descendantOf(entry: StyleProperty | undefined): string | undefined {
  if (entry === undefined) return undefined;
  for (const leaf of shapeLeaves(entry.shape)) {
    if ("descendant" in leaf && typeof leaf.descendant === "string") {
      return leaf.descendant;
    }
  }
  return undefined;
}

/**
 * How many pseudo-classes a property's selector carries, which is what it adds to specificity.
 *
 * `linkColorHover` attaches to `a:hover` and `linkColor` to `a`, so the first outranks the second
 * by one class-worth wherever both are written on the same element. Counted rather than assumed,
 * because it is the difference that decides which of two matching rules the browser uses.
 */
/**
 * Whether a property writes to something INSIDE the block rather than to the block itself.
 *
 * The distinction decides which cascade applies. A descendant rule from an ancestor lands on this
 * node's own links, competing with this node's rules at equal specificity; an inherited value
 * merely arrives when nothing here declares one, and loses to anything that does. Treating the
 * first as the second reports the wrong colour for a link inside a styled parent.
 */
export function propertyUsesDescendantSelector(property: string): boolean {
  return descendantOf(CATALOG_BY_PROPERTY.get(property)) !== undefined;
}

/**
 * The descendant selector a property emits under, if any.
 *
 * Needed to tell two catalog keys apart when they write the same CSS property: `color` lands on
 * the element and `linkColor` lands on `a` inside it, so a declaration is only evidence that a
 * key was written if the selector matches too.
 */
export function propertyDescendantSelector(
  property: string
): string | undefined {
  return descendantOf(CATALOG_BY_PROPERTY.get(property));
}

export function propertyPseudoClassCount(property: string): number {
  const descendant = descendantOf(CATALOG_BY_PROPERTY.get(property));
  if (descendant === undefined) return 0;
  return descendant.split(":").length - 1;
}

/**
 * The properties whose declarations also land on what this property's declarations land on.
 *
 * `linkColor` writes `… a` and `linkColorHover` writes `… a:hover`, so a hovered link matches
 * BOTH, and asking only about the hover property reports a value a later `linkColor` rule
 * overrides. Same shape as a state joining the base rules rather than replacing them, one level
 * out: two properties, one element.
 *
 * Derived from the catalog rather than listed, so a property added with a `a:focus` selector is
 * related to `linkColor` without anything here being edited. Returned least specific first, which
 * is the order they have to be read in.
 */
/**
 * The longhands a CSS shorthand sets, for the shorthands this catalog can emit.
 *
 * A shorthand and its longhands compete without sharing a property NAME: `gap` writes both
 * `row-gap` and `column-gap`, so a class setting `gap` and a node setting `rowGap` both reach the
 * same element and matching on the name alone sees neither. Everything else here is emitted as
 * logical longhands already, which is why the table is this short.
 */
const SHORTHAND_LONGHANDS: Readonly<Record<string, readonly string[]>> = {
  gap: ["row-gap", "column-gap"],
};

/** A CSS property and everything it sets, so two keys can be compared by what they overwrite. */
export function declarationsCovered(cssProperty: string): readonly string[] {
  const longhands = SHORTHAND_LONGHANDS[cssProperty];
  return longhands === undefined ? [cssProperty] : [cssProperty, ...longhands];
}

/**
 * Every CSS declaration a property can write, shorthands expanded.
 *
 * Comparing two catalog keys by what they OVERWRITE rather than by the key they are written under
 * is the only test that holds: `gap` and `columnGap` share no property name and compete anyway,
 * while `background.position` and `backgroundGradient` share the `background-` prefix and do not.
 */
export function declarationsWritten(property: string): readonly string[] {
  const covered = new Set<string>();
  for (const css of cssPropertiesForField(property, [])) {
    for (const name of declarationsCovered(css)) covered.add(name);
  }
  return [...covered];
}

export function propertiesAlsoMatching(property: string): readonly string[] {
  const entry = CATALOG_BY_PROPERTY.get(property);
  if (entry === undefined) return [];
  const descendant = descendantOf(entry);
  const emits = new Set(declarationsWritten(property));
  const related: string[] = [];
  for (const other of STYLE_CATALOG) {
    if (other.property === property) continue;
    // Sharing a CSS property is the whole test. Two keys that write `background-image` compete
    // whether or not either uses a descendant selector, and the earlier version asked only about
    // descendants — so `background` and `backgroundGradient`, which are exactly this case, were
    // resolved as though they could not overwrite each other.
    // Overlap in what they WRITE, not in what they are called. `gap` against `columnGap` shares
    // no name and overwrites it; `background` against `backgroundGradient` shares a prefix and
    // only collides on `background-image`.
    if (!declarationsWritten(other.property).some(css => emits.has(css))) {
      continue;
    }
    const otherDescendant = descendantOf(other);
    // A rule can only be read alongside this one if it lands on the same elements. Same selector,
    // or this property's selector with its pseudo-classes stripped off — `a` against `a:hover`.
    // A descendant rule and a plain one style different elements and never compete.
    if (otherDescendant === descendant) related.push(other.property);
    else if (
      descendant !== undefined &&
      otherDescendant !== undefined &&
      descendant.startsWith(`${otherDescendant}:`)
    ) {
      related.push(other.property);
    }
  }
  return related.sort(
    (a, b) => propertyPseudoClassCount(a) - propertyPseudoClassCount(b)
  );
}

/**
 * The field names a composite value carries at a path, across every branch that defines them.
 *
 * Used to expand a shorthand: a lower tier storing `borderRadius: "4px"` sets all four corners,
 * and a higher tier storing one corner overrides only that one — so the shorthand has to become
 * the four fields it stood for before the record folds over it, or the corners it is still
 * painting are reported as coming from nowhere.
 */
export function compositeFieldNames(
  property: string,
  path: readonly string[] = []
): readonly string[] {
  let shape = CATALOG_BY_PROPERTY.get(property)?.shape;
  for (const key of path) {
    if (shape === undefined) return [];
    shape = fieldShape(shape, key);
  }
  if (shape === undefined) return [];
  const names: string[] = [];
  for (const branch of shape.kind === "union" ? shape.of : [shape]) {
    const fields =
      branch.kind === "logicalSides"
        ? branch.sides
        : branch.kind === "logicalCorners"
          ? branch.corners
          : branch.kind === "object"
            ? branch.fields
            : undefined;
    if (fields === undefined) continue;
    for (const name of Object.keys(fields)) {
      if (!names.includes(name)) names.push(name);
    }
  }
  return names;
}

/**
 * Whether a value set on an ancestor visibly reaches a descendant that states nothing.
 *
 * Asked by provenance, so a control can report the page's own typography as the origin of the
 * text it is looking at, and can decline to report it for a property that never travels. An
 * unknown key answers false: nothing is written for it, so nothing reaches anywhere.
 */
export function propertyInheritsToDescendants(property: string): boolean {
  return CATALOG_BY_PROPERTY.get(property)?.inherits === true;
}

/** Every catalog row in one group, in catalog order. */
export function stylePropertiesInGroup(
  group: StyleGroup
): readonly StyleProperty[] {
  return STYLE_CATALOG.filter(entry => entry.group === group);
}

/** The sub-flags a group defines, derived from the properties that declare them. */
export function styleFlagsInGroup(group: StyleGroup): readonly string[] {
  const flags: string[] = [];
  for (const entry of stylePropertiesInGroup(group)) {
    if (entry.flag !== undefined && !flags.includes(entry.flag)) {
      flags.push(entry.flag);
    }
  }
  return flags;
}
