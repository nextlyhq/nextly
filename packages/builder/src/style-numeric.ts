/**
 * The numeric view of a stored style value, and the choices a control may offer
 * over it.
 *
 * Pure, for the reason `style-controls.ts` is: what a value decomposes into,
 * whether it may be stepped, and which units are worth offering are all
 * derivation, and a jsdom test of the rendered field cannot separate a correct
 * answer from a plausible wrong one — both draw an input with a number in it.
 *
 * ## A measurement is a PROJECTION over the string, never a model of it
 *
 * A `dimension` is stored as a string, and the catalog lets one hold far more
 * than a number and a unit: per-property `keywords` (`auto` centres a margin
 * and is discarded on padding), `maxParts` (four corners, or a row and a column
 * gap), `functions` (`clamp()`, `fit-content()`), a unitless number where the
 * property says so, the CSS-wide keywords everywhere, and a `{ $token }`
 * reference that is a record and nonetheless a scalar.
 *
 * So `16px`, `auto`, `10px 20px`, `clamp(1rem, 2vw, 3rem)`, `inherit` and a
 * token are all legal in one position. A control that MODELLED the value as a
 * number plus a unit could represent one of those six, and would write the
 * other five away the moment a field was focused and blurred — the author's
 * `clamp()` replaced by `0px`, with nothing to say it happened.
 *
 * Everything here therefore answers with `undefined` rather than with a guess.
 * A caller that gets `undefined` keeps the plain text field it already had,
 * which accepts every one of those spellings; a caller that gets a measurement
 * may additionally offer stepping and a unit. Nothing here ever rewrites a
 * value it could not decompose.
 *
 * ## The engine decides, and this asks it
 *
 * No grammar is restated here. Whether a composed string is a legal value for a
 * property is `checkDimensionValue`'s question, asked with the leaf's own rules,
 * and a step or a unit swap that would produce something the engine refuses is
 * answered `undefined` instead of being offered. Predicting it here would mean
 * a second copy of the rules for negatives, percentages, functions and unitless
 * numbers — the copy that keeps compiling while the two drift apart, which is
 * invisible because a refused value and an unoffered one look identical.
 *
 * @module style-numeric
 */

import {
  checkDimensionValue,
  trimCssWhitespace,
  type StyleLeaf,
  type StyleValue,
} from "@nextlyhq/blocks-engine";

/**
 * The grammar CSS calls a `<number>`: an optional sign, digits with an optional
 * decimal part, and an optional exponent.
 *
 * Deliberately narrower than `Number` in both directions. `Number` reads
 * spellings CSS does not (`0x10`, `0b10`, `0o10`), and it also accepts a
 * trailing point: CSS requires at least one digit AFTER a decimal point, so
 * `1.` is a number followed by a stray delimiter rather than a number, and
 * `Number("1.")` quietly answering `1` would store a value the author never
 * wrote a valid spelling of.
 */
export const CSS_NUMBER = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * One measurement split into the parts a control edits separately.
 *
 * A unit can be absent — `line-height: 1.5` is unitless and `0` is legal
 * everywhere — so the empty string means "no unit" rather than "unknown", and a
 * caller composing a new value joins the two with nothing between them.
 */
export interface Measurement {
  /** The numeric part, as CSS reads it. */
  readonly number: number;
  /** The unit as WRITTEN, or `""` for a unitless value. */
  readonly unit: string;
  /**
   * How many digits followed the decimal point, so a step ROUNDS at the
   * author's own precision.
   *
   * Carried rather than recovered from {@link number}, which has already lost
   * it: `1.50` and `1.5` parse to the same double, so without this a step of
   * `0.25` on `1.50rem` would round to the value's apparent one decimal and
   * answer `1.8rem` instead of `1.75rem`.
   *
   * It governs ROUNDING and not spelling. A trailing zero is not preserved
   * through a step — `1.50` stepped by `0.1` answers `1.6`, not `1.60` —
   * because the composed text is re-parsed to drop the zeros that rounding
   * introduces. Stated because the two are easy to conflate, and a reader
   * expecting the spelling back would find the value correct and the text
   * changed.
   */
  readonly decimals: number;
}

