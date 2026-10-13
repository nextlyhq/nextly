import { NextlyError } from "@nextlyhq/plugin-sdk";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { allocate } from "./allocate";
import { money } from "./money";

const amounts = (parts: readonly { amount: number }[]) =>
  parts.map(p => p.amount);

// Totals and weights in a range where the exact share, total * weight / sum,
// is computed exactly in a double for the comparison below; the function
// itself uses BigInt and is exercised beyond this range separately.
const total = fc.integer({ min: -10_000_000, max: 10_000_000 });
const weights = fc
  .array(fc.integer({ min: 0, max: 1_000_000 }), {
    minLength: 1,
    maxLength: 12,
  })
  .filter(ws => ws.some(w => w > 0));

describe("allocate by the largest-remainder rule", () => {
  it("splits worked examples as the rule says", () => {
    // 100 in three equal parts: one leftover cent to the first, on the tie.
    expect(amounts(allocate(money(100, "USD"), [1, 1, 1]))).toEqual([
      34, 33, 33,
    ]);
    // Tax of 7 cents over lines of 1000 and 3: the large line takes it all.
    expect(amounts(allocate(money(7, "USD"), [1000, 3]))).toEqual([7, 0]);
    // A negative total (a reversal) splits as its positive would, negated.
    expect(amounts(allocate(money(-100, "USD"), [1, 1, 1]))).toEqual([
      -34, -33, -33,
    ]);
    // The leftover goes to the largest remainder, not to the first part: 10
    // over weights 1 and 2 has exact shares 3.33 and 6.67, rounded down to 3
    // and 6, and the spare cent goes to the second, which lost 0.67.
    expect(amounts(allocate(money(10, "USD"), [1, 2]))).toEqual([3, 7]);
  });

  it("always adds up to exactly the total", () => {
    fc.assert(
      fc.property(total, weights, (t, ws) => {
        const parts = allocate(money(t, "USD"), ws);
        expect(parts.reduce((acc, p) => acc + p.amount, 0)).toBe(t);
      })
    );
  });

  it("gives each part within one minor unit of its exact share", () => {
    fc.assert(
      fc.property(total, weights, (t, ws) => {
        const weightSum = ws.reduce((a, b) => a + b, 0);
        allocate(money(t, "USD"), ws).forEach((part, i) => {
          const exact = (t * ws[i]) / weightSum;
          expect(Math.abs(part.amount - exact)).toBeLessThan(1);
        });
      })
    );
  });

  it("gives nothing to a part with weight zero, and the total's sign to the rest", () => {
    fc.assert(
      fc.property(total, weights, (t, ws) => {
        allocate(money(t, "USD"), ws).forEach((part, i) => {
          if (ws[i] === 0) expect(part.amount).toBe(0);
          expect(
            part.amount === 0 || Math.sign(part.amount) === Math.sign(t)
          ).toBe(true);
          expect(part.currency).toBe("USD");
        });
      })
    );
  });

  it("is exact for amounts and weights near the safe-integer limit", () => {
    const big = Number.MAX_SAFE_INTEGER;
    const parts = allocate(money(big, "USD"), [big, big - 1, 1]);
    expect(parts.reduce((acc, p) => acc + BigInt(p.amount), 0n)).toBe(
      BigInt(big)
    );
  });

  it("refuses weights it cannot be proportional to", () => {
    const codeOf = (ws: number[], t = 100) => {
      try {
        allocate(money(t, "USD"), ws);
      } catch (error) {
        return NextlyError.is(error) ? error.code : error;
      }
      return undefined;
    };
    expect(codeOf([])).toBe("COMMERCE_INVALID_ALLOCATION");
    expect(codeOf([1, -1])).toBe("COMMERCE_INVALID_ALLOCATION");
    expect(codeOf([1.5, 1])).toBe("COMMERCE_INVALID_ALLOCATION");
    expect(codeOf([0, 0])).toBe("COMMERCE_INVALID_ALLOCATION");
    // Nothing to spread over nothing is fine: zero parts of zero.
    expect(codeOf([0, 0], 0)).toBeUndefined();
  });
});
