/**
 * A token's value in both directions: the CSS a token stores as a DTCG
 * value (lengths, durations, colours, families, numbers and weights, with a
 * fluid size's note), the DTCG value read back as CSS, and whether two
 * readings mean the same.
 *
 * @module style/dtcg-values
 */
import type { ValidationIssue } from "../validation";

import { TOKEN_KINDS, type TokenKind } from "./catalog-types";
// The colour reader the contrast utility already uses. One parser rather than
// two, because a second would have to be kept in step with it by hand and the
// symptom of failure is silent: an exported `$value` that describes a different
// colour from the one the site renders.
import { parseColor, type Rgb } from "./contrast";
import { asciiLower, checkCssValue, decodeIdentifier } from "./css-value";
import { cssFamilyName, familyToDtcg } from "./dtcg-css-text";
import { DTCG_TYPE, type DtcgNode, isPlainObject, issue } from "./dtcg-format";
import { shadowFromDtcg, shadowToDtcg } from "./dtcg-shadow";
import { type SiteToken, tokenValueFetches } from "./site-tokens";

/** The line a fluid size's `$description` names its `clamp()` with. */
export function fluidNoteFor(css: string): string {
  return `Fluid size: ${css.trim()}`;
}

/** A description and a fluid size's note, as `$description` holds the two. */
export function withFluidNote(own: string | undefined, note: string): string {
  return [own, note].filter(Boolean).join("\n\n");
}

/** A token's native DTCG form: its `$type`, its `$value`, and whether it is fluid. */
export interface TypedValue {
  type: string;
  value: unknown;
  /** True when `$value` is a fluid size's largest value rather than the size. */
  fluid: boolean;
}

/**
 * What this token becomes as a DTCG token, or nothing when the format has no
 * type or no conformant value for it, which carries it in the extension.
 *
 * Returns the converted value rather than merely approving the token, so the
 * caller does not convert it a second time: two conversions of one value is
 * the shape that lets an approval and an emission disagree about what was
 * approved.
 */
export function typedValue(
  token: SiteToken,
  aliasOf: AliasOf = noAlias
): TypedValue | undefined {
  const type = DTCG_TYPE[token.kind];
  if (type === undefined) return undefined;
  const value = toDtcgValue(token, aliasOf);
  if (value !== undefined) return { type, value, fluid: false };
  if (token.kind !== "dimension") return undefined;
  const largest = fluidLargestPixels(token.values.light.trim());
  return largest === undefined
    ? undefined
    : { type, value: { value: largest, unit: "px" }, fluid: true };
}

/**
 * A `var()` of a colour variable as an alias to it (`{color.brand}`), or
 * nothing: how a shadow's colour variable is written. The caller knows the
 * site's variables and prefix; a value read alone knows neither.
 */
export type AliasOf = (reference: string) => string | undefined;

const noAlias: AliasOf = () => undefined;

/**
 * The units the format allows, named once for both directions.
 *
 * Export restricting them while import accepted any string is how a file
 * exported from here could fail to come back: the two sides of one rule, and
 * only one of them was written down.
 */
const DTCG_LENGTH_UNITS = ["px", "rem"];
const DTCG_TIME_UNITS = ["ms", "s"];

/** A token's light value in the shape its `$type` requires, or `undefined`. */
function toDtcgValue(token: SiteToken, aliasOf: AliasOf): unknown {
  const css = token.values.light.trim();
  switch (token.kind) {
    case "color":
      return colorToDtcg(css);
    case "dimension":
      return measureToDtcg(css, DTCG_LENGTH_UNITS);
    case "duration":
      return measureToDtcg(css, DTCG_TIME_UNITS);
    case "fontFamily":
      return familyToDtcg(css);
    case "fontWeight":
      return weightToDtcg(css);
    case "number":
      return numberToDtcg(css);
    // Read with the engine's one shadow reader, and written as fields only
    // where every layer reads as them; any other shadow has no conformant
    // value, and the extension carries it.
    case "shadow":
      return shadowToDtcg(css, {
        colour: colorToDtcg,
        length: text =>
          text === "0"
            ? { value: 0, unit: "px" }
            : measureToDtcg(text, DTCG_LENGTH_UNITS),
        alias: aliasOf,
      });
    default:
      return undefined;
  }
}

/** `16px` as `{value, unit}`, when the unit is one the format allows. */
function measureToDtcg(
  css: string,
  units: readonly string[]
): { value: number; unit: string } | undefined {
  const match = CSS_MEASURE.exec(css);
  if (!match) return undefined;
  const value = Number.parseFloat(match[1] ?? "");
  // A unit is an identifier, so a browser reads `1r\\65m` as `1rem`. Comparing
  // the raw text against the allowed units reports a good measurement as one
  // the format cannot express.
  const unit = asciiLower(decodeIdentifier(match[2] ?? ""));
  if (!Number.isFinite(value) || !units.includes(unit)) return undefined;
  return { value, unit };
}