/**
 * The most fractional digits `Number.prototype.toFixed` accepts.
 *
 * Named rather than inlined because it is a limit of the FORMATTER and not a
 * judgement about how precise a length may be: the engine accepts more, and
 * anything beyond this is declined rather than truncated for that reason.
 */
const MAX_FRACTION_DIGITS = 100;

/**
 * A number followed by an optional unit, and nothing else.
 *
 * The unit is matched as letters or a single `%` rather than by a list, because
 * a list here would be a second copy of the engine's — this only has to SPLIT
 * the string; whether the unit means anything is decided by asking. Anchored at
 * both ends so a value with a second term (`10px 20px`), a function, or any
 * trailing text fails to match rather than matching its first part and
 * presenting a shorthand as though it were one measurement.
 */
const MEASUREMENT = new RegExp(
  // Composed from the one grammar rather than spelled again: a second copy of
  // the number rule would let a draft this accepts and `committedValue`
  // rejects — or the reverse — pass every test either side owns.
  `^(${CSS_NUMBER.source.replace(/^\^|\$$/g, "")})([a-zA-Z]+|%)?$`
);

/**
 * The measurement a stored value holds, when it holds exactly one.
 *
 * Answers `undefined` for everything a numeric affordance cannot represent —
 * a keyword, a shorthand, a function, a token reference, an object at a scalar
 * position — so the caller keeps its text field rather than narrowing what the
 * author can express.
 *
 * A stored NUMBER is a measurement with no unit. `number` leaves store numbers
 * rather than strings, so reading only strings would leave every `opacity` and
 * `line-height` unsteppable while looking supported.
 */
export function measurementOf(
  value: StyleValue | undefined
): Measurement | undefined {
  if (typeof value === "number") {
    // DELEGATED to the text path rather than decomposed here, so the
    // round-trip guard applies to a stored number too. Read directly, this
    // branch answered `{ number: 1e-7, decimals: 0 }` for a value the text path
    // declines — and `line-height: 1e-7` then stepped to `1`, discarding the
    // quantity. Two paths to one answer is the defect this module keeps
    // producing; the number branch simply prints its value and asks the same
    // question of it.
    return Number.isFinite(value)
      ? measurementOfText(String(value))
      : undefined;
  }
  // Every remaining non-string is refused by the same test, and a token
  // reference is one of them: `{ $token }` is one value spelled as a record, so
  // it arrives here as an object and is never decomposed. A control that
  // offered to step it would be offering to replace the reference with a
  // literal. Named because the shape is easy to mistake for a composite —
  // `isTokenRef` is deliberately NOT called, since it could only ever agree
  // with the test already made.
  if (typeof value !== "string") return undefined;
  return measurementOfText(value);
}

/** The measurement a typed draft holds, when it holds exactly one. */
export function measurementOfText(text: string): Measurement | undefined {
  const trimmed = trimCssWhitespace(text);
  const match = MEASUREMENT.exec(trimmed);
  if (match === null) return undefined;
  const [, digits = "", unit = ""] = match;
  const number = Number(digits);
  if (!Number.isFinite(number)) return undefined;
  const decimals = decimalsOf(digits);
  // Precision the formatter cannot round to is DECLINED, not truncated. The
  // engine accepts a length with more fractional digits than `toFixed` takes,
  // and composing one would throw mid-keystroke. Checked BEFORE the round trip
  // below, which would be the thing that throws.
  if (decimals > MAX_FRACTION_DIGITS) return undefined;
  // THE PROJECTION MUST REPRODUCE ITS OWN INPUT, or it does not get to edit it.
  //
  // A `number` is a double and several spellings the engine accepts do not
  // survive the trip through one: `9007199254740993` comes back smaller than it
  // started, `1e-7` composes to `0`, `.5` becomes `0.5`. Composing any of them
  // writes a value the author never typed, which is the silent rewrite this
  // module exists to prevent, committed by the module itself.
  //
  // Asked by CALLING THE COMPOSER rather than by re-deriving what it would do.
  // That is the whole point of the check and not an implementation detail: a
  // guard written as its own expression is a second answer to "what will this
  // become", and the two drifted apart at exactly one input — `String(1e-7)` is
  // `"1e-7"` and round-trips, while `toFixed(0)` on the same value is `"0"`. So
  // the guard admitted a value the composer then destroyed. Sharing the
  // function makes that disagreement unrepresentable.
  //
  // Conservative by design: `1.50`, `+5`, `05` and `.5` are all legal and none
  // reproduces itself, so they lose the affordances too. For an editing aid
  // that is the cheap direction to be wrong in — the value still works and can
  // still be typed, which is not true of the alternative.
  if (composeMeasurement(number, "", decimals) !== digits) return undefined;
  return { number, unit, decimals };
}

