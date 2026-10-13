import { commerceError } from "../errors";

import { minorUnits } from "./currency";
import { assertMoney, moneyFromExact, type Money } from "./money";

/**
 * Write an amount in major units, as a decimal string with exactly the
 * currency's number of decimal places: 1234 USD is "12.34", 1234 JPY is
 * "1234", 1234 KWD is "1.234".
 *
 * For the edge of a provider that takes decimals (a tax service, say). The
 * digits are moved, never divided, so no floating-point value is ever made.
 *
 * @experimental
 */
export function toDecimalString(m: Money): string {
  assertMoney(m);
  const places = minorUnits(m.currency);
  const negative = m.amount < 0;
  const digits = String(Math.abs(m.amount));
  if (places === 0) return `${negative ? "-" : ""}${digits}`;
  const padded = digits.padStart(places + 1, "0");
  const whole = padded.slice(0, padded.length - places);
  const fraction = padded.slice(padded.length - places);
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/**
 * Read an amount written in major units, such as "12.34" USD, exactly.
 *
 * Refuses a value with more decimal places than the currency has rather than
 * rounding it: a provider that answers in fractions of a cent has answered
 * something commerce cannot charge, and silently rounding would make a total
 * that no longer adds up. Accepts fewer places ("12.3" is 1230 cents) and no
 * fraction ("12" is 1200 cents). Refuses exponents, a leading "+", spaces and
 * thousands separators.
 *
 * @experimental
 * @throws `COMMERCE_INVALID_AMOUNT`, `COMMERCE_UNKNOWN_CURRENCY`
 */
export function fromDecimalString(value: string, currency: string): Money {
  const places = minorUnits(currency);
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) {
    throw commerceError("COMMERCE_INVALID_AMOUNT", { reason: "not a decimal" });
  }
  const [, sign, whole, fraction = ""] = match;
  if (fraction.length > places) {
    throw commerceError("COMMERCE_INVALID_AMOUNT", {
      reason: "more decimal places than the currency has",
      places,
    });
  }
  // BigInt keeps every digit exact however long the string; the result is
  // then checked against the safe-integer range.
  const minor = BigInt(`${whole}${fraction.padEnd(places, "0")}`);
  return moneyFromExact(sign === "-" ? -minor : minor, currency);
}
