/**
 * An unlimited allowance survives the wire: the editor sends `null` for it,
 * which JSON carries, and the routes read `null` back as no limit.
 */
import { describe, expect, it } from "vitest";

import { allowanceFromWire, allowanceToWire } from "./page-allowance";

describe("an allowance on the wire", () => {
  it.each([
    [undefined, undefined],
    [0, 0],
    [12, 12],
    [12.7, 12],
    [-3, 0],
    [Number.POSITIVE_INFINITY, null],
    [Number.NEGATIVE_INFINITY, 0],
  ])("is sent for %s as %s", (allowance, sent) => {
    expect(allowanceToWire(allowance)).toBe(sent);
  });

  it("comes back as it was sent, no limit included", () => {
    for (const allowance of [0, 12, Number.POSITIVE_INFINITY]) {
      const sent = JSON.parse(
        JSON.stringify({ allowance: allowanceToWire(allowance) })
      ) as { allowance: number | null };
      expect(allowanceFromWire(sent.allowance)).toBe(allowance);
    }
    expect(allowanceFromWire(undefined)).toBeUndefined();
  });
});
