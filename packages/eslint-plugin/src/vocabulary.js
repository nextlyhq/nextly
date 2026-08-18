/**
 * The design-token vocabulary, defined once and consumed by every guard that
 * enforces it.
 *
 * Two mechanisms enforce this contract and they run in different places: the
 * ESLint rules in this package run wherever a plugin author lints (their editor,
 * their CI, and ours), while `scripts/lint-design.mjs` covers CSS and acts as the
 * repository-wide backstop. Both import this module, so the two can differ in
 * WHERE they run and never in WHAT they mean. A hue added to one and not the
 * other is the drift this file exists to make unrepresentable.
 */

/**
 * Tailwind's built-in palette hues.
 *
 * These ship with the framework whether or not `theme.css` redefines a given
 * hue, so a palette utility compiles even where no matching `--color-*` scale is
 * declared. That is why they need naming here rather than being derivable from
 * the token file: the token file is what they BYPASS.
 */
export const PALETTE_HUES = [
  "slate",
  "gray",
  "zinc",
  "neutral",
  "stone",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
];

/**
 * Shades, longest first.
 *
 * The order is load-bearing in the alternation: `50|\d{3}` matches the leading
 * `50` of `500` and lets the rest through, so a three-digit shade must be
 * offered before the two-digit one.
 */
export const PALETTE_SHADES = [
  "950",
  "900",
  "800",
  "700",
  "600",
  "500",
  "400",
  "300",
  "200",
  "100",
  "50",
];

/** Utility prefixes that take a colour. */
export const COLOR_UTILS = [
  "text",
  "bg",
  "border",
  "ring",
  "ring-offset",
  "from",
  "via",
  "to",
  "fill",
  "stroke",
  "shadow",
  "outline",
  "decoration",
  "accent",
  "caret",
  "divide",
  "placeholder",
];

/**
 * The semantic scale that replaced each hue.
 *
 * A hue is not a meaning: two hues stood in for "success" here and two for
 * "destructive", which is how they drift apart. Each scale derives from one
 * token, so a retheme moves the whole scale at once. Hues with no entry are
 * neutrals, which take `foreground` / `muted-foreground` / `border` instead.
 */
export const HUE_REPLACEMENT = {
  green: "success-*",
  emerald: "success-*",
  red: "destructive-*",
  rose: "destructive-*",
  amber: "warning-*",
  yellow: "warning-*",
  orange: "warning-*",
};

/**
 * CSS named colours, minus the mode-invariant ones.
 *
 * `black`, `white` and `transparent` are deliberately absent for the same
 * reason their hex spellings are exempt: they are the same colour in light and
 * dark, so routing them through a themed token would claim a variation that
 * does not exist. Every other name is a fixed colour that ignores the theme —
 * `deepskyblue` on a drop indicator was how this gap was found.
 */
export const CSS_NAMED_COLORS = [
  "aliceblue",
  "antiquewhite",
  "aqua",
  "aquamarine",
  "azure",
  "beige",
  "bisque",
  "blanchedalmond",
  "blue",
  "blueviolet",
  "brown",
  "burlywood",
  "cadetblue",
  "chartreuse",
  "chocolate",
  "coral",
  "cornflowerblue",
  "cornsilk",
  "crimson",
  "cyan",
  "darkblue",
  "darkcyan",
  "darkgoldenrod",
  "darkgray",
  "darkgreen",
  "darkgrey",
  "darkkhaki",
  "darkmagenta",
  "darkolivegreen",
  "darkorange",
  "darkorchid",
  "darkred",
  "darksalmon",
  "darkseagreen",
  "darkslateblue",
  "darkslategray",
  "darkslategrey",
  "darkturquoise",
  "darkviolet",
  "deeppink",
  "deepskyblue",
  "dimgray",
  "dimgrey",
  "dodgerblue",
  "firebrick",
  "floralwhite",
  "forestgreen",
  "fuchsia",
  "gainsboro",
  "ghostwhite",
  "gold",
  "goldenrod",
  "gray",
  "green",
  "greenyellow",
  "grey",
  "honeydew",
  "hotpink",
  "indianred",
  "indigo",
  "ivory",
  "khaki",
  "lavender",
  "lavenderblush",
  "lawngreen",
  "lemonchiffon",
  "lightblue",
  "lightcoral",
  "lightcyan",
  "lightgoldenrodyellow",
  "lightgray",
  "lightgreen",
  "lightgrey",
  "lightpink",
  "lightsalmon",
  "lightseagreen",
  "lightskyblue",
  "lightslategray",
  "lightslategrey",
  "lightsteelblue",
  "lightyellow",
  "lime",
  "limegreen",
  "linen",
  "magenta",
  "maroon",
  "mediumaquamarine",
  "mediumblue",
  "mediumorchid",
  "mediumpurple",
  "mediumseagreen",
  "mediumslateblue",
  "mediumspringgreen",
  "mediumturquoise",
  "mediumvioletred",
  "midnightblue",
  "mintcream",
  "mistyrose",
  "moccasin",
  "navajowhite",
  "navy",
  "oldlace",
  "olive",
  "olivedrab",
  "orange",
  "orangered",
  "orchid",
  "palegoldenrod",
  "palegreen",
  "paleturquoise",
  "palevioletred",
  "papayawhip",
  "peachpuff",
  "peru",
  "pink",
  "plum",
  "powderblue",
  "purple",
  "rebeccapurple",
  "red",
  "rosybrown",
  "royalblue",
  "saddlebrown",
  "salmon",
  "sandybrown",
  "seagreen",
  "seashell",
  "sienna",
  "silver",
  "skyblue",
  "slateblue",
  "slategray",
  "slategrey",
  "snow",
  "springgreen",
  "steelblue",
  "tan",
  "teal",
  "thistle",
  "tomato",
  "turquoise",
  "violet",
  "wheat",
  "whitesmoke",
  "yellow",
  "yellowgreen",
];

