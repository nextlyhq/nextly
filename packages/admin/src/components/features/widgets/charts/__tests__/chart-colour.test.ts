/**
 * Which of the five shared chart colours a chart's groups take.
 *
 * A chart of statuses gives each status its pinned slot, the same on every
 * card and in every order. Any other chart of groups draws every bar in slot 1,
 * so arbitrary values never become colour that says nothing; the name beside
 * each bar is what identifies it either way.
 */
import { describe, expect, it } from "vitest";

import { chartColour, chartSlotsFor, orderGroups } from "../chart-colour";

describe("the slots a chart's groups take", () => {
  it("puts each status on its pinned slot in a chart of statuses", () => {
    expect(
      chartSlotsFor(["scheduled", "draft", "published", "changes", "archived"])
    ).toEqual([1, 2, 3, 4, 5]);
  });

  it("does not depend on the order the statuses arrive in", () => {
    // 🔴 The separating case: a palette assigned by position gives the first
    // group colour 1 whatever it is.
    expect(chartSlotsFor(["archived", "published", "draft"])).toEqual([
      5, 3, 2,
    ]);
  });

  it("draws every bar of an arbitrary select in slot 1", () => {
    expect(chartSlotsFor(["gold", "silver", "bronze", "tin"])).toEqual([
      1, 1, 1, 1,
    ]);
  });

  it("draws every bar in slot 1 where one status-like value sits among others", () => {
    // 🔴 A select that happens to hold "draft" is no status field: pinning that
    // one bar would claim a meaning the field does not have.
    expect(chartSlotsFor(["draft", "gold", "silver"])).toEqual([1, 1, 1]);
  });

  it("counts the group with no value as no status", () => {
    expect(chartSlotsFor(["published", null])).toEqual([1, 1]);
  });

  it("gives nothing for no groups", () => {
    expect(chartSlotsFor([])).toEqual([]);
  });
});

describe("the colour a slot is drawn in", () => {
  it("is the shared token, never a colour of its own", () => {
    expect(chartColour(3)).toBe("var(--nx-chart-3)");
  });
});

describe("the order groups are drawn in", () => {
  it("is by count, highest first, ties by label", () => {
    const ordered = orderGroups(
      [
        { value: "b", label: "Beta", count: 4 },
        { value: "a", label: "Alpha", count: 4 },
        { value: "c", label: "Gamma", count: 9 },
        { value: null, label: "No value", count: 1 },
      ],
      "en"
    );
    expect(ordered.map(group => group.label)).toEqual([
      "Gamma",
      "Alpha",
      "Beta",
      "No value",
    ]);
  });

  it("leaves the groups it was given untouched", () => {
    const given = [
      { value: "a", label: "A", count: 1 },
      { value: "b", label: "B", count: 2 },
    ];
    orderGroups(given, "en");
    expect(given.map(group => group.value)).toEqual(["a", "b"]);
  });
});

describe("ties broken in the card's own locale", () => {
  // Two groups with the same count are ordered by label, compared in the locale the card's
  // numbers are written in. "Äpple" sorts with the A's in English and after "Zebra" in Swedish:
  // a comparison in the runtime's own locale would order them one way for every reader.
  const tied = [
    { value: "z", label: "Zebra", count: 3 },
    { value: "a", label: "Äpple", count: 3 },
  ];

  it("orders tied labels as the given locale does", () => {
    expect(orderGroups(tied, "en").map(group => group.label)).toEqual([
      "Äpple",
      "Zebra",
    ]);
    expect(orderGroups(tied, "sv").map(group => group.label)).toEqual([
      "Zebra",
      "Äpple",
    ]);
  });
});
