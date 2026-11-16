/**
 * Whether a token's value can be what its kind says it is, and what to type
 * instead when it cannot.
 *
 * One rule for both sides of a save: the variable editor runs it before it
 * accepts a value, and the token emitter runs it as it writes the site's
 * custom properties, which is what a save is checked against.
 *
 * @module style/site-token-kind
 */
import { STYLE_CATALOG } from "./catalog";
import type { TokenKind } from "./catalog-types";
import { shapeLeaves } from "./catalog-types";
import { parseColor } from "./contrast";
import {
  asciiLower,
  decodeIdentifier,
  isCssWideKeyword,
  unitCategory,
} from "./css-value";

/**
 * A value whose kind nothing can judge from the text alone.
 *
 * `var()` resolves elsewhere, `calc()` and its relatives compute, and
 * `color-mix()` produces a colour from arguments this is not going to evaluate.
 * A guess about any of them would be a guess, so they are passed.
 */
const OPAQUE_VALUE =
  /^(?:var|calc|clamp|min|max|env|attr|color-mix|light-dark|round|abs)\(/i;

/**
 * The words a length token may hold: every keyword that a property reading a
 * length token accepts in a length's place (`auto` on a margin, `large` on a
 * font size, `thin` on a border width), lower-cased as CSS compares them.
 *
 * Derived from the catalog rather than listed here, so a keyword a property
 * gains is accepted in a token the same day, and a word no property takes is
 * the certain mismatch this check exists to report.
 */
const LENGTH_TOKEN_KEYWORDS: ReadonlySet<string> = new Set(
  STYLE_CATALOG.flatMap(entry => shapeLeaves(entry.shape))
    .filter(leaf => leaf.tokenKinds.includes("dimension"))
    .flatMap(leaf => ("keywords" in leaf ? (leaf.keywords ?? []) : []))
    .map(asciiLower)
);

/** What a length token holding words is told. */
const LENGTH_WORDS = "is words, not a length";

/** What a colour token holding a hex CSS cannot read is told. */
const HEX_MALFORMED =
  "is not a hex colour, which has 3, 4, 6 or 8 digits from 0-9 and a-f";

/**
 * What to type for a token of each kind, as an example an author can copy, or
 * nothing for the kinds no value is refused for. Said after a mismatch from
 * {@link checkTokenKind}, wherever it is shown: as an editor refuses a value,
 * as a save is refused, or as a render warns.
 */
export function tokenKindExample(kind: TokenKind): string | undefined {
  switch (kind) {
    case "color":
      return "a colour, such as #1d4ed8";
    case "dimension":
      return "a number with a unit, such as 16px or 1.5rem";
    case "duration":
      return "a time, such as 150ms";
    case "number":
      return "a plain number, such as 1.5";
    case "fontWeight":
      return "a weight from 1 to 1000, such as 400, or normal or bold";
    case "fontFamily":
    case "shadow":
    case "custom":
      return undefined;
  }
}

/** The only words `font-weight` takes; every other value is a number. */
const FONT_WEIGHT_KEYWORDS = new Set(["normal", "bold", "bolder", "lighter"]);

/** Text that begins the way a number does, whether or not it finishes like one. */
const NUMERIC_LOOKING = /^[+-]?[.\d]/;

/**
 * A bare number, with the unit it carries — the shape most kinds disagree over.
 *
 * The exponent branch is not decoration: without it `1e3px` does not match at
 * all, so the check reaches no verdict and stays silent about a duration token
 * that will be dropped by the browser. The rest of the token code accepts that
 * spelling, and a grammar narrower here than there is a check that quietly
 * stops covering the values the other side lets through.
 */
const MEASUREMENT =
  /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?(%|(?:[a-zA-Z]|\\[0-9a-fA-F]{1,6}\s?|\\.)*)$/;

/**
 * Why a value cannot be what its token says it is, when that is knowable.
 *
 * The kind is not decoration: it decides which properties may reference the
 * token, so a `dimension` holding `red` compiles into `padding:var(--site-…)`
 * and the browser drops the declaration at use time. Nothing on the page says
 * why, and the author is left looking at a padding that does not apply.
 *
 * Deliberately one-sided. It reports only what it is CERTAIN of — a length
 * where a colour belongs, a colour where a length belongs — and stays quiet
 * about everything it merely cannot parse, because `oklch()`, a named colour
 * and next year's colour function are all valid CSS this has no business
 * refusing. And it is a warning rather than a refusal for the same reason: a
 * wrong verdict then costs a message, not the token.
 */
export function checkTokenKind(
  kind: TokenKind,
  value: string
): string | undefined {
  const text = value.trim();
  if (text === "" || OPAQUE_VALUE.test(text)) return undefined;
  if (isCssWideKeyword(asciiLower(text))) return undefined;

  const measured = MEASUREMENT.exec(text);
  // Text plainly trying to be a number but failing to be one — `1.px`, `1..2` —
  // reaches no verdict below, because nothing matches and every branch reads
  // `undefined` as "cannot judge". For the kinds that ARE numbers, failing to
  // parse is itself the answer.
  if (
    measured === null &&
    NUMERIC_LOOKING.test(text) &&
    (kind === "dimension" ||
      kind === "duration" ||
      kind === "number" ||
      kind === "fontWeight" ||
      // A colour too. Tightening the measurement pattern moved `1.px` out of
      // the colour branch below without putting it anywhere else, so it stopped
      // being reported at all — the silence this branch exists to end.
      kind === "color")
  ) {
    return kind === "color"
      ? "opens like a number and is not one, so it is not a colour"
      : "is not a number CSS can read";
  }
  // A unit is an identifier, so `1m\\73` IS `1ms`. Read raw, the check reaches
  // no verdict and stays silent about a value the browser drops.
  const rawUnit = measured === null ? undefined : (measured[1] ?? "");
  const unit =
    rawUnit === undefined ? undefined : asciiLower(decodeIdentifier(rawUnit));
  // A percentage is its own token and cannot be spelled with an escape: `1\\%`
  // and `1\\25` decode to a unit reading `%`, but CSS sees an invalid dimension
  // and drops the declaration. Only the literal counts.
  const isPercentage = rawUnit === "%";
  // `unitCategory` resolves the spelling itself, so it is handed the unit as
  // written. Decoding first and passing the result resolves the escape twice,
  // and `1\\5c s` — a dimension whose unit decodes to the two characters `\s`,
  // which measures nothing — comes back reading `s` and passes as a duration
  // the browser drops.
  const measures = rawUnit === undefined ? undefined : unitCategory(rawUnit);
  const amount = measured === null ? undefined : Number.parseFloat(text);
  const isColor = parseColor(text) !== undefined;

  switch (kind) {
    case "color":
      // A number is never a colour, whatever unit it wears.
      if (measured) {
        return `is a ${unit === "" ? "number" : "measurement"}, not a colour`;
      }
      // A hex is the one colour spelling read here in full, so one that
      // `parseColor` cannot read is certainly not a colour.
      return text.startsWith("#") && !isColor ? HEX_MALFORMED : undefined;
    case "dimension": {
      if (isColor) return "is a colour, not a length";
      // Not a measurement. A function may be one this does not know, so it
      // passes; a word passes only if some property reading the token takes
      // it.
      if (unit === undefined) {
        return text.includes("(") || LENGTH_TOKEN_KEYWORDS.has(asciiLower(text))
          ? undefined
          : LENGTH_WORDS;
      }
      // Only zero may go without a unit; `16` is not `16px` to CSS.
      if (unit === "") {
        return amount === 0
          ? undefined
          : "is a number with no unit, so it is not a length";
      }
      // A percentage stands in for a length wherever a length token is used.
      // Anything else that measures something — `150ms`, `20deg` — measures the
      // wrong quantity, and the browser drops the declaration that reads it.
      // Judged by what the unit MEASURES rather than by a second list of length
      // units kept beside the one the value checker already has.
      if (isPercentage) return undefined;
      return measures === "length"
        ? undefined
        : `is measured in ${unit}, which is ${measures ?? "not a unit CSS knows"}, not a length`;
    }
    case "duration": {
      if (isColor) return "is a colour, not a duration";
      if (unit === undefined) return undefined;
      // CSS allows a unitless zero for a time, and only a unitless one: `0px`
      // is still a length, and `animation-duration: var(--site-time)` reading
      // it is a declaration the browser drops.
      if (unit === "" && amount === 0) return undefined;
      return measures === "time"
        ? undefined
        : `is measured in ${unit === "" ? "no unit" : unit}, not seconds or milliseconds`;
    }
    case "number":
      if (isColor) return "is a colour, not a number";
      return unit !== undefined && unit !== ""
        ? `carries the unit "${unit}", so it is not a plain number`
        : undefined;
    case "fontWeight":
      if (unit !== undefined && unit !== "") {
        return `carries the unit "${unit}", so it is not a font weight`;
      }
      if (amount !== undefined) {
        return amount < 1 || amount > 1000
          ? "is outside the 1 to 1000 a font weight may take"
          : undefined;
      }
      // Not a number, so it has to be one of the four words the property
      // takes. Accepting every other word meant a weight of `heavy` was
      // emitted with nothing said about it and dropped where it was used.
      return FONT_WEIGHT_KEYWORDS.has(asciiLower(text))
        ? undefined
        : `is not a font weight; the words are ${[...FONT_WEIGHT_KEYWORDS].join(", ")}`;
    // A family is any text, a shadow is a list this does not parse, and
    // `custom` exists precisely so a site can hold something with no rules.
    case "fontFamily":
    case "shadow":
    case "custom":
      return undefined;
  }
}