/** A length in px from `0`, a px value or a rem value (16px each), or nothing. */
function pixelsOf(css: string): number | undefined {
  if (css === "0") return 0;
  const measure = measureToDtcg(css, DTCG_LENGTH_UNITS);
  if (measure === undefined) return undefined;
  return measure.unit === "rem" ? measure.value * 16 : measure.value;
}

/**
 * A fluid size's largest value in px: the last argument of a `clamp()`, when
 * that is a px or rem value. Nothing for any other value.
 *
 * The largest because a design tool draws one size, and a layout is designed
 * at its widest; the `clamp()` itself travels beside it.
 */
function fluidLargestPixels(css: string): number | undefined {
  const match = /^clamp\((.*)\)$/is.exec(css);
  if (match === null) return undefined;
  const args = topLevelArguments(match[1] ?? "");
  if (args.length !== 3) return undefined;
  return pixelsOf((args[2] ?? "").trim());
}

/**
 * What a value becomes in the format, read back as CSS: the value an import
 * finds for a token this system wrote from `css`. Nothing when the format
 * cannot type it. The theme file's import compares against it to tell a
 * converted value from one an author edited.
 */
export function nativeReading(
  kind: TokenKind,
  css: string
): string | undefined {
  const typed = typedValue({ name: "value", kind, values: { light: css } });
  return typed === undefined ? undefined : fromDtcgValue(typed.value, kind);
}

/**
 * A size in px as a design tool draws it: a px or rem value, or a fluid size's
 * largest value. The one reading the DTCG export and the Figma files share.
 */
export function largestPixels(css: string): number | undefined {
  const text = css.trim();
  return pixelsOf(text) ?? fluidLargestPixels(text);
}

/** A function's arguments, split at the commas outside any parentheses. */
function topLevelArguments(text: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = 0;
  for (let at = 0; at < text.length; at++) {
    const char = text[at];
    if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (char === "," && depth === 0) {
      args.push(text.slice(start, at));
      start = at + 1;
    }
  }
  args.push(text.slice(start));
  return args;
}

/** A hex or `rgb()` colour in the format's object form. */
function colorToDtcg(css: string): DtcgNode | undefined {
  const rgb: Rgb | undefined = parseColor(css);
  if (rgb === undefined) return undefined;
  const component = (value: number): number =>
    Math.round((value / 255) * 10000) / 10000;
  const node: DtcgNode = {
    colorSpace: "srgb",
    components: [component(rgb.r), component(rgb.g), component(rgb.b)],
    hex: toHex(rgb),
  };
  if (rgb.a < 1) node.alpha = rgb.a;
  return node;
}

/**
 * The CSS `<number>` grammar, which is wider than one canonical spelling.
 *
 * `1.0`, `+2` and `1e3` are all valid numbers a person may reasonably have
 * typed. Accepting only the text `String(Number.parseFloat(x))` happens to
 * produce reports those as inexpressible and drops them from the export, which
 * is a formatting preference presented to the author as a limitation of the
 * format. The exact text is kept in the extension either way, so the round trip
 * stays byte for byte.
 */
// A decimal point is consumed only when a digit follows it: CSS reads `1.` as a
// number and then a delimiter, not as the number `1`. Accepting it let `1.px`
// split into `1` + `px` and export as a dimension the browser would drop.
const CSS_NUMBER_SOURCE = "[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:[eE][+-]?\\d+)?";
const CSS_NUMBER = new RegExp(`^${CSS_NUMBER_SOURCE}$`);

/**
 * The same number, followed by a unit.
 *
 * Built from one source rather than written again, because a measurement is a
 * number with a unit on it and two spellings of "number" is how the two come to
 * disagree — a token exporting as `1e3` while `1e3px` is reported as something
 * the format cannot express.
 */
const CSS_MEASURE = new RegExp(
  `^(${CSS_NUMBER_SOURCE})((?:[a-zA-Z]|\\\\[0-9a-fA-F]{1,6}\\s?|\\\\.)+)$`
);

/** A number token as the format stores it: a JSON number. */
function numberToDtcg(css: string): number | undefined {
  if (!CSS_NUMBER.test(css)) return undefined;
  const value = Number.parseFloat(css);
  return Number.isFinite(value) ? value : undefined;
}

/** A weight as a number, or one of the two keywords the format names. */
function weightToDtcg(css: string): number | string | undefined {
  const numeric = numberToDtcg(css);
  if (numeric !== undefined) return numeric;
  const keyword = css.toLowerCase();
  return keyword === "normal" || keyword === "bold" ? keyword : undefined;
}

