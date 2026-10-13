import { commerceError } from "../errors";

import { assertMoney, money, type Money } from "./money";

/**
 * Split `total` across parts in proportion to `weights`, so the parts add up
 * to exactly `total`: a tax or discount spread over an order's lines, or a
 * partial refund spread over what it covers.
 *
 * Uses the largest-remainder rule. Each part first gets the whole minor units
 * of its exact share, rounded towards zero; the few units left over (fewer
 * than the number of parts) go one each to the parts whose exact share lost
 * the most in that rounding, the earlier part first on a tie. So:
 *
 * - the parts always sum to `total`;
 * - each part is within one minor unit of its exact share;
 * - a part with weight 0 gets 0;
 * - every part has the sign of `total` (or is 0);
 * - the same inputs always give the same parts.
 *
 * Weights are non-negative safe integers, typically the parts' own amounts in
 * minor units. They are multiplied with BigInt, so a large total times a large
 * weight never loses precision.
 *
 * @experimental
 * @throws `COMMERCE_INVALID_ALLOCATION` for no weights, a negative or
 *   fractional weight, or all-zero weights with a non-zero total.
 */
export function allocate(total: Money, weights: readonly number[]): Money[] {
  assertMoney(total);
  if (weights.length === 0) {
    throw commerceError("COMMERCE_INVALID_ALLOCATION", { reason: "no parts" });
  }
  for (const weight of weights) {
    if (!Number.isSafeInteger(weight) || weight < 0) {
      throw commerceError("COMMERCE_INVALID_ALLOCATION", {
        reason: "a weight is not a non-negative whole number",
      });
    }
  }

  const weightSum = weights.reduce((acc, w) => acc + BigInt(w), 0n);
  if (weightSum === 0n) {
    if (total.amount === 0) return weights.map(() => money(0, total.currency));
    // Nothing to be proportional to: where the amount goes is the caller's
    // decision, not something to guess.
    throw commerceError("COMMERCE_INVALID_ALLOCATION", {
      reason: "all weights are zero",
    });
  }

  // Allocate the magnitude, then give every part the total's sign, so a
  // negative total (a reversal) splits exactly as its positive would.
  const magnitude = BigInt(Math.abs(total.amount));
  const shares = weights.map((weight, index) => {
    const exact = magnitude * BigInt(weight);
    return { index, base: exact / weightSum, remainder: exact % weightSum };
  });

  let leftover = magnitude - shares.reduce((acc, s) => acc + s.base, 0n);
  const byRemainder = [...shares].sort((a, b) =>
    a.remainder === b.remainder
      ? a.index - b.index
      : a.remainder > b.remainder
        ? -1
        : 1
  );
  const extra = new Set<number>();
  for (const share of byRemainder) {
    if (leftover === 0n) break;
    extra.add(share.index);
    leftover -= 1n;
  }

  const sign = total.amount < 0 ? -1 : 1;
  return shares.map(share =>
    money(
      sign * Number(share.base + (extra.has(share.index) ? 1n : 0n)),
      total.currency
    )
  );
}
