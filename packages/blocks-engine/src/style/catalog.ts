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
  };
}

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
];
const MAX_SIZING_KEYWORDS = [
  "none",
  "min-content",
  "max-content",
  "fit-content",
  "stretch",
];
const FONT_SIZE_KEYWORDS = [
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
  return {
    kind: "logicalCorners",
    corners: {
      startStart: dimension("border-start-start-radius", {
        allowPercentage: true,
      }),
      startEnd: dimension("border-start-end-radius", {
        allowPercentage: true,
      }),
      endStart: dimension("border-end-start-radius", {
        allowPercentage: true,
      }),
      endEnd: dimension("border-end-end-radius", {
        allowPercentage: true,
      }),
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
      "start",
      "center",
      "end",
      "space-between",
      "space-around",
      "space-evenly",
      "stretch",
    ]),
    summary: "Main-axis distribution. Logical by nature: start, never left.",
  },
  {
    property: "alignItems",
    group: "layout",
    shape: keyword("align-items", [
      "start",
      "center",
      "end",
      "stretch",
      "baseline",
    ]),
    summary: "Cross-axis alignment of children.",
  },
  {
    property: "alignContent",
    group: "layout",
    shape: keyword("align-content", [
      "start",
      "center",
      "end",
      "space-between",
      "space-around",
      "space-evenly",
      "stretch",
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
    shape: keyword("text-align", ["start", "center", "end", "justify"]),
    summary: "Inline alignment. Logical: start flips with writing direction.",
  },
  {
    property: "textTransform",
    group: "typography",
    shape: keyword("text-transform", [
      "none",
      "uppercase",
      "lowercase",
      "capitalize",
    ]),
    summary: "Letter-case transformation.",
  },
  {
    property: "fontStyle",
    group: "typography",
    shape: keyword("font-style", ["normal", "italic", "oblique"]),
    summary: "Upright or slanted text.",
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
    shape: keyword("container-type", ["normal", "inline-size", "size"]),
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