/**
 * Whether two spellings of one kind's value mean the same thing.
 *
 * Silence is the answer whenever this cannot tell, and the direction is
 * deliberate: this feeds an advisory report, where a false alarm costs the
 * whole report and a miss costs one line. So an unequal pair is only called a
 * disagreement when something here can show the two differ in MEANING.
 *
 * Colour is the kind that can be shown, because `parseColor` already reads the
 * spellings the emitter writes. Every other kind compares only as text, and
 * text differing is not enough — `1rem` and `1.0rem` are the same dimension —
 * so those stay silent. That is a real gap and it is stated rather than closed:
 * closing it needs a normaliser per kind, and each one is a second answer to
 * what a value of that kind means.
 */
export function meansTheSame(
  stated: string,
  taken: string,
  kind: TokenKind
): boolean {
  if (stated === taken) return true;
  if (kind !== "color") return true;
  const left = parseColor(stated);
  const right = parseColor(taken);
  if (left === undefined || right === undefined) return true;
  return sameRgb(left, right);
}

/** Whether two parsed colours are the same colour, alpha included. */
function sameRgb(left: Rgb, right: Rgb): boolean {
  return (
    left.r === right.r &&
    left.g === right.g &&
    left.b === right.b &&
    left.a === right.a
  );
}

/**
 * Whether an imported value could ever be written, reported where it arrived.
 *
 * The emitter refuses these anyway, so nothing unsafe reaches a stylesheet
 * either way. What changes is WHERE the author is told: without this the file
 * imports cleanly, the token is stored, and the reason appears on every page
 * compile from then on instead of once, naming the import that carried it.
 *
 * The same two guards the emitter applies, called from here rather than
 * restated — a value the emitter would refuse and this accepted, or the
 * reverse, is a disagreement with no symptom to follow.
 */
export function isWritableValue(
  values: { light: string; dark?: string },
  name: string,
  issues: ValidationIssue[]
): boolean {
  for (const [mode, value] of Object.entries(values)) {
    if (typeof value !== "string") continue;
    if (checkCssValue(value) !== null) {
      issues.push(
        issue(
          `"${name}" has a ${mode} value that cannot be written as CSS, so it was skipped.`
        )
      );
      return false;
    }
    if (tokenValueFetches(value)) {
      issues.push(
        issue(
          `"${name}" has a ${mode} value that would load a file, so it was skipped. A token holds a colour, a length, a duration, a font or a number.`
        )
      );
      return false;
    }
  }
  return true;
}

/**
 * Whether a value is one of this system's token kinds.
 *
 * Exported because `readToken` (in `dtcg-read`) decides whether to take a token's stored
 * CSS on this and two other conditions, and a caller reporting what the reader
 * dropped has to ask the same question rather than restate it. Every kind,
 * `custom` included: a variable the format has no type for is carried in this
 * system's extension, and read back from its stored CSS like any other.
 */
export function isKind(value: unknown): value is TokenKind {
  return typeof value === "string" && TOKEN_KINDS.some(kind => kind === value);
}

/** A DTCG value as the CSS this system stores, or `undefined`. */
export function fromDtcgValue(
  value: unknown,
  kind: TokenKind
): string | undefined {
  return FROM_DTCG[kind](value);
}

/**
 * A measure as CSS, in a unit the format allows for it. The same units the
 * export side allows, so the two directions agree. A unit is text from a file
 * being concatenated into a stored value: read unchecked,
 * `{ value: 16, unit: "px;color:red" }` becomes CSS nothing here wrote.
 */
const measureFromDtcg =
  (allowed: readonly string[]) =>
  (value: unknown): string | undefined => {
    if (!isPlainObject(value)) return undefined;
    const amount = value.value;
    const unit = value.unit;
    if (
      typeof amount !== "number" ||
      !Number.isFinite(amount) ||
      typeof unit !== "string" ||
      !allowed.includes(unit.toLowerCase())
    ) {
      return undefined;
    }
    return `${amount}${unit.toLowerCase()}`;
  };

/**
 * A family value as CSS. A DTCG family value is a NAME, not CSS: `ACME,Inc` is
 * one family in the file and two the moment it is written into a stylesheet
 * unquoted, and a name holding a quote produces CSS that does not parse at all.
 */
function familyFromDtcg(value: unknown): string | undefined {
  if (typeof value === "string") return cssFamilyName(value);
  if (Array.isArray(value) && value.every(v => typeof v === "string")) {
    return value.map(cssFamilyName).join(", ");
  }
  return undefined;
}

/** How each kind's DTCG value reads as CSS, one reader per kind. */
const FROM_DTCG: Readonly<
  Record<TokenKind, (value: unknown) => string | undefined>