/**
 * How many digits follow the decimal point in a written number.
 *
 * Read from the TEXT rather than from the parsed double, which no longer knows
 * the difference between `1.50` and `1.5` — and the count is what a step rounds
 * at, so losing it coarsens the result rather than merely reformatting it.
 *
 * Exponent notation reaches here and answers 0, which is correct for what this
 * measures: it never survives the round-trip check in {@link measurementOfText}
 * regardless, so no caller sees the count.
 */
function decimalsOf(digits: string): number {
  const point = digits.indexOf(".");
  return point === -1 ? 0 : digits.length - point - 1;
}

/**
 * The value written back after a measurement is composed, in the author's own
 * precision.
 *
 * Rounded rather than left to floating point, because the arithmetic is not
 * exact in the base the author is typing in: stepping `0.1` by `0.2` answers
 * `0.30000000000000004`, which is a valid CSS number and a value no one would
 * choose to store.
 */
function composeMeasurement(
  number: number,
  unit: string,
  decimals: number
): string {
  // `toFixed` rather than a multiply-round-divide, which reintroduces the error
  // it was meant to remove at the magnitudes a length actually takes.
  return `${String(roundedTo(number, decimals))}${unit}`;
}

/**
 * Whether the engine accepts this text as a value for this leaf.
 *
 * The LEAF is handed over whole rather than having its rule fields copied into
 * a fresh object. A dimension leaf already carries everything
 * `checkDimensionValue` reads, so passing it through means the preflight this
 * module performs and the validation the write path performs are judged by
 * literally the same values — including any the engine adds later, which an
 * enumeration here would silently omit while continuing to compile. A control
 * that offered a unit the write path then refused would be the visible half of
 * that drift; the invisible half is a restriction quietly not applied.
 */
function accepts(
  leaf: Extract<StyleLeaf, { kind: "dimension" }>,
  text: string
): boolean {
  return checkDimensionValue(text, leaf) === null;
}

/**
 * The units a control may OFFER for this leaf, in the order an author meets
 * them.
 *
 * Every candidate is tried against the engine before being offered, so the list
 * is filtered by the property's own rules rather than by a belief about them: a
 * leaf that refuses percentages never shows `%`, and no offered unit can
 * produce a value the write path then rejects.
 *
 * **The candidate list is a discoverability aid and NOT a grammar, which is the
 * honest description of its limits.** A unit missing from it is still typeable,
 * because the field it sits beside accepts any text the engine does; a unit
 * wrongly present is filtered out by the check above. So the failure mode is a
 * shorter menu, which an author routes around, rather than an offered value the
 * document then refuses. That asymmetry is why a fixed list is acceptable here
 * and would not be in the write path — the engine's own unit sets are private
 * to it, and reaching for them would put a second copy in this package.
 */
export function unitChoicesFor(leaf: StyleLeaf): readonly string[] {
  if (leaf.kind !== "dimension") return [];
  return UNIT_CANDIDATES.filter(unit => accepts(leaf, `1${unit}`));
}

/**
 * Units common enough in authoring to be worth a menu entry.
 *
 * Absolute first, then the two font-relative units, then the viewport pair,
 * then the percentage — the order an author reaches for them rather than
 * alphabetical, which would open the menu on `%`. `ch` and the container-query
 * units are omitted deliberately: they are typeable, and a menu long enough to
 * scroll costs every author to serve a few.
 */
const UNIT_CANDIDATES: readonly string[] = ["px", "rem", "em", "vw", "vh", "%"];

/**
 * The same value carrying a different unit, or `undefined` when the swap would
 * produce something this property refuses.
 *
 * The NUMBER is carried across unchanged rather than converted. A conversion
 * would have to know the font size and the viewport to be correct, and neither
 * is knowable from here — so `16px` becoming `16rem` is what the author asked
 * for and is what a design tool does; inventing `1rem` instead would be a
 * guess dressed as help.
 */
