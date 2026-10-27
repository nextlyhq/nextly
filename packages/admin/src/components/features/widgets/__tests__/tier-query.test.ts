/**
 * The query a card asks at its tier, and when a change of tier asks again.
 *
 * Sized by the query's op, which is what decides what its limit counts. A list asks one row
 * more than its tier draws, which is how it learns that more exist (not every source counts its
 * rows). A breakdown asks for the groups its query declares at every tier, and the chart cuts
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
    // Five rows at medium and ten at large, never past the setting's eight.
    expect(queryForTier(list, "medium").limit).toBe(6);
    expect(queryForTier(list, "large").limit).toBe(9);
  });

  it("asks a compact list for the more rows its body holds", () => {
    // A compact row is shorter, so a medium body holds seven where it holds five at default.
    expect(queryForTier(list, "medium", "compact").limit).toBe(8);
    expect(queryForTier(list, "medium", "default").limit).toBe(6);
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
    expect(asked).toEqual({ ...filtered, limit: 6 });
  });
});

describe("whether a change of tier asks again", () => {
  it("asks again when the new tier draws more than was fetched", () => {
    expect(asksAgainAt(list, { tier: "small" }, { tier: "medium" })).toBe(true);
    expect(asksAgainAt(list, { tier: "medium" }, { tier: "large" })).toBe(true);
  });

  it("asks nothing when the tier shrinks, or grows without drawing more", () => {
    expect(asksAgainAt(list, { tier: "medium" }, { tier: "small" })).toBe(
      false
    );
    // A setting of five draws five at medium and large alike, so the rise between them is free.
    expect(
      asksAgainAt({ ...list, limit: 5 }, { tier: "medium" }, { tier: "large" })
    ).toBe(false);
    // A setting of two rows draws two at every tier.
    expect(
      asksAgainAt({ ...list, limit: 2 }, { tier: "small" }, { tier: "large" })
    ).toBe(false);
  });

  it("asks again when the card grows taller at the same width, or turns compact", () => {
    // 🔴 Judged by the tier alone, a card made taller keeps the rows it was fetched for and
    // leaves the rest of its body empty.
    const at = (h: number, density?: "default" | "compact") => ({
      tier: "medium" as const,
      h,
      ...(density === undefined ? {} : { density }),
    });
    expect(asksAgainAt(list, at(4), at(6))).toBe(true);
    expect(asksAgainAt(list, at(5), at(5, "compact"))).toBe(true);
    // Shorter, or as tall, asks nothing: the answer it holds serves it.
    expect(asksAgainAt(list, at(6), at(4))).toBe(false);
    expect(asksAgainAt(list, at(5), at(5))).toBe(false);
    // And the query it asks is sized for that height: seven rows at h 6, asked as eight.
    expect(queryForTier(list, "medium", "default", 6).limit).toBe(8);
    expect(queryForTier(list, "medium", "default", 4).limit).toBe(5);
  });

  it("asks nothing for a query the tier does not size", () => {
    expect(asksAgainAt(overTime, { tier: "small" }, { tier: "large" })).toBe(
      false
    );
    // A breakdown holds every group it declares from the first answer, so growing draws more of
    // them without asking.
    expect(asksAgainAt(grouped, { tier: "small" }, { tier: "large" })).toBe(
      false
    );
  });
});
