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

/** The inline comment that exempts a line, and the reason it must carry one. */
export const EXEMPTION_MARKER = "design-lint-ok";

/**
 * Build the palette-utility pattern.
 *
 * A FACTORY rather than a shared constant because a `g`-flagged regex carries
 * `lastIndex` between calls: one shared instance would skip matches depending on
 * where the previous caller left off, and the misses would look like clean code.
 *
 * The match is anchored on a class-list boundary so `translate-x-1/2` (which
 * contains "slate-x") and a hue named in prose are not read as utilities.
 * Variants (`hover:`, `dark:`) and the `!` important marker are allowed to
 * precede the utility, and an opacity suffix (`/40`) to follow it.
 */
export function createPaletteClassPattern({ global = false } = {}) {
  const utils = COLOR_UTILS.join("|");
  const hues = PALETTE_HUES.join("|");
  const shades = PALETTE_SHADES.join("|");
  return new RegExp(
    `(?:^|[\\s"'\`{])((?:[a-z-]+:)*!?(?:${utils})-(?:${hues})-(?:${shades})(?:\\/\\d{1,3})?)(?![\\w-])`,
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
    `#[0-9a-fA-F]{3,8}\\b|\\b(?:rgb|rgba|hsl|hsla)\\(\\s*[0-9.]`,
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
      // black / white, with an optional 2-digit alpha (`#00000033` scrims)
      .replace(/#(?:ffffff|fff|000000|000)(?:[0-9a-f]{2})?\b/gi, "")
      .replace(/rgba?\(\s*0\s*[,\s]\s*0\s*[,\s]\s*0[^)]*\)/gi, "")
      .replace(/rgba?\(\s*255\s*[,\s]\s*255\s*[,\s]\s*255[^)]*\)/gi, "")
  );
}

/** Whether a colour literal survives the exemptions above. */
export function hasNonExemptColorLiteral(text) {
  return createColorLiteralPattern().test(stripExemptColorPieces(text));
}
