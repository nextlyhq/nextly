/**
 * Numbers as the type-change judgement reads them: exactly, from their writing, never through a
 * rounded JavaScript number. A text `"01"`, a decimal column's `1.50` and a JSON `1e21` are each
 * read as the digits they name, so whether a new column holds a value exactly is a question about
 * those digits.
 *
 * @module domains/schema/value-conversion/type-change/numbers
 */

/** A finite number as its sign and digits, with no leading or trailing zero. */
export interface ExactDecimal {
  negative: boolean;
  /** The digits before the point, without leading zeros: "" for a number below 1. */
  whole: string;
  /** The digits after the point, without trailing zeros: "" for a whole number. */
  fraction: string;
}

/** The non-finite numbers, as the rules name them. */
export type NonFinite = "NaN" | "Infinity" | "-Infinity";

/** A number the judgement reads: finite and exact, or one of the non-finite numbers. */
export type ReadNumber =
  | { finite: true; value: ExactDecimal }
  | { finite: false; value: NonFinite };

const DECIMAL = /^([+-])?(\d+)?(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

/**
 * The number a text names, or null where it names none. Leading and trailing blanks are not part
 * of a number, a decimal point needs a digit beside it, and `NaN`, `Infinity` and `-Infinity` are
 * read in any letter case (`+Infinity` too).
 */
export function readNumber(text: string): ReadNumber | null {
  const lower = text.toLowerCase();
  if (lower === "nan") return { finite: false, value: "NaN" };
  if (lower === "infinity" || lower === "+infinity") {
    return { finite: false, value: "Infinity" };
  }
  if (lower === "-infinity") return { finite: false, value: "-Infinity" };
  const match = DECIMAL.exec(text);
  if (!match) return null;
  const [, sign, wholeDigits = "", fractionDigits = "", exponent] = match;
  if (wholeDigits === "" && fractionDigits === "") return null;
  return {
    finite: true,
    value: shifted(
      sign === "-",
      wholeDigits,
      fractionDigits,
      Number(exponent ?? "0")
    ),
  };
}

/** `whole.fraction` times ten to `exponent`, normalised. */
function shifted(
  negative: boolean,
  whole: string,
  fraction: string,
  exponent: number
): ExactDecimal {
  const digits = whole + fraction;
  const point = whole.length + exponent;
  const padded =
    point < 0
      ? "0".repeat(-point) + digits
      : point > digits.length
        ? digits + "0".repeat(point - digits.length)
        : digits;
  const at = Math.max(point, 0);
  const value = {
    negative,
    whole: padded.slice(0, at).replace(/^0+/, ""),
    fraction: padded.slice(at).replace(/0+$/, ""),
  };
  // Zero has no sign: -0 and 0 are one value.
  return isZero(value) ? { ...value, negative: false } : value;
}

function isZero(value: ExactDecimal): boolean {
  return value.whole === "" && value.fraction === "";
}

/** The number's shortest plain decimal writing: no exponent, no leading or trailing zero. */
export function decimalWriting(value: ExactDecimal): string {
  const whole = value.whole === "" ? "0" : value.whole;
  const body = value.fraction === "" ? whole : `${whole}.${value.fraction}`;
  return value.negative ? `-${body}` : body;
}

/** A number's writing as the rules give it: its plain decimal writing, or its non-finite name. */
export function numberWriting(value: ReadNumber): string {
  return value.finite ? decimalWriting(value.value) : value.value;
}

/** Whether a whole number fits a signed integer of `bits` bits. */
export function fitsInteger(value: ExactDecimal, bits: 32 | 64): boolean {
  if (value.fraction !== "") return false;
  const magnitude = BigInt(value.whole === "" ? "0" : value.whole);
  const limit = 1n << BigInt(bits - 1);
  return value.negative ? magnitude <= limit : magnitude < limit;
}

/**
 * Whether a double reads back as exactly this number: its shortest round-trip writing names the
 * same digits. A whole number beyond 2^53 that a double cannot hold, or a fraction with more
 * digits than a double keeps, reads back as another number.
 */
export function fitsDouble(value: ExactDecimal): boolean {
  const double = Number(decimalWriting(value));
  if (!Number.isFinite(double)) return false;
  const back = readNumber(String(double));
  return (
    back !== null &&
    back.finite &&
    decimalWriting(back.value) === decimalWriting(value)
  );
}

/** Whether a `decimal(precision, scale)` column holds the number exactly. */
export function fitsDecimal(
  value: ExactDecimal,
  precision: number,
  scale: number
): "exactly" | "rounded" | "out of range" {
  if (value.whole.length > precision - scale) return "out of range";
  return value.fraction.length > scale ? "rounded" : "exactly";
}
