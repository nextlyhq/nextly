/**
 * A standalone plugin panel's numbers: whether a plugin declares any, and
 * each item's number read back from the server's answer by its place among
 * the published items.
 */
import { describe, expect, it } from "vitest";

import type { PluginMenuItemMeta } from "@admin/types/branding";

import {
  declaresNumbers,
  itemNumberSpoken,
  itemNumberText,
  panelNumbersByPlace,
  panelPlaceOf,
  withPanelPlaces,
} from "../panel-counts";
import { panelItemsByGroup } from "../panel-groups";

const item = (
  label: string,
  extra: Partial<PluginMenuItemMeta> = {}
): PluginMenuItemMeta => ({ label, to: `/admin/x/${label}`, ...extra });

describe("declaresNumbers", () => {
  it("is true only where an item declares a count or a badge", () => {
    expect(declaresNumbers(undefined)).toBe(false);
    expect(declaresNumbers([item("a"), item("b", { group: "g" })])).toBe(false);
    expect(
      declaresNumbers([item("a"), item("b", { count: { collection: "c" } })])
    ).toBe(true);
    expect(declaresNumbers([item("a", { badge: { attention: "x" } })])).toBe(
      true
    );
  });
});

describe("panelNumbersByPlace", () => {
  const menu = [
    item("Plain"),
    item("Patterns", { count: { collection: "patterns" } }),
    item("Fix", { badge: { attention: "acme/fix" } }),
  ];

  it("files each number under its item's place", () => {
    const numbers = panelNumbersByPlace(menu, {
      numbers: [
        { index: 1, value: 0, atLeast: false },
        { index: 2, value: 99, atLeast: true },
      ],
    });
    expect([...numbers]).toEqual([
      [1, { value: 0, atLeast: false }],
      [2, { value: 99, atLeast: true }],
    ]);
  });

  it("marks each item with its place, and the mark survives a copy", () => {
    const marked = withPanelPlaces(menu);
    expect(marked.map(panelPlaceOf)).toEqual([0, 1, 2]);
    expect(panelPlaceOf({ ...marked[2], children: [] })).toBe(2);
    expect(panelPlaceOf(menu[0])).toBeUndefined();
  });

  it("drops an entry that is not a number, or whose item declares none", () => {
    const numbers = panelNumbersByPlace(menu, {
      numbers: [
        { index: 0, value: 4, atLeast: false },
        { index: 9, value: 4, atLeast: false },
        { index: 1, value: -1, atLeast: false },
        { index: 2, value: "3" },
        null,
      ],
    });
    expect(numbers.size).toBe(0);
    expect(panelNumbersByPlace(menu, null).size).toBe(0);
    expect(panelNumbersByPlace(menu, { numbers: "x" }).size).toBe(0);
  });

  it("draws and speaks a floor as one", () => {
    expect(itemNumberText({ value: 99, atLeast: true })).toBe("99+");
    expect(itemNumberSpoken({ value: 99, atLeast: true })).toBe("99 or more");
    expect(itemNumberText({ value: 0, atLeast: false })).toBe("0");
  });
});

describe("panelItemsByGroup", () => {
  it("lists ungrouped items first, then each group with items in declared order", () => {
    const split = panelItemsByGroup(
      [
        item("a", { group: "checks" }),
        item("b"),
        item("c", { group: "library" }),
        item("d", { group: "unknown" }),
        item("e", { group: "library" }),
      ],
      [
        { id: "library", label: "Library" },
        { id: "empty", label: "Empty" },
        { id: "checks", label: "Checks" },
      ]
    );
    expect(split.ungrouped.map(i => i.label)).toEqual(["b", "d"]);
    expect(split.groups.map(g => [g.label, g.items.map(i => i.label)])).toEqual(
      [
        ["Library", ["c", "e"]],
        ["Checks", ["a"]],
      ]
    );
  });
});