export function withUnit(
  leaf: StyleLeaf,
  value: StyleValue | undefined,
  unit: string
): string | undefined {
  if (leaf.kind !== "dimension") return undefined;
  const current = measurementOf(value);
  if (current === undefined) return undefined;
  const next = composeMeasurement(current.number, unit, current.decimals);
  return accepts(leaf, next) ? next : undefined;
}

/**
 * The value one step away, or `undefined` when this value cannot be stepped or
 * the result would be refused.
 *
 * The unit is preserved, so stepping is an edit to the quantity and never a
 * change of kind. A result the property refuses — a negative margin on a
 * padding, a percentage where none resolves — answers `undefined` so the key
 * does nothing visible, rather than writing a value the document then rejects
 * and leaving the field holding text that was never stored.
 */
export function steppedValue(
  leaf: StyleLeaf,
  value: StyleValue | undefined,
  delta: number
): string | number | undefined {
  if (leaf.kind === "number") return steppedNumber(leaf, value, delta);
  if (leaf.kind !== "dimension") return undefined;
  const current = measurementOf(value);
  if (current === undefined) return undefined;
  const decimals = stepDecimals(current.decimals, delta);
  const stepped = roundedTo(current.number + delta, decimals);
  if (!movedBy(current.number, stepped, delta, decimals)) return undefined;
  const next = composeMeasurement(
    current.number + delta,
    current.unit,
    decimals
  );
  return accepts(leaf, next) ? next : undefined;
}

/**
 * Whether the composed result actually moved by the step that was asked for.
 *
 * The round-trip guard in {@link measurementOfText} proves the STARTING value
 * survives a double. It says nothing about the step, and near the safe-integer
 * boundary the two come apart: `9007199254740992` plus one is the same double,
 * so the arrow is consumed and nothing happens, and `9007199254740994` plus one
 * lands on `...996` — a silent step of two. Neither is a value the author asked
 * for, and the first is worse than an error because it looks like a dead key.
 *
 * Measured at the composition's own precision rather than exactly, because
 * binary arithmetic does not land on decimal boundaries: `1.25 + 0.1` differs
 * from `1.25` by `0.10000000000000009`, which is the correct step and is not
 * `0.1`. Rounding both sides at the digits the value is written to compares
 * what an author would read rather than what a double holds.
 */
function movedBy(
  from: number,
  stepped: number,
  delta: number,
  decimals: number
): boolean {
  return roundedTo(stepped - from, decimals) === roundedTo(delta, decimals);
}

/**
 * A number as it reads at a given precision.
 *
 * The one rounding used by both the composer and the check above, so what gets
 * written and what gets verified cannot be two different roundings — which is
 * the disagreement this module has already produced once, between a guard and
 * the composer it was guarding.
 */
function roundedTo(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}

/**
 * A `number` leaf stepped within its declared bounds.
 *
 * Separate from the dimension path because the two are judged by different
 * things: a number carries `min`, `max` and `integer` on the leaf itself, where
 * a dimension's legality is a question only the engine can answer. Clamped
 * rather than refused at the ends, which is what a spinbutton does — holding an
 * arrow key at the maximum should rest there rather than stop responding.
 */
function steppedNumber(
  leaf: Extract<StyleLeaf, { kind: "number" }>,
  value: StyleValue | undefined,
  delta: number
): number | undefined {
  const current = measurementOf(value);
  // A unit on a number leaf is not a number: `opacity: 5px` is stored text the
  // engine refuses, and stepping it would answer `6px`, which it also refuses.
  if (current === undefined || current.unit !== "") return undefined;
  const stepped =
    leaf.integer === true
      ? Math.round(current.number + delta)
      : current.number + delta;
  const decimals =
    leaf.integer === true ? 0 : stepDecimals(current.decimals, delta);
  const rounded = roundedTo(stepped, decimals);
  // Clamping comes FIRST and is exempt from the check below. Resting at a
  // declared bound is the correct answer to a step rather than a step that
  // failed to happen, so requiring movement there would make the arrow go dead
  // exactly at the ends, which is where a spinbutton is most often held.
  const bound = boundFor(leaf, rounded);
  if (bound !== undefined) return bound;
  // Everywhere else a number leaf is subject to the same arithmetic as a
  // dimension, and was not asking the same question of it: `z-index` is an
  // unbounded integer, so `9007199254740992` plus one is the same double and
  // `9007199254740994` plus one lands two away — a dead key and a doubled step,
  // in a branch the dimension path's guard never reached.
  if (!movedBy(current.number, rounded, delta, decimals)) return undefined;
  return rounded;
}

