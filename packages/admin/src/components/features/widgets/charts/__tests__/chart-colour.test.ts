/**
 * Which of the five shared chart colours a category takes.
 *
 * By the category's STORED value, never its position or its label, so one
 * value has one colour on every card, in every order, in every language.
 * Status values sit on fixed slots; any other value takes one by a stable
 * hash. With more categories than slots, colours repeat (five colours cannot
 * name fifty groups), and the name beside each bar is what identifies it.
 */
import { describe, expect, it } from "vitest";

import { chartColour, chartSlotFor, orderGroups } from "../chart-colour";

describe("the slot a value takes", () => {
  it("puts the status values on their fixed slots", () => {
    expect(chartSlotFor("scheduled")).toBe(1);
    expect(chartSlotFor("draft")).toBe(2);
    expect(chartSlotFor("published")).toBe(3);
    expect(chartSlotFor("changes")).toBe(4);
    expect(chartSlotFor("archived")).toBe(5);
  });

  it("gives any other value the same slot every time, from the value alone", () => {
    const slot = chartSlotFor("enterprise");
    expect([1, 2, 3, 4]).toContain(slot);
    for (let i = 0; i < 5; i += 1)
      expect(chartSlotFor("enterprise")).toBe(slot);
  });

  it("does not depend on the order the values arrive in", () => {
    // 🔴 The separating case: a palette assigned by position gives the first
    // group colour 1 whatever it is.
    const values = ["gold", "silver", "bronze", "tin"];
    const forward = values.map(chartSlotFor);
    const backward = [...values].reverse().map(chartSlotFor).reverse();
    expect(backward).toEqual(forward);
  });

  it("is pinned, so a release cannot quietly recolour every site's charts", () => {
    // The hash is part of the contract: changing it moves every category.
    expect(
      ["gold", "silver", "bronze", "tin", "", "Ünïcode"].map(chartSlotFor)
    ).toEqual(PINNED);
  });

  it("spreads other values across slots 1 to 4, never the alarm-red 5", () => {
    // 🔴 Slot 5 is red, the theme's error hue; only archived, a status, sits there.
    const seen = new Set(
      Array.from({ length: 200 }, (_, i) => chartSlotFor(`value-${i}`))
    );
    expect([...seen].sort()).toEqual([1, 2, 3, 4]);
  });

  it("gives the empty group (no value) a slot like any other value", () => {
    expect(chartSlotFor(null)).toBe(chartSlotFor(""));
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

/** The slots the six values above take, recorded from the hash as written. */
const PINNED = [4, 1, 2, 1, 2, 2];

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