/**
 * Style properties whose value IS a colour.
 *
 * A named colour is only a defect in one of these positions. Matching the bare
 * word anywhere would flag `"the red team"`, a `plum` in seed data, or a CSS
 * class fragment — so the PROPERTY is what makes the value a colour, and the
 * rule keys on it. Both spellings are listed because a JS style object uses
 * camelCase and a CSS declaration uses kebab-case.
 */
export const COLOR_VALUED_PROPERTIES = [
  "color",
  "backgroundColor",
  "background-color",
  "background",
  "borderColor",
  "border-color",
  "borderTopColor",
  "border-top-color",
  "borderRightColor",
  "border-right-color",
  "borderBottomColor",
  "border-bottom-color",
  "borderLeftColor",
  "border-left-color",
  "outlineColor",
  "outline-color",
  "caretColor",
  "caret-color",
  "textDecorationColor",
  "text-decoration-color",
  "columnRuleColor",
  "column-rule-color",
  "fill",
  "stroke",
  "stopColor",
  "stop-color",
  "floodColor",
  "flood-color",
  "lightingColor",
  "lighting-color",
];

/** Whether a value is exactly a fixed CSS named colour. */
export function isNamedColor(value) {
  return (
    typeof value === "string" &&
    CSS_NAMED_COLORS.includes(value.trim().toLowerCase())
  );
}

/** Whether a property name takes a colour as its value. */
export function isColorValuedProperty(name) {
  return (
    typeof name === "string" && COLOR_VALUED_PROPERTIES.includes(name.trim())
  );
}

/**
 * Build the pattern for a CSS DECLARATION assigning a named colour, e.g.
 * `color: deepskyblue` inside a style string or a stylesheet.
 *
 * The declaration form is what makes this safe to run over free text: the
 * property and the colon are what distinguish a colour from the same word used
 * as prose or as part of an identifier.
 */
export function createNamedColorDeclarationPattern({ global = false } = {}) {
  const props = COLOR_VALUED_PROPERTIES.join("|");
  const names = CSS_NAMED_COLORS.join("|");
  return new RegExp(
    `(?:^|[\\s;{"'\`])(${props})\\s*:\\s*(${names})\\s*(?:[;}"'\`]|$)`,
    global ? "gi" : "i"
  );
}

/** The inline comment that exempts a line, and the reason it must carry one. */
export const EXEMPTION_MARKER = "design-lint-ok";

/**
 * Whether text carries the exemption directive AND a reason.
 *
 * Matched as a standalone directive followed by `:` and something, rather than
 * by substring. A substring accepts the bare marker — which silences a rule
 * while recording nothing — and accepts incidental text such as
 * `not-design-lint-ok`, where the surrounding words may be arguing the
 * opposite. Recording WHY is the entire reason to exempt in place rather than
 * disable the rule, so a directive without a reason suppresses nothing.
 */
export function hasExemptionDirective(text) {
  return new RegExp(`(?:^|[\\s*/])${EXEMPTION_MARKER}\\s*:\\s*\\S`).test(text);
}

/**
 * Build the palette-utility pattern.
 *
 * A FACTORY rather than a shared constant because a `g`-flagged regex carries
 * `lastIndex` between calls: one shared instance would skip matches depending on
 * where the previous caller left off, and the misses would look like clean code.
 *
 * The match is anchored on a class-list boundary so `translate-x-1/2` (which
 * contains "slate-x") and a hue named in prose are not read as utilities. The
 * `!` important marker may precede the utility and an opacity suffix (`/40`)
 * may follow it.
 *
 * A VARIANT SEPARATOR counts as a boundary, rather than the variants themselves
 * being matched. Enumerating them cannot be made complete: Tailwind admits
 * arbitrary variants containing brackets, equals signs and colons of their own —
 * `data-[state=open]:`, `supports-[display:grid]:`, `[&>*]:` — so a pattern that
 * consumes the prefix has to model the whole variant grammar, and every shape it
 * has not met yet reads as clean. Anchoring on the `:` that ends any variant
 * needs to model none of it. The trade is that the reported class names the
 * utility rather than the whole expression, which is the part being asked to
 * change anyway.
 */
