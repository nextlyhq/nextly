/**
 * What colour a chart's groups take.
 *
 * A chart of statuses draws each status in its own status colour, the same on
 * every card, in every order, and beside every status chip. Any other chart of
 * groups draws every bar in slot 1, so arbitrary values never become colour that
 * says nothing; the name beside each bar is what identifies it either way.
 */
import { describe, expect, it } from "vitest";

import {
  chartColour,
  chartMarksFor,
  markColour,
  orderGroups,
} from "../chart-colour";

describe("the marks a chart's groups take", () => {
  it("puts each status on its own status mark in a chart of statuses", () => {
    expect(
      chartMarksFor(["scheduled", "draft", "published", "changes", "archived"])
    ).toEqual(["info", "neutral", "success", "warning", "neutral"]);
  });

  it("does not depend on the order the statuses arrive in", () => {
    // 🔴 The separating case: a palette assigned by position gives the first
    // group colour 1 whatever it is.
    expect(chartMarksFor(["archived", "published", "draft"])).toEqual([
      "neutral",
      "success",
      "neutral",
    ]);
  });

  it("draws every bar of an arbitrary select in slot 1", () => {
    expect(chartMarksFor(["gold", "silver", "bronze", "tin"])).toEqual([
      1, 1, 1, 1,
    ]);
  });

  it("draws every bar in slot 1 where one status-like value sits among others", () => {
    // 🔴 A select that happens to hold "draft" is no status field: marking that
    // one bar would claim a meaning the field does not have.
    expect(chartMarksFor(["draft", "gold", "silver"])).toEqual([1, 1, 1]);
  });

  it("counts the group with no value as no status", () => {
    expect(chartMarksFor(["published", null])).toEqual([1, 1]);
  });

  it("gives nothing for no groups", () => {
    expect(chartMarksFor([])).toEqual([]);
  });
});

describe("the colour a mark is drawn in", () => {
  it("is a slot's shared token, never a colour of its own", () => {
    expect(chartColour(3)).toBe("var(--nx-chart-3)");
    expect(markColour(3)).toBe("var(--nx-chart-3)");
  });

  it("is a status's solid token, never a tinted shade", () => {
    expect(markColour("success")).toBe("var(--nx-success-solid)");
    expect(markColour("warning")).toBe("var(--nx-warning-solid)");
    expect(markColour("info")).toBe("var(--nx-info-solid)");
  });

  it("is the muted ink for a status that marks nothing to act on", () => {
    expect(markColour("neutral")).toBe("var(--nx-muted-foreground)");
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
