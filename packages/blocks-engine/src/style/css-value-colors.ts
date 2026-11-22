/**
 * Whether a value is a colour: the keywords, hex forms, system colours and
 * colour functions a colour may use.
 *
 * @module style/css-value-colors
 */
import { checkCssValue } from "./css-value-check";
import {
  decodeIdentifier,
  identifierOf,
  parseValue,
  referenceNamesSomething,
} from "./css-value-syntax";
import type { CssValueRejection } from "./css-value-vocabulary";

/**
 * Colour keywords: the CSS named colours, which are a closed set, plus the
 * keywords that stand in for one.
 */
const COLOR_KEYWORDS: ReadonlySet<string> = new Set(
  `transparent currentcolor inherit initial unset revert revert-layer
   aliceblue antiquewhite aqua aquamarine azure beige bisque black
   blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse
   chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan
   darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta
   darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen
   darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink
   deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen
   fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey
   honeydew hotpink indianred indigo ivory khaki lavender lavenderblush
   lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow
   lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen
   lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime
   limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid
   mediumpurple mediumseagreen mediumslateblue mediumspringgreen
   mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin
   navajowhite navy oldlace olive olivedrab orange orangered orchid
   palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff
   peru pink plum powderblue purple rebeccapurple red rosybrown royalblue
   saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue
   slateblue slategray slategrey snow springgreen steelblue tan teal thistle
   tomato turquoise violet wheat white whitesmoke yellow yellowgreen`.split(
    /\s+/
  )
);

/** A hex colour: three, four, six, or eight hexadecimal digits after the `#`. */
const HEX_COLOR = /^(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * System colours, which resolve to the platform's own palette. They matter more
 * than their rarity suggests: forced-colors mode and high-contrast themes are
 * expressed with them, so refusing them would refuse the accessible option.
 */
const SYSTEM_COLORS: ReadonlySet<string> = new Set(
  `accentcolor accentcolortext activetext buttonborder buttonface buttontext
   canvas canvastext field fieldtext graytext highlight highlighttext linktext
   mark marktext selecteditem selecteditemtext visitedtext`.split(/\s+/)
);

/** Functions that produce a colour. */
const COLOR_FUNCTIONS: ReadonlySet<string> = new Set([
  "rgb",
  "rgba",
  "hsl",
  "hsla",
  "hwb",
  "lab",
  "lch",
  "oklab",
  "oklch",
  "color",
  "color-mix",
  "light-dark",
  "contrast-color",
  "device-cmyk",
  "var",
  "env",
]);

/**
 * Check a value for a property that takes a colour. Everything
 * `checkCssValue` checks, plus the requirement that what was written is a
 * colour: `"16px"` and `"rotate(2deg)"` are valid CSS values that a browser
 * discards when given as a colour.
 *
 * Which colour a function actually produces is not checked — the argument
 * grammar of `oklch()` and friends moves faster than any data available here,
 * and that is the same reason grammar matching is not used anywhere in this
 * module.
 */
// RELOCATED, not written here — see the docblock of `css-value.ts`.
// fallow-ignore-next-line complexity
export function checkColorValue(value: string): CssValueRejection | null {
  const rejection = checkCssValue(value);
  if (rejection !== null) return rejection;
  const ast = parseValue(value);
  if (ast === null || ast.type !== "Value") return "not-a-color";
  // A colour is exactly one term. No colour syntax takes an operator at this
  // level — the commas and slashes inside `rgb()` and `color-mix()` sit within
  // the function — so an operator here means the browser discards the whole
  // declaration, as it does for `red,` and `/ red`. Counting every child rather
  // than filtering the operators out is what makes that refusal happen.
  const parts = [...ast.children];
  const node = parts[0];
  if (parts.length !== 1 || node === undefined) return "not-a-color";
  switch (node.type) {
    // A hex literal. The parser accepts any token after `#`, so the digits and
    // the length are checked here rather than assumed.
    case "Hash":
      // The digits carry escapes as any identifier does, so `#\66 ff` is the
      // colour `#fff` and comparing the raw spelling refuses it.
      return HEX_COLOR.test(decodeIdentifier(node.value))
        ? null
        : "not-a-color";
    case "Identifier": {
      const name = identifierOf(node);
      return COLOR_KEYWORDS.has(name) || SYSTEM_COLORS.has(name)
        ? null
        : "not-a-color";
    }
    case "Function": {
      const name = identifierOf(node);
      if (!COLOR_FUNCTIONS.has(name)) return "not-a-color";
      // A reference is allowlisted for what it may resolve to, not for the name
      // alone: it still has to name something to resolve.
      if (name === "var" || name === "env") {
        return referenceNamesSomething(node) ? null : "not-a-color";
      }
      return null;
    }
    default:
      return "not-a-color";
  }
}
