import { z } from "zod";

import { commerceError } from "../errors";

import { assertCurrency, currencyCodeSchema } from "./currency";

/**
 * An amount of money: a whole number of the currency's minor unit (cents for
 * USD, yen for JPY) and the ISO 4217 code it is in. Never a floating-point
 * number of major units, which cannot hold 0.1 exactly.
 *
 * The amount is a JavaScript safe integer, which holds any price a store will
 * see (2^53 cents is about 90 trillion dollars) and is the unit providers such
 * as Stripe take. It may be negative in arithmetic; contracts that need a
 * positive amount say so.
 *
 * @experimental
 */
export interface Money {
  readonly amount: number;
  readonly currency: string;
}

/**
 * Make an amount, refusing a currency that is not a sales currency and an
 * amount that is not a safe whole number of minor units.
 *
 * @experimental
 * @throws `COMMERCE_UNKNOWN_CURRENCY`, `COMMERCE_INVALID_AMOUNT`
 */
export function money(amount: number, currency: string): Money {
  assertCurrency(currency);
  assertWholeAmount(amount);
  // `-0` is stored as `0`, so a zero reached by negation or subtraction
  // compares, serialises and hashes like every other zero. Frozen so an amount
  // passed between functions cannot be changed under the caller still holding it.
  return Object.freeze({ amount: amount === 0 ? 0 : amount, currency });
}

/**
 * Whether `value` is a valid amount: an object with a sales currency and a
 * safe whole-number amount, as `money()` would have made it.
 *
 * @experimental
 */
export function isMoney(value: unknown): value is Money {
  return moneySchema.safeParse(value).success;
}

/** The fields {@link moneySchema} reads, before it builds the `Money`. */
type MoneyShape = {
  amount: z.ZodNumber;
  currency: typeof currencyCodeSchema;
};

/**
 * The schema of an amount arriving from outside (a provider's answer, a stored
 * row, a request body), for parsing at the boundary.
 *
 * @experimental
 */
export const moneySchema: z.ZodPipe<
  z.ZodObject<MoneyShape, z.core.$strict>,
  z.ZodTransform<Money, z.output<z.ZodObject<MoneyShape, z.core.$strict>>>
> = z
  .strictObject<MoneyShape>({
    amount: z.number().refine(Number.isSafeInteger, {
      message: "an amount is a safe whole number of minor units",
    }),
    currency: currencyCodeSchema,
  })
  .transform(value => money(value.amount, value.currency));

/**
 * The sum of two amounts in the same currency.
 *
 * @experimental
 * @throws `COMMERCE_CURRENCY_MISMATCH`, or `COMMERCE_INVALID_AMOUNT` when the
 *   result leaves the safe-integer range.
 */
export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount + b.amount, a.currency);
}

/**
 * `a` minus `b`, in the same currency.
 *
 * @experimental
 */
export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount - b.amount, a.currency);
}

/**
 * An amount times a whole number, such as a unit price times a quantity.
 *
 * A fractional factor is refused rather than rounded: a percentage of an
 * amount is an allocation, and goes through `allocate`, which accounts for
 * every minor unit.
 *
 * @experimental
 */
export function multiply(m: Money, factor: number): Money {
  assertMoney(m);
  if (!Number.isSafeInteger(factor)) {
    throw commerceError("COMMERCE_INVALID_AMOUNT", { factor });
  }
  return money(m.amount * factor, m.currency);
}

/**
 * The total of a list of amounts, all in `currency`. An empty list is zero.
 *
 * The currency is named rather than read from the first item, so an empty
 * list still has one. The running total is exact (BigInt) and only the final
 * one must fit a safe integer, so the answer does not depend on the order of
 * the list.
 *
 * @experimental
 * @throws `COMMERCE_CURRENCY_MISMATCH`, or `COMMERCE_INVALID_AMOUNT` when the
 *   total leaves the safe-integer range.
 */
export function sum(currency: string, amounts: readonly Money[]): Money {
  const zero = money(0, currency);
  let total = 0n;
  for (const m of amounts) {
    assertSameCurrency(zero, m);
    total += BigInt(m.amount);
  }
  return moneyFromExact(total, currency);
}

/**
 * An amount computed exactly in BigInt, refused when it is outside the
 * safe-integer range, where a `number` could no longer hold it exactly.
 *
 * @throws `COMMERCE_INVALID_AMOUNT`
 */
export function moneyFromExact(minor: bigint, currency: string): Money {
  if (
    minor > BigInt(Number.MAX_SAFE_INTEGER) ||
    minor < BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    throw commerceError("COMMERCE_INVALID_AMOUNT", { reason: "out of range" });
  }
  return money(Number(minor), currency);
}

/**
 * The amount with its sign reversed.
 *
 * @experimental
 */
export function negate(m: Money): Money {
  assertMoney(m);
  return money(-m.amount, m.currency);
}

/**
 * -1, 0 or 1 as `a` is less than, equal to or greater than `b`, in the same
 * currency.
 *
 * @experimental
 */
export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  return a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : 0;
}

/**
 * Whether two amounts are the same amount in the same currency. Amounts in
 * different currencies are simply not equal.
 *
 * @experimental
 */
export function equals(a: Money, b: Money): boolean {
  assertMoney(a);
  assertMoney(b);
  return a.currency === b.currency && a.amount === b.amount;
}

/**
 * Refuse a value that is not a valid amount, with the reason.
 *
 * @experimental
 */
export function assertMoney(value: unknown): asserts value is Money {
  if (typeof value !== "object" || value === null) {
    throw commerceError("COMMERCE_INVALID_AMOUNT", { received: typeof value });
  }
  const { amount, currency } = value as Record<string, unknown>;
  assertCurrency(currency);
  assertWholeAmount(amount);
}

/**
 * Refuse two amounts in different currencies. Combining them would need an
 * exchange rate, which commerce never applies implicitly.
 *
 * @experimental
 */
export function assertSameCurrency(a: Money, b: Money): void {
  assertMoney(a);
  assertMoney(b);
  if (a.currency !== b.currency) {
    throw commerceError("COMMERCE_CURRENCY_MISMATCH", {
      left: a.currency,
      right: b.currency,
    });
  }
}

function assertWholeAmount(amount: unknown): asserts amount is number {
  if (typeof amount !== "number" || !Number.isSafeInteger(amount)) {
    throw commerceError("COMMERCE_INVALID_AMOUNT", {
      received: typeof amount === "number" ? String(amount) : typeof amount,
    });
  }
}
