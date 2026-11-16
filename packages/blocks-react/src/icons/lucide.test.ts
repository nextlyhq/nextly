/**
 * The vendored Lucide set: which release it is, and that an id resolves to
 * the icon it names, a renamed one included.
 *
 * @module lucide.test
 */
import { describe, expect, it } from "vitest";

import {
  lucideVersion,
  parseIconId,
  resolveLucideIcon,
  searchLucideIcons,
} from "./lucide";

describe("the vendored Lucide set", () => {
  it("is the pinned release, so a change to it is a deliberate one", async () => {
    expect(await lucideVersion()).toBe("1.60.0");
  });

  it("resolves an id to the icon's SVG body and box", async () => {
    const star = await resolveLucideIcon("lucide:star");
    expect(star?.name).toBe("star");
    expect(star?.viewBox).toBe("0 0 24 24");
    expect(star?.body).toMatch(/^<(path|polygon|circle|rect|line|polyline)/);
  });

  it("resolves a renamed icon to the icon it is now", async () => {
    // `activity-square` is Lucide's earlier name for `square-activity`.
    const renamed = await resolveLucideIcon("lucide:activity-square");
    expect(renamed?.name).toBe("square-activity");
    expect(renamed?.id).toBe("lucide:square-activity");
    expect(renamed?.body).toBe(
      (await resolveLucideIcon("lucide:square-activity"))?.body
    );
  });

  it("resolves nothing it does not have, whatever the id looks like", async () => {
    for (const id of [
      "lucide:not-an-icon",
      "other:star",
      "star",
      "lucide:",
      "LUCIDE:STAR",
      // A name spelled like an inherited property is not an icon.
      "lucide:constructor",
    ]) {
      expect(await resolveLucideIcon(id)).toBeNull();
    }
  });

  it("reads an id as its set and name", () => {
    expect(parseIconId("lucide:circle-arrow-up")).toEqual({
      set: "lucide",
      name: "circle-arrow-up",
    });
    expect(parseIconId("lucide star")).toBeNull();
  });
});

describe("searching the Lucide set", () => {
  const names = async (query: string, limit?: number): Promise<string[]> =>
    (await searchLucideIcons(query, limit)).map(icon => icon.name);

  it("puts the icon a query names first, then names it starts, then tags", async () => {
    const found = await names("bookmark");
    expect(found[0]).toBe("bookmark");
    // `star` is tagged `bookmark` and has the shorter name, so an order by
    // length alone would put it ahead of `bookmark-check`, a name match.
    expect(found).toContain("star");
    expect(found.indexOf("bookmark-check")).toBeGreaterThan(0);
    expect(found.indexOf("bookmark-check")).toBeLessThan(found.indexOf("star"));
    // A word inside a name comes after the names that start with the query.
    expect(found.indexOf("bookmark-check")).toBeLessThan(
      found.indexOf("folder-bookmark")
    );
  });

  it("finds an icon by a word Lucide tags it with", async () => {
    // `truck` is tagged `delivery`; nothing is named for it.
    expect(await names("delivery")).toContain("truck");
  });

  it("answers a renamed icon's former name with the icon it is now", async () => {
    // `activity-square` is Lucide's earlier name for `square-activity`.
    const [first] = await searchLucideIcons("activity-square");
    expect(first?.name).toBe("square-activity");
    expect(first?.id).toBe("lucide:square-activity");
  });

  it("ranks a former name's word, then a tag, then a tag's word, then a name's middle", async () => {
    const found = await names("table");
    // `columns-3-cog` was named `table-config`; `sheet` is tagged `table`;
    // `pill` is tagged `tablet`; `turntable` has `table` inside a word. Each
    // name is longer than the next one's, so a tie on rank would order them
    // the other way round.
    const order = ["columns-3-cog", "sheet", "pill", "turntable"];
    const places = order.map(name => found.indexOf(name));
    expect(places.every(place => place >= 0)).toBe(true);
    expect([...places].sort((a, b) => a - b)).toEqual(places);
  });

  it("reads spaces and capitals as a name's hyphens and lower case", async () => {
    expect((await names("Arrow up"))[0]).toBe("arrow-up");
  });

  it("matches several words when each starts a word of the icon", async () => {
    // Not a substring of the name: `circle` and `out` are words apart.
    expect(await names("circle out")).toContain("circle-arrow-out-up-right");
  });

  it("lists the whole set in name order for an empty query", async () => {
    const all = await names("  ");
    expect(all.length).toBeGreaterThan(1500);
    expect(all).toEqual([...all].sort());
    expect(new Set(all).size).toBe(all.length);
  });

  it("returns at most the limit, each icon drawable and with its tags", async () => {
    const found = await searchLucideIcons("arrow", 5);
    expect(found).toHaveLength(5);
    for (const icon of found) {
      expect(icon.id).toBe(`lucide:${icon.name}`);
      expect(icon.viewBox).toBe("0 0 24 24");
      expect(icon.body).toMatch(
        /^<(path|polygon|circle|rect|line|polyline|ellipse)/
      );
      expect(Array.isArray(icon.tags)).toBe(true);
    }
    expect((await searchLucideIcons("truck", 1))[0]?.tags).toContain(
      "delivery"
    );
  });

  it("finds nothing for a query no icon matches", async () => {
    expect(await searchLucideIcons("zzzz-not-an-icon")).toEqual([]);
  });
});