> = {
  color: value => colorFromDtcg(value),
  dimension: measureFromDtcg(DTCG_LENGTH_UNITS),
  duration: measureFromDtcg(DTCG_TIME_UNITS),
  fontFamily: familyFromDtcg,
  fontWeight: value =>
    typeof value === "number"
      ? String(value)
      : typeof value === "string"
        ? value
        : undefined,
  number: value => (typeof value === "number" ? String(value) : undefined),
  // A shadow's fields, layer by layer, with the same colour and size readers.
  shadow: value =>
    shadowFromDtcg(value, {
      colour: colorFromDtcg,
      length: measureFromDtcg(DTCG_LENGTH_UNITS),
    }),
  // A string variable's text is the custom value itself.
  custom: value => (typeof value === "string" ? value : undefined),
};

/**
 * A DTCG colour as CSS.
 *
 * The `hex` fallback is preferred where the file supplies one, because it is
 * exactly what the format says it is for and it round-trips byte for byte.
 * Otherwise the components are written as `rgb()`, which every browser reads —
 * `color(srgb …)` is newer and this is a value that has to render.
 */
// RELOCATED, not written here — see the docblock of `dtcg.ts`.
// fallow-ignore-next-line complexity
function colorFromDtcg(value: unknown): string | undefined {
  if (!isPlainObject(value)) return undefined;
  // `alpha` is a member of its own, and `hex` is the six-digit fallback for the
  // colour WITHOUT it. Taking the hex on its own therefore imports a
  // half-transparent colour as an opaque one — a value that renders, looks
  // deliberate, and is not the colour the file described.
  // Validated rather than clamped, for the same reason the components are: an
  // alpha of 2 or -0.5 is not an alpha, and folding it to 1 or 0 imports a
  // colour the file did not describe.
  if (
    value.alpha !== undefined &&
    (typeof value.alpha !== "number" ||
      !Number.isFinite(value.alpha) ||
      value.alpha < 0 ||
      value.alpha > 1)
  ) {
    return undefined;
  }
  const alpha = typeof value.alpha === "number" ? value.alpha : 1;
  if (typeof value.hex === "string" && /^#[0-9a-f]{6}$/i.test(value.hex)) {
    // The hex is a FALLBACK for the components beside it, not an alternative to
    // them. Where both are present and disagree — `components: [1, 0, 0]` with
    // `hex: "#000000"` — taking the hex imports black for a token that
    // describes red, so the file is refused rather than silently reinterpreted.
    // Only where the components ARE sRGB channels. In another space they are
    // not comparable to an sRGB hex, and a file supplying a converted fallback
    // — display-p3 components beside their sRGB hex — is perfectly valid.
    if (value.colorSpace === "srgb" && hexDisagreesWithComponents(value)) {
      return undefined;
    }
    if (alpha >= 1) return value.hex;
    const rgb = parseColor(value.hex);
    if (rgb !== undefined) return `rgb(${rgb.r} ${rgb.g} ${rgb.b} / ${alpha})`;
  }
  const components = value.components;
  // Exactly three. sRGB has three channels and alpha is a member of its own, so
  // a fourth entry means the value was not written as the format describes —
  // dropping it silently would import a colour nobody wrote.
  if (!Array.isArray(components) || components.length !== 3) return undefined;
  if (value.colorSpace !== "srgb") return undefined;
  const channels = components;
  if (!channels.every(part => typeof part === "number")) return undefined;
  // Refused rather than clamped. A component outside 0-1 is not an sRGB
  // channel, and folding `[2, 0, 0]` down to red stores a colour the file did
  // not describe — rendered, believed, and never reported.
  if (
    !channels.every(part => Number.isFinite(part) && part >= 0 && part <= 1)
  ) {
    return undefined;
  }
  const [r, g, b] = channels.map(part => Math.round(part * 255));
  return alpha < 1 ? `rgb(${r} ${g} ${b} / ${alpha})` : `rgb(${r} ${g} ${b})`;
}

/**
 * Whether a supplied `hex` describes a different colour from the components.
 *
 * Compared after rounding to the same 8-bit channels the hex can express, so a
 * component that merely lost precision on the way to two digits still agrees.
 */
function hexDisagreesWithComponents(value: Record<string, unknown>): boolean {
  const components = value.components;
  if (!Array.isArray(components) || components.length !== 3) return false;
  if (!components.every(part => typeof part === "number")) return false;
  const fromHex = parseColor(String(value.hex));
  if (fromHex === undefined) return false;
  const channels = components.map(part =>
    Math.round(Math.min(1, Math.max(0, part)) * 255)
  );
  return (
    channels[0] !== fromHex.r ||
    channels[1] !== fromHex.g ||
    channels[2] !== fromHex.b
  );
}

function toHex(rgb: { r: number; g: number; b: number }): string {
  const part = (value: number): string =>
    Math.round(Math.min(255, Math.max(0, value)))
      .toString(16)
      .padStart(2, "0");
  return `#${part(rgb.r)}${part(rgb.g)}${part(rgb.b)}`;
}
