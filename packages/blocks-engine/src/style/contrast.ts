/**
 * Contrast, for tokens a person is choosing right now.
 *
 * The admin's own theme is checked by a test that parses `theme.css`, which is
 * repository data and can be checked once in CI. Site tokens are not: they are
 * a user's data in a database, edited in a colour picker, and the answer has to
 * arrive while the picker is open. So this is a pure function over two colours
 * rather than a build step, and it lives in the engine because that is what the
 * editor and the compiler can both reach.
 *
 * ## WCAG 2, not APCA
 *
 * APCA is the more accurate model and is where WCAG 3 is heading, but it is a
 * draft: nothing references it. The thresholds an author is held to — EN 301
 * 549, the ADA, every procurement checklist — are WCAG 2's, so a tool that
 * tells them they passed has to mean the ratio those documents name. When APCA
 * becomes normative this is the function to revisit.
 *
 * ## The other implementation
 *
 * `packages/ui/src/styles/contrast/color.ts` computes the same two formulas for
 * the admin theme. It is not shared: that package is React and its dependencies
 * come with it, so importing it here would end the engine's runtime-free
 * guarantee, and importing this there would point the design system at the page
 * builder. Both are anchored to the specification's own reference values rather
 * than to each other — the tests here assert the ratios WCAG states, so the two
 * agree because they both agree with the spec.
 *
 * @module style/contrast
 */
import { asciiLower, decodeIdentifier } from "./css-value";

/** Straight sRGB channels, 0-255, plus alpha 0-1. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** The level a pair of colours meets. */
export type ContrastLevel = "AAA" | "AA" | "AA-large" | "fail";

export interface ContrastResult {
  /** The WCAG 2 contrast ratio, 1-21. */
  ratio: number;
  /** The strongest level this ratio satisfies. */
  level: ContrastLevel;
  /** Whether it meets AA for body text, which is the threshold most rules mean. */
  passesBodyText: boolean;
}

const HEX_SHORT = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])?$/i;
const HEX_LONG = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i;
// The function name is an identifier, so `r\\67 b(...)` IS `rgb(...)` to a
// browser. Matched against the decoded text, or a colour that renders is
// reported as one this cannot read.
const RGB_FUNCTION = /^rgba?\(([^)]*)\)$/i;

/**
 * A CSS colour as channels, or `undefined` when it is not one this can read.
 *
 * Hex and `rgb()`/`rgba()` only, in both the comma and the space syntax. Named
 * colours, `hsl()`, `oklch()` and the rest are deliberately absent rather than
 * half-supported: a contrast figure computed from a colour this misread is
 * worse than no figure, because it is a number somebody will act on.
 */
export function parseColor(value: string): Rgb | undefined {
  const text = value.trim();

  const short = HEX_SHORT.exec(text);
  if (short) {
    const [, r, g, b, a] = short;
    return {
      r: Number.parseInt(`${r}${r}`, 16),
      g: Number.parseInt(`${g}${g}`, 16),
      b: Number.parseInt(`${b}${b}`, 16),
      a: a === undefined ? 1 : Number.parseInt(`${a}${a}`, 16) / 255,
    };
  }

  const long = HEX_LONG.exec(text);
  if (long) {
    const [, r, g, b, a] = long;
    return {
      r: Number.parseInt(r ?? "0", 16),
      g: Number.parseInt(g ?? "0", 16),
      b: Number.parseInt(b ?? "0", 16),
      a: a === undefined ? 1 : Number.parseInt(a, 16) / 255,
    };
  }

  const fn = RGB_FUNCTION.exec(text);
  if (fn) return parseRgbFunction(fn[1] ?? "");

  // Only the function NAME may carry escapes. `r\\67 b(255 0 0)` is `rgb()` to a
  // browser, but `rgb(\\32 55 0 0)` is not `rgb(255 0 0)` — an escaped channel
  // is an identifier, not a number, and the declaration is dropped. Decoding
  // the whole value would report a colour that never renders, which is the one
  // thing this function is arranged not to do.
  const named = NAMED_FUNCTION.exec(text);
  if (named === null) return undefined;
  const name = asciiLower(decodeIdentifier(named[1] ?? ""));
  if (name !== "rgb" && name !== "rgba") return undefined;
  return parseRgbFunction(named[2] ?? "");
}

/** Any function call, split into its name and its arguments as written. */
const NAMED_FUNCTION = /^([^(]+)\(([^)]*)\)$/;

/**
 * The inside of an `rgb()`, in either syntax CSS actually has.
 *
 * They are two grammars, not one with optional punctuation. The legacy form
 * separates every component with commas — `rgb(0, 0, 0)`, `rgba(0, 0, 0, .5)` —
 * and the modern form separates channels with spaces and takes its alpha only
 * after a slash: `rgb(0 0 0 / 50%)`. Neither permits the other's punctuation.
 *
 * Read as one loose grammar, `rgb(0 0 0 0.5)` looks like a colour with an
 * alpha. It is not: a browser drops that declaration entirely. Accepting it
 * here would let the editor tell an author that an unusable colour passes
 * contrast — which is worse than the `undefined` this returns for everything
 * else it cannot honestly judge.
 */
