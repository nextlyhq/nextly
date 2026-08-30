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
  TokenKind,
  UrlLeaf,
} from "./catalog-types";

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
  },
  {
    property: "fontSize",
    group: "typography",
    shape: dimension("font-size", {
      keywords: FONT_SIZE_KEYWORDS,
      allowPercentage: true,
    }),
    summary: "Text size.",
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
  },
  {
    property: "letterSpacing",
    group: "typography",
    shape: dimension("letter-spacing", {
      keywords: ["normal"],
      allowNegative: true,
    }),
    summary: "Space between characters.",
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
  },
  {
    property: "listStyleType",
    group: "typography",
    // `revert` earns its place beside the concrete markers. A CSS reset that
    // sets `list-style: none` on every list — Tailwind's Preflight does, and
    // this library's own scaffold imports it — leaves an author no keyword that
    // means "whatever this element would have shown", because the right answer
    // differs between `ul` and `ol`. `revert` rolls back to the user-agent
    // value per element, so one declaration restores discs to one and numerals
    // to the other.
    shape: keyword("list-style-type", [
      "none",
      "revert",
      "disc",
      "circle",
      "square",
      "decimal",
      "decimal-leading-zero",
      "lower-alpha",
      "upper-alpha",
      "lower-roman",
      "upper-roman",
    ]),
    summary: "The marker drawn beside each list item.",
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
  },

  // --- color
  {
    property: "color",
    group: "color",
    flag: "text",
    shape: color("color"),
    summary: "Text color.",
  },
  {
    property: "linkColor",
    group: "color",
    flag: "link",
    shape: color("color", "a"),
    summary: "Color of links inside the element.",
  },
  {
    property: "linkColorHover",
    group: "color",
    flag: "link",
    shape: color("color", "a:hover"),
    summary: "Color of hovered links inside the element.",
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
 * Every catalog row, ordered by property name, computed once.
 *
 * What the emitter walks, instead of the keys of the map it is compiling. The two produce the
 * same declarations in the same order, because a stored key this catalog does not define writes
 * nothing either way — but one is bounded by the catalog and the other by whatever was persisted,
 * and a named class is site settings, outside the document byte cap and read on every page
 * render.
 *
 * Sorted rather than left in catalog order so that adding a property to the table cannot silently
 * reorder the declarations an existing page emits.
 */
export const CATALOG_IN_EMISSION_ORDER: readonly StyleProperty[] = [
  ...STYLE_CATALOG,
].sort((a, b) =>
  a.property < b.property ? -1 : a.property > b.property ? 1 : 0
);

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
