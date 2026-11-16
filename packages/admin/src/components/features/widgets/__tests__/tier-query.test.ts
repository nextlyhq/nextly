/**
 * The groups a breakdown draws at each tier: the chart's cut, made in the chart's own order
 * rather than where the answer is read.
 */
import { describe, expect, it } from "vitest";

import { GROUPS_DRAWN } from "../tier-query";

describe("the groups a breakdown draws at its tier", () => {
  it("keeps three, five or eight groups", () => {
    // 🔴 Cut in the chart, not where the answer is read: a read breaks a tie at its cap by stored
    // value, and the chart orders ties by label, so every tier's cut follows one order.
    expect(GROUPS_DRAWN).toEqual({ small: 3, medium: 5, large: 8 });
  });
});