function parseRgbFunction(body: string): Rgb | undefined {
  const slash = body.indexOf("/");
  const commas = body.includes(",");
  // The two syntaxes cannot be mixed, so a value carrying both punctuations is
  // not a colour in either of them.
  if (slash !== -1 && commas) return undefined;

  let channelText = body;
  let alphaText: string | undefined;
  if (slash !== -1) {
    channelText = body.slice(0, slash);
    alphaText = body.slice(slash + 1).trim();
    if (alphaText === "" || alphaText.includes("/")) return undefined;
  }

  const split = channelText
    .split(commas ? "," : /\s+/)
    .map(part => part.trim());
  // An empty field is only ever whitespace in the space form — `rgb( 0 0 0 )`
  // splits with empties at the ends. Between commas it is a MISSING component,
  // and dropping it silently turns `rgb(0,,0,0)` into `rgb(0,0,0)`: a colour
  // the browser rejects, reported here as one it accepts.
  if (commas && split.some(part => part === "")) return undefined;
  const parts = split.filter(part => part !== "");

  if (commas) {
    // The legacy form carries its alpha as a fourth comma-separated component.
    if (parts.length === 4) alphaText = parts[3];
    else if (parts.length !== 3) return undefined;
  } else if (parts.length !== 3) {
    return undefined;
  }

  const channelParts = parts.slice(0, 3);
  // The legacy grammar is three numbers or three percentages, never a mixture:
  // `rgb() = rgb(<percentage>#{3}, <alpha-value>?) | rgb(<number>#{3},
  // <alpha-value>?)`. The modern form does allow mixing, so this applies only
  // where the commas say the value is the legacy one.
  if (
    commas &&
    new Set(channelParts.map(part => part.endsWith("%"))).size > 1
  ) {
    return undefined;
  }

  const channels = channelParts.map(part => channel(part));
  if (channels.some(value => value === undefined)) return undefined;
  const alpha = alphaText === undefined ? 1 : alphaOf(alphaText);
  if (alpha === undefined) return undefined;
  const [r, g, b] = channels as [number, number, number];
  return { r, g, b, a: alpha };
}

/**
 * One numeric component, with its percentage sign if it has one.
 *
 * Matched rather than parsed, because `Number.parseFloat` reads a prefix and
 * stops: it turns `0 0.5` into `0` and `12abc` into `12`, so a malformed
 * component would be accepted as whatever number happened to start it.
 */
const NUMERIC_COMPONENT = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?(%?)$/;

/** One `rgb()` channel, as 0-255, from either a number or a percentage. */
function channel(part: string): number | undefined {
  const match = NUMERIC_COMPONENT.exec(part);
  if (!match) return undefined;
  const percent = match[1] === "%";
  const raw = Number.parseFloat(part);
  if (!Number.isFinite(raw)) return undefined;
  return clamp(percent ? (raw / 100) * 255 : raw, 0, 255);
}

/** An alpha component, as 0-1, from either a number or a percentage. */
function alphaOf(part: string): number | undefined {
  const match = NUMERIC_COMPONENT.exec(part);
  if (!match) return undefined;
  const percent = match[1] === "%";
  const raw = Number.parseFloat(part);
  if (!Number.isFinite(raw)) return undefined;
  return clamp(percent ? raw / 100 : raw, 0, 1);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * A translucent colour resolved against what sits behind it.
 *
 * Contrast is a property of what reaches the eye, and a colour with alpha has
 * no contrast of its own — the same `rgba(0,0,0,.5)` is readable on white and
 * invisible on black. Compositing first is what makes the ratio mean anything.
 */
export function compositeOver(fg: Rgb, bg: Rgb): Rgb {
  if (fg.a >= 1) return fg;
  const a = fg.a;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  };
}

/**
 * Relative luminance, as WCAG 2 defines it.
 *
 * The channel transfer function is the sRGB one, and the coefficients are the
 * specification's: `0.2126 R + 0.7152 G + 0.0722 B`.
 */
export function relativeLuminance(rgb: Rgb): number {
  const linear = (value: number): number => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * linear(rgb.r) + 0.7152 * linear(rgb.g) + 0.0722 * linear(rgb.b)
  );
}

/** The WCAG 2 contrast ratio between two opaque colours: 1 to 21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * How a foreground fares against a background, or `undefined` if either colour
 * cannot be read.
 *
 * `undefined` rather than a default, because a caller that cannot tell a real
 * verdict from a fallback will show the fallback as one. A token holding
 * `var(--something)` has no contrast this can compute, and saying so is the
 * only honest answer.
 *
 * The thresholds are WCAG 2's: 4.5 for body text, 3 for large text and for
 * user-interface components, 7 for AAA.
 */
export function checkContrast(
  foreground: string,
  background: string
): ContrastResult | undefined {
  const fg = parseColor(foreground);
  const bg = parseColor(background);
  if (fg === undefined || bg === undefined) return undefined;

  // The background is composited against white first: a translucent background
  // is drawn over the page, and assuming opacity there would report a ratio
  // nobody sees.
  const base = compositeOver(bg, { r: 255, g: 255, b: 255, a: 1 });
  const ratio = contrastRatio(compositeOver(fg, base), base);

  const level: ContrastLevel =
    ratio >= 7 ? "AAA" : ratio >= 4.5 ? "AA" : ratio >= 3 ? "AA-large" : "fail";
  return { ratio, level, passesBodyText: ratio >= 4.5 };
}
