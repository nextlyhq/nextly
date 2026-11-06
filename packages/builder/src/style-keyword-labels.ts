/**
 * The words a style keyword is offered in.
 *
 * The catalog's keywords are CSS spellings ("inline-flex", "no-repeat",
 * "scale-down"), and the panel printed them as they are. An author reads the
 * words here instead, in every menu, segmented choice and icon tooltip, and
 * the CSS spelling is kept for the tooltip of whoever wants it.
 *
 * ONE map, keyed by the CSS property and then the keyword, because a keyword's
 * meaning depends on its property: `none` is "Hidden" for `display` and "None"
 * for `border-style`. A keyword this map does not name falls back to the words
 * many properties share (`auto`, `normal`), and then to the keyword itself in
 * words, so a keyword the catalog gains later still reads as words.
 *
 * @module style-keyword-labels
 */
import {
  asciiLower,
  decodeIdentifier,
  DISCLOSURE_ICON_PROPERTY,
  DISCLOSURE_POSITION_PROPERTY,
  trimCssWhitespace,
} from "@nextlyhq/blocks-engine";

const SIZE_KEYWORDS: Readonly<Record<string, string>> = {
  auto: "Auto",
  none: "None",
  "min-content": "Shrink to content",
  "max-content": "Widest content",
  "fit-content": "Fit content",
  stretch: "Fill",
  contain: "Contain",
};

const KEYWORD_LABELS: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  display: {
    block: "Block",
    flex: "Flex",
    grid: "Grid",
    inline: "Inline",
    "inline-block": "Inline block",
    "inline-flex": "Inline flex",
    "inline-grid": "Inline grid",
    "flow-root": "Contain floats",
    contents: "Contents only",
    none: "Hidden",
    "list-item": "List item",
    table: "Table",
  },
  position: {
    static: "Normal flow",
    relative: "Relative",
    absolute: "Absolute",
    fixed: "Fixed to the window",
    sticky: "Sticky",
  },
  "box-sizing": {
    "content-box": "Content only",
    "border-box": "Include padding and border",
  },
  "flex-direction": {
    row: "Row",
    "row-reverse": "Row, reversed",
    column: "Column",
    "column-reverse": "Column, reversed",
  },
  "flex-wrap": {
    nowrap: "No wrap",
    wrap: "Wrap",
    "wrap-reverse": "Wrap, reversed",
  },
  "grid-auto-flow": {
    row: "Row",
    column: "Column",
    dense: "Fill gaps",
    "row dense": "Row, fill gaps",
    "dense row": "Row, fill gaps",
    "column dense": "Column, fill gaps",
    "dense column": "Column, fill gaps",
  },
  width: SIZE_KEYWORDS,
  height: SIZE_KEYWORDS,
  "min-width": SIZE_KEYWORDS,
  "min-height": SIZE_KEYWORDS,
  "max-width": SIZE_KEYWORDS,
  "max-height": SIZE_KEYWORDS,
  // Strikethrough is what an author calls a line through text.
  "text-decoration-line": {
    none: "None",
    underline: "Underline",
    "line-through": "Strikethrough",
    overline: "Overline",
  },
  "object-fit": {
    fill: "Stretch to fill",
    contain: "Fit inside",
    cover: "Cover",
    none: "Original size",
    "scale-down": "Shrink to fit",
  },
  overflow: {
    visible: "Visible",
    hidden: "Hidden",
    clip: "Clip",
    scroll: "Scroll",
    auto: "Scroll when needed",
  },
  "font-size": {
    "xx-small": "XX small",
    "x-small": "X small",
    small: "Small",
    medium: "Medium",
    large: "Large",
    "x-large": "X large",
    "xx-large": "XX large",
    "xxx-large": "XXX large",
    smaller: "Smaller",
    larger: "Larger",
    math: "Math",
  },
  "font-weight": {
    normal: "Normal",
    bold: "Bold",
    lighter: "Lighter",
    bolder: "Bolder",
  },
  "font-style": { normal: "Normal", italic: "Italic", oblique: "Oblique" },
  "text-align": {
    start: "Start",
    center: "Center",
    end: "End",
    justify: "Justify",
    "justify-all": "Justify every line",
    "match-parent": "Match the parent",
  },
  "text-transform": {
    none: "None",
    uppercase: "Uppercase",
    lowercase: "Lowercase",
    capitalize: "Capitalize words",
  },
  // An Accordion's icon choices, traced on their own custom properties.
  [DISCLOSURE_ICON_PROPERTY]: {
    chevron: "Chevron",
    plus: "Plus",
    none: "None",
    browser: "Browser default",
  },
  [DISCLOSURE_POSITION_PROPERTY]: {
    before: "Before",
    after: "After",
  },
  "list-style-type": {
    none: "None",
    revert: "Default",
    disc: "Bullet",
    circle: "Circle",
    square: "Square",
    decimal: "1, 2, 3",
    "decimal-leading-zero": "01, 02, 03",
    "lower-alpha": "a, b, c",
    "upper-alpha": "A, B, C",
    "lower-roman": "i, ii, iii",
    "upper-roman": "I, II, III",
  },
  "background-repeat": {
    repeat: "Tile",
    "repeat-x": "Tile across",
    "repeat-y": "Tile down",
    "no-repeat": "Don't repeat",
    space: "Tile with space",
    round: "Tile and stretch",
  },
  "background-attachment": {
    scroll: "Scroll with the page",
    fixed: "Fixed",
    local: "Scroll with the content",
  },
  "border-style": {
    none: "None",
    hidden: "Hidden",
    solid: "Solid",
    dashed: "Dashed",
    dotted: "Dotted",
    double: "Double",
    groove: "Groove",
    ridge: "Ridge",
    inset: "Inset",
    outset: "Outset",
  },
  "container-type": {
    normal: "None",
    "inline-size": "Width",
    size: "Width and height",
    "scroll-state": "Scroll state",
  },
};

