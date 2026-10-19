/**
 * The query a card asks at its tier, and when a change of tier asks again.
 *
 * Sized by the query's op, which is what decides what its limit counts. A list asks one row
 * more than its tier draws, which is how it learns that more exist (a list answer carries no
 * total). A breakdown asks for the groups its query declares at every tier, and the chart cuts
 * them to its tier in its own order. An answer fetched at one tier still serves a smaller one;
 * only a tier that draws more asks again.
 */
import { MAX_WIDGET_ROWS } from "nextly/config";
import { describe, expect, it } from "vitest";

import { rowsDrawn } from "../frame/tier";
import { GROUPS_DRAWN, asksAgainAt, queryForTier } from "../tier-query";

const list = { source: "collection:posts", op: "list" as const, limit: 8 };
const grouped = {
  source: "collection:posts",
  op: "groupBy" as const,
  groupBy: "status",
  limit: 50,
};
const overTime = {
  source: "collection:posts",
  op: "timeseries" as const,
  interval: "day" as const,
  limit: 30,
};

describe("the query a card asks at its tier", () => {
  it("asks a list one row more than the tier draws", () => {
    expect(queryForTier(list, "small").limit).toBe(rowsDrawn("small", 8) + 1);
    expect(queryForTier(list, "medium").limit).toBe(9);
    expect(queryForTier(list, "large").limit).toBe(9);
  });

  it("asks a small list four rows whatever its setting, and never past the card maximum", () => {
    // 🔴 The separating pair: a query that kept the setting asks 8 at small; one that ignored
    // it asks 26 at large.
    expect(queryForTier(list, "small").limit).toBe(4);
    expect(queryForTier({ ...list, limit: 40 }, "large").limit).toBe(
      MAX_WIDGET_ROWS + 1
    );
  });

  it("asks a breakdown the groups it declares, at every tier", () => {
    // 🔴 Not cut to the tier on the server. The server breaks a tie at its cap by stored value,
    // and the chart orders ties by label; cut there, a small card could keep a group its own
    // order puts after one the server dropped. Cut in the chart, every tier cut follows one order.
    expect(GROUPS_DRAWN).toEqual({ small: 3, medium: 5, large: 8 });
    expect(queryForTier(grouped, "small")).toBe(grouped);
    expect(queryForTier(grouped, "large")).toBe(grouped);
  });

  it("leaves a query whose limit is not rows or groups as it was", () => {
    // An over-time query's limit is its window of intervals: the tier changes how it is drawn,
    // not what is asked.
    expect(queryForTier(overTime, "small")).toBe(overTime);
  });

  it("keeps the rest of the query", () => {
    const filtered = {
      ...list,
      where: { status: { equals: "draft" } },
      sort: "-updatedAt",
    };
    const asked = queryForTier(filtered, "medium");
    expect(asked).toEqual({ ...filtered, limit: 9 });
  });
});

describe("whether a change of tier asks again", () => {
  it("asks again when the new tier draws more than was fetched", () => {
    expect(asksAgainAt(list, "small", "medium")).toBe(true);
  });

  it("asks nothing when the tier shrinks, or grows without drawing more", () => {
    expect(asksAgainAt(list, "medium", "small")).toBe(false);
    // A list draws its setting at medium and large alike, so the rise between them is free.
    expect(asksAgainAt(list, "medium", "large")).toBe(false);
    // A setting of two rows draws two at every tier.
    expect(asksAgainAt({ ...list, limit: 2 }, "small", "large")).toBe(false);
  });

  it("asks nothing for a query the tier does not size", () => {
    expect(asksAgainAt(overTime, "small", "large")).toBe(false);
    // A breakdown holds every group it declares from the first answer, so growing draws more of
    // them without asking.
    expect(asksAgainAt(grouped, "small", "large")).toBe(false);
  });
});
