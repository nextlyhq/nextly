/**
 * Numbers as the type-change judgement reads them: exactly, from their writing, never through a
 * rounded JavaScript number. A text `"01"`, a decimal column's `1.50` and a JSON `1e21` are each
 * read as the digits they name, so whether a new column holds a value exactly is a question about
 * those digits.
 *
 * A number's reading, and whether a double keeps it, are the column judgement's own
 * (`exactNumber`, `keptByDouble`): a repair and a type change read one number the same way.
 *
 * @module domains/schema/value-conversion/type-change/numbers
 */
import { exactNumber, keptByDouble } from "../value-readings";

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

/**
 * A number the judgement reads: finite and exact, one of the non-finite numbers, or a finite number
 * whose digits reach past every column (`beyond`), kept as its writing rather than expanded.
 */
export type ReadNumber =
  | { finite: true; value: ExactDecimal }
  | { finite: false; value: NonFinite }
  | { finite: "beyond"; writing: string; large: boolean };

/**
 * How far from the point a digit may sit and still be one a column could hold: a decimal's
 * precision and scale stop at 1,000 digits (PostgreSQL's limit), and a double's range is far
 * shorter. A number with digits past it is beyond every column, large or small.
 */
const FURTHEST_DIGIT = 1_000;

/**
 * The number a text names, or null where it names none. A finite number is read as the column
 * judgement reads one (`exactNumber`), blanks around it not part of it; `NaN`, `Infinity` and
 * `-Infinity` are read in any letter case (`+Infinity` too), with the same blanks allowed.
 */
export function readNumber(text: string): ReadNumber | null {
  const lower = text.trim().toLowerCase();
  if (lower === "nan") return { finite: false, value: "NaN" };
  if (lower === "infinity" || lower === "+infinity") {
    return { finite: false, value: "Infinity" };
  }
  if (lower === "-infinity") return { finite: false, value: "-Infinity" };
  // `exactNumber` spells a number as its significant digits and an exponent (`-125e-2`), and
  // every zero as `0`.
  const canonical = exactNumber(text);
  if (canonical === "0") {
    return {
      finite: true,
      value: { negative: false, whole: "", fraction: "" },
    };
  }
  const parts =
    canonical === null ? null : /^(-)?(\d+)e(-?\d+)$/.exec(canonical);
  if (parts === null || canonical === null) return null;
  const digits = parts[2];
  const exponent = Number(parts[3]);
  // Judged without expanding: `1e1000000000` is a short text that would expand past any string.
  if (digits.length + exponent > FURTHEST_DIGIT) {
    return { finite: "beyond", writing: canonical, large: true };
  }
  if (exponent < -FURTHEST_DIGIT) {
    return { finite: "beyond", writing: canonical, large: false };
  }
  return {
    finite: true,
    value: shifted(parts[1] === "-", digits, "", exponent),
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
  if (value.finite === "beyond") return value.writing;
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
  return keptByDouble(decimalWriting(value));
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