/** Words many properties share for the same keyword. */
const SHARED_LABELS: Readonly<Record<string, string>> = {
  auto: "Auto",
  normal: "Default",
  none: "None",
};

/**
 * The words for one keyword of one CSS property: this property's own, else
 * the shared ones, else the keyword in words ("space-between" reads "Space
 * between"), so no keyword is ever shown in its CSS spelling.
 */
export function keywordLabel(cssProperty: string, keyword: string): string {
  // Looked up as CSS reads a keyword; only the lookup is folded, and the
  // stored value and its tooltip keep the spelling they were given.
  const folded = foldKeyword(keyword);
  return (
    KEYWORD_LABELS[cssProperty]?.[folded] ??
    SHARED_LABELS[folded] ??
    inWords(folded)
  );
}

/**
 * A keyword as CSS reads it: its escapes decoded, case-folded the ASCII way,
 * with its CSS whitespace trimmed and collapsed, since the validator stores
 * `INLINE-FLEX`, `inline\2d flex` and `row  dense` as the keywords they
 * spell. For comparing a stored value with the keywords a control offers.
 */
export function foldKeyword(keyword: string): string {
  return asciiLower(decodeIdentifier(trimCssWhitespace(keyword))).replace(
    /[ \t\n\r\f]+/g,
    " "
  );
}

/**
 * The keywords a menu offers, one item per choice.
 *
 * Two spellings of one value read the same in words (`row dense` and `dense
 * row`), and a menu holding both shows two items an author cannot tell apart,
 * the second recording an edit that changes nothing. So a menu keeps the
 * first spelling of each, or the stored one in its place. A stored keyword the
 * list lacks (`inherit`) is offered first, so the menu never shows empty over
 * a value that is doing something.
 */
export function menuKeywords(
  cssProperty: string,
  values: readonly string[],
  stored: string
): readonly string[] {
  const words = (keyword: string): string => keywordLabel(cssProperty, keyword);
  const storedWords = stored === "" ? undefined : words(stored);
  const placed = values.map(value =>
    storedWords !== undefined && words(value) === storedWords ? stored : value
  );
  const all =
    stored !== "" && !placed.includes(stored) ? [stored, ...placed] : placed;
  const seen = new Set<string>();
  return all.filter(keyword => {
    const said = words(keyword);
    if (seen.has(said)) return false;
    seen.add(said);
    return true;
  });
}

/** A CSS keyword as words: its hyphens as spaces, its first letter capital. */
function inWords(keyword: string): string {
  const words = keyword.replace(/-/g, " ").replace(/\s+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
