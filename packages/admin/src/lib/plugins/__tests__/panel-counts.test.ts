/**
 * A standalone plugin panel's numbers: the one batch that asks for them, and
 * each item's number read back from its answer.
 */
import { MAX_QUERIES_PER_REQUEST } from "nextly/config";
import { describe, expect, it } from "vitest";

import type { PluginMenuItemMeta } from "@admin/types/branding";

import { panelCountQueries, panelItemNumbers } from "../panel-counts";
import { panelItemsByGroup } from "../panel-groups";

const item = (
  label: string,
  extra: Partial<PluginMenuItemMeta> = {}
): PluginMenuItemMeta => ({ label, to: `/admin/x/${label}`, ...extra });

const count = (total: number) => ({ ok: true, result: { op: "count", total } });
const digest = (items: unknown[]) => ({
  ok: true,
  result: { op: "list", items, total: items.length },
});

describe("panelCountQueries", () => {
  it("asks for nothing when no item shows a number", () => {
    expect(panelCountQueries([item("a"), item("b")])).toEqual([]);
  });

  it("asks each collection count once, and the digest once, first", () => {
    const where = { status: { equals: "draft" } };
    const queries = panelCountQueries([
      item("a", { count: { collection: "patterns" } }),
      item("b", { badge: { collection: "patterns" } }),
      item("c", { count: { collection: "patterns", where } }),
      item("d", { badge: { attention: "acme/one" } }),
      item("e", { badge: { attention: "acme/two" } }),
    ]);
    expect(queries).toEqual([
      { source: "system:attention", op: "list", limit: 50 },
      { source: "collection:patterns", op: "count" },
      { source: "collection:patterns", op: "count", where },
    ]);
  });

  it("asks no more than one request carries", () => {
    const many = Array.from({ length: MAX_QUERIES_PER_REQUEST + 5 }, (_, i) =>
      item(`c${i}`, { count: { collection: `c${i}` } })
    );
    expect(panelCountQueries(many)).toHaveLength(MAX_QUERIES_PER_REQUEST);
  });
});

describe("panelItemNumbers", () => {
  const items = [
    item("Patterns", { count: { collection: "patterns" } }),
    item("Layouts", { count: { collection: "layouts" } }),
    item("Fix", { badge: { attention: "acme/fix" } }),
    item("Quiet", { badge: { attention: "acme/quiet" } }),
    item("Broken", { badge: { attention: "acme/broken" } }),
    item("Plain"),
  ];
  const queries = panelCountQueries(items);

  it("reads each item's number by the query that answers it", () => {
    const numbers = panelItemNumbers(items, queries, [
      digest([
        { id: "acme/fix", label: "Fix", count: 99, atLeast: true },
        { id: "acme/broken", label: "Broken", count: 0, failed: true },
      ]),
      count(12),
      count(0),
    ]);
    expect(numbers.get("/admin/x/Patterns")).toEqual({
      value: 12,
      atLeast: false,
    });
    // Zero is a number: a quiet count shows it.
    expect(numbers.get("/admin/x/Layouts")).toEqual({
      value: 0,
      atLeast: false,
    });
    expect(numbers.get("/admin/x/Fix")).toEqual({ value: 99, atLeast: true });
    // Left out of the digest: nothing is waiting for this reader.
    expect(numbers.get("/admin/x/Quiet")).toEqual({ value: 0, atLeast: false });
    // A count that failed has no number, rather than a 0 that claims one.
    expect(numbers.has("/admin/x/Broken")).toBe(false);
    expect(numbers.has("/admin/x/Plain")).toBe(false);
  });

  it("gives a failed or refused slot no number", () => {
    const numbers = panelItemNumbers(items, queries, [
      { ok: false, error: "unavailable", code: "unavailable" },
      { ok: false, error: "unavailable", code: "unavailable" },
      count(3),
    ]);
    expect(numbers.has("/admin/x/Patterns")).toBe(false);
    expect(numbers.has("/admin/x/Fix")).toBe(false);
    expect(numbers.has("/admin/x/Quiet")).toBe(false);
    expect(numbers.get("/admin/x/Layouts")).toEqual({
      value: 3,
      atLeast: false,
    });
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