export function createPaletteClassPattern({ global = false } = {}) {
  const utils = COLOR_UTILS.join("|");
  const hues = PALETTE_HUES.join("|");
  const shades = PALETTE_SHADES.join("|");
  return new RegExp(
    `(?:^|[\\s"'\`{:])(!?(?:${utils})-(?:${hues})-(?:${shades})(?:\\/\\d{1,3})?)(?![\\w-])`,
    global ? "g" : ""
  );
}

/**
 * Build the colour-literal pattern: a hex value, or a colour function whose
 * channels are literal numbers.
 *
 * `rgb(var(--x))` is deliberately NOT matched here — a token wrapped in a colour
 * function is a different defect with a different fix, and
 * `createTokenWrapPattern` is what names it.
 */
export function createColorLiteralPattern({ global = false } = {}) {
  return new RegExp(
    `#[0-9a-fA-F]{3,8}\\b|\\b(?:rgb|rgba|hsl|hsla)\\(\\s*[0-9.]|\\b(?:oklch|oklab)\\(\\s*[0-9.]`,
    global ? "g" : ""
  );
}

/**
 * Build the pattern for a token wrapped in a colour function.
 *
 * Tokens are complete OKLCH colours, so `hsl(var(--nx-primary))` expands to
 * `hsl(oklch(...))`, which is invalid and which the browser drops — the element
 * silently loses its colour rather than failing loudly.
 */
export function createTokenWrapPattern({ global = false } = {}) {
  return new RegExp(`\\b(?:hsl|hsla|rgb|rgba)\\(\\s*var\\(`, global ? "g" : "");
}

/**
 * A token with an alpha suffix stuck on the end — `var(--nx-primary)20`.
 *
 * The sibling of {@link createTokenWrapPattern}, and the same defect class: an
 * idiom that was correct while colours were hex and silently produces invalid
 * CSS once they are tokens. `#3b82f6` + `20` is a real colour with 12.5% alpha;
 * `var(--nx-primary)` + `20` is not a colour at all, so the browser drops the
 * declaration and the element renders with nothing where the tint belonged.
 *
 * Matches the literal spelling, which is what a stylesheet or a completed
 * template string contains. The `.tsx` spelling — a template literal whose next
 * chunk begins with the alpha digits — is decided on the AST instead, by
 * `no-token-alpha-suffix`, because the token and the suffix are separate nodes
 * there and no text pattern can see them as adjacent.
 *
 * One or two digits: CSS 8-digit hex takes a two-digit alpha and 4-digit hex
 * takes one, so those are the only widths this idiom produces. Bounded on the
 * right so `var(--x)2px` — a length, not an alpha — does not match.
 */
export function createTokenAlphaSuffixPattern({ global = false } = {}) {
  return new RegExp(
    `var\\(\\s*--[\\w-]+\\s*\\)[0-9a-fA-F]{1,2}(?![\\w-])`,
    global ? "g" : ""
  );
}

/**
 * Advice naming what to use instead, derived from the hue that was matched.
 *
 * The message carries the replacement because an error that only says "do not do
 * this" leaves the reader to guess which of four semantic scales applies, and the
 * guess is what produced the two-hues-per-meaning drift in the first place.
 */
export function paletteAdvice(match) {
  const hue = new RegExp(`(${PALETTE_HUES.join("|")})`).exec(match)?.[1];
  const replacement = hue && HUE_REPLACEMENT[hue];
  if (replacement) return `use ${replacement}`;
  return "use a semantic scale (success-*/warning-*/destructive-*/primary-*) or a neutral token";
}

/**
 * Remove the colour literals that are legitimate everywhere, so what remains is
 * only the kind a token should have supplied.
 *
 * Black, white and transparent are mode-invariant: a scrim or a shadow is the
 * same colour in light and dark, so routing it through a themed token would
 * claim a variation that does not exist. `url(...)` payloads and `placeholder`
 * example values are content rather than styling.
 */
export function stripExemptColorPieces(text) {
  return (
    text
      // A hex inside a comment is documentation, not code.
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/url\([^)]*\)/g, "")
      .replace(/placeholder\s*[:=]\s*["'][^"']*["']/g, "")
      // Black and white in every hex length CSS accepts, each with its own
      // alpha form: `#RGB` takes one alpha digit (`#0000`), `#RRGGBB` takes two
      // (`#00000033`). Offering only the 6-digit pair's alpha rejected `#0000`
      // and `#fff8` — mode-invariant scrims the rule advertises as legitimate.
      .replace(
        /#(?:ffffff(?:[0-9a-f]{2})?|000000(?:[0-9a-f]{2})?|fff[0-9a-f]?|000[0-9a-f]?)\b/gi,
        ""
      )
      .replace(/rgba?\(\s*0\s*[,\s]\s*0\s*[,\s]\s*0[^)]*\)/gi, "")
      .replace(/rgba?\(\s*255\s*[,\s]\s*255\s*[,\s]\s*255[^)]*\)/gi, "")
  );
}

/** Whether a colour literal survives the exemptions above. */
export function hasNonExemptColorLiteral(text) {
  return createColorLiteralPattern().test(stripExemptColorPieces(text));
}
