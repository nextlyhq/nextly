/**
 * How many rows a card draws at each tier.
 *
 * The displays, the query and the loading card's reservation all read this, so
 * what is pinned here is the one answer they share: a small card stops at
 * three, a wider one draws what its setting asks, and nothing draws past the
 * card maximum core publishes.
 */
import {
  DEFAULT_WIDGET_LIMIT,
  MAX_WIDGET_LIMIT,
  MAX_WIDGET_ROWS,
} from "nextly/config";
import { describe, expect, it } from "vitest";

import { rowsDrawn, SMALL_TIER_ROWS } from "../tier";

describe("rowsDrawn", () => {
  it("draws what the setting asks at medium and large", () => {
    expect(rowsDrawn("medium", 8)).toBe(8);
    expect(rowsDrawn("large", 8)).toBe(8);
  });

  it("stops a small card at three, and draws fewer when fewer are asked", () => {
    // 🔴 The separating pair: a function that ignored the tier passes the
    // case above and fails this one; one that always drew three fails the
    // second line.
    expect(rowsDrawn("small", 8)).toBe(SMALL_TIER_ROWS);
    expect(rowsDrawn("small", 2)).toBe(2);
  });

  it("draws no more than the card maximum, below the server's clamp", () => {
    // The card maximum is its own number: the server allows a query up to its
    // clamp, and a card asks one row above what it draws.
    expect(MAX_WIDGET_ROWS).toBeLessThan(MAX_WIDGET_LIMIT);
    expect(rowsDrawn("large", MAX_WIDGET_ROWS + 10)).toBe(MAX_WIDGET_ROWS);
    expect(rowsDrawn("large", MAX_WIDGET_ROWS)).toBe(MAX_WIDGET_ROWS);
  });

  it("reads a missing or garbage setting as the query does", () => {
    for (const items of [undefined, Number.NaN, "ten", null]) {
      expect(rowsDrawn("large", items)).toBe(DEFAULT_WIDGET_LIMIT);
      expect(rowsDrawn("small", items)).toBe(
        Math.min(DEFAULT_WIDGET_LIMIT, SMALL_TIER_ROWS)
      );
    }
    expect(rowsDrawn("medium", 0)).toBe(1);
    expect(rowsDrawn("medium", -4)).toBe(1);
    expect(rowsDrawn("medium", 6.9)).toBe(6);
  });
});