/**
 * The bound this leaf holds a value to, when the value has passed one.
 *
 * Its own answer rather than two conditionals inside the step, because "has
 * this left the declared range" and "did this move by what was asked" are
 * different questions with opposite answers at the ends: one says the value is
 * correct, the other would say the step failed.
 */
function boundFor(
  leaf: Extract<StyleLeaf, { kind: "number" }>,
  value: number
): number | undefined {
  if (leaf.min !== undefined && value < leaf.min) return leaf.min;
  if (leaf.max !== undefined && value > leaf.max) return leaf.max;
  return undefined;
}

/**
 * How many decimals the stepped result keeps.
 *
 * The wider of the value's own precision and the step's, so a fine step off a
 * whole number lands on `0.1` rather than being rounded straight back to `0`,
 * and a coarse step off `1.50` does not drop the trailing zero the author
 * typed.
 */
function stepDecimals(valueDecimals: number, delta: number): number {
  // Bounded as well as widened. A measurement reaching here is already within
  // the formatter's range, but the step's own precision is a caller's value and
  // widening past the limit would throw where the measurement alone would not.
  return Math.min(
    MAX_FRACTION_DIGITS,
    Math.max(valueDecimals, decimalsOf(String(Math.abs(delta))))
  );
}

/**
 * How many options a segmented control may offer.
 *
 * Three, not two — the condition was never that two is special, it is that the
 * WHOLE vocabulary fits in the control. A keyword offering three short values
 * fits, and folding it into a menu makes an author open something to read three
 * words that could have been on screen.
 */
const MAX_TOGGLE_OPTIONS = 3;

/**
 * The longest a single option may be, and the longest they may be together.
 *
 * Length decides as well as count, because this draws in a rail an author can
 * drag narrow. Three long words do not sit side by side there, and a segmented
 * control that wraps onto three lines is worse than the menu it replaced: it
 * takes MORE height and still has to be read word by word. The bounds are
 * deliberately mean, so the control appears only where it plainly fits and the
 * menu keeps everything else.
 */
const MAX_OPTION_LENGTH = 8;
const MAX_OPTIONS_LENGTH = 20;

/**
 * The options a keyword leaf offers, when offering all of them at once fits.
 *
 * A toggle is a PROJECTION of a keyword leaf and not a shape of its own — the
 * engine has no boolean — so it is offered only where the whole vocabulary fits
 * in it: at most three values, each short, and one keyword per value. A leaf
 * taking a shorthand of two keywords (`overflow: hidden auto`) has more to say
 * than a row of buttons can, and drawing one would hide the second axis
 * entirely.
 *
 * Returned whole or not at all. Offering the first three of a longer vocabulary
 * would be a control that silently cannot reach the values it does not show.
 */
export function toggleOptionsFor(
  leaf: StyleLeaf
): readonly string[] | undefined {
  if (leaf.kind !== "keyword") return undefined;
  if ((leaf.maxParts ?? 1) !== 1) return undefined;

  const values = leaf.values;
  if (values.length < 2 || values.length > MAX_TOGGLE_OPTIONS) return undefined;
  if (values.some(value => value.length > MAX_OPTION_LENGTH)) return undefined;

  const together = values.reduce((sum, value) => sum + value.length, 0);
  if (together > MAX_OPTIONS_LENGTH) return undefined;

  return values;
}

/**
 * Whether a toggle may show this stored value as one of its two options.
 *
 * A stored value outside the pair — a CSS-wide keyword, a token, a spelling the
 * validator folds — is live and compiles while matching neither button, and a
 * toggle rendered over it would show one side selected and silently replace the
 * value on the first click. Answering `false` keeps the text field, which can
 * show what is actually stored.
 */
export function toggleShows(
  options: readonly string[],
  value: StyleValue | undefined
): boolean {
  if (value === undefined) return true;
  return typeof value === "string" && options.includes(value);
}
