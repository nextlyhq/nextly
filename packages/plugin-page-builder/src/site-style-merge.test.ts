/**
 * Merging an author's change to one Site Style section onto a newer stored
 * copy: for each section kind, what a clean merge keeps, how a true conflict
 * is settled and reported, and that an entry no reader can key is kept.
 */
import { describe, expect, it } from "vitest";

import { mergedValue, mergeSiteStyleSection } from "./site-style-merge";

const token = (name: string, light: string, extra: object = {}) => ({
  name,
  kind: "color",
  values: { light },
  ...extra,
});

const brand = token("color.brand", "#111111");
const accent = token("color.accent", "#222222");
const muted = token("color.muted", "#333333");

const card = {
  id: "c1",
  slug: "card",
  orderIndex: 0,
  styles: { base: { desktop: { padding: { top: "4px", left: "4px" } } } },
};
const hero = { id: "c2", slug: "hero", orderIndex: 1, styles: {} };

const face = (family: string, weight: string, url: string) => ({
  family,
  weight,
  src: [{ url, format: "woff2" }],
});
const loraRegular = face("Lora", "400", "/api/media/m1/raw");
const loraBold = face("Lora", "700", "/api/media/m2/raw");
const interRegular = face("Inter", "400", "/api/media/m3/raw");

describe("the leaf rule", () => {
  it("merges a composite side by side, and takes the one side that changed", () => {
    const merged = mergedValue(
      { top: "4px", left: "4px" },
      { top: "8px", left: "4px" },
      { top: "4px", left: "2px" },
      { prefer: "mine" }
    );
    expect(merged).toEqual({ top: "8px", left: "2px" });
  });

  it("settles a value both changed for the side preferred, and says so", () => {
    let conflicts = 0;
    const settle = (prefer: "mine" | "theirs") => ({
      prefer,
      conflict: () => {
        conflicts += 1;
      },
    });
    expect(mergedValue("a", "mine", "theirs", settle("mine"))).toBe("mine");
    expect(mergedValue("a", "mine", "theirs", settle("theirs"))).toBe("theirs");
    expect(conflicts).toBe(2);
  });

  it("reads a record whose keys a database reordered as unchanged", () => {
    let conflicted = false;
    const merged = mergedValue(
      { a: 1, b: { c: 2, d: 3 } },
      { b: { d: 3, c: 2 }, a: 1 },
      { a: 1, b: { c: 2, d: 3 }, e: 4 },
      {
        prefer: "mine",
        conflict: () => {
          conflicted = true;
        },
      }
    );
    expect(merged).toEqual({ a: 1, b: { c: 2, d: 3 }, e: 4 });
    expect(conflicted).toBe(false);
  });
});

describe("a section nobody else saved", () => {
  it("answers mine exactly as it was built when theirs is still the base", () => {
    const mine = { tokens: [brand, accent] };
    const merged = mergeSiteStyleSection(
      "tokens",
      { tokens: [brand] },
      mine,
      { tokens: [brand] },
      "mine"
    );
    expect(merged.value).toBe(mine);
    expect(merged.conflicts).toEqual([]);
  });

  it("answers theirs when mine changed nothing", () => {
    const merged = mergeSiteStyleSection(
      "classes",
      [card],
      [card],
      [card, hero],
      "mine"
    );
    expect(merged.value).toEqual([card, hero]);
  });

  it("reads a section SQLite handed back as text", () => {
    const merged = mergeSiteStyleSection(
      "classes",
      JSON.stringify([card]),
      [card, hero],
      JSON.stringify([card]),
      "mine"
    );
    expect(merged.value).toEqual([card, hero]);
  });
});

describe("merging tokens", () => {
  it("keeps a token they added while mine edited another", () => {
    const edited = token("color.brand", "#999999");
    const merged = mergeSiteStyleSection(
      "tokens",
      { tokens: [brand] },
      { tokens: [edited] },
      { tokens: [brand, accent] },
      "mine"
    );
    expect(merged.value).toEqual({ tokens: [edited, accent] });
    expect(merged.conflicts).toEqual([]);
  });

  it("keeps their edit of one token and mine of another, the other way about", () => {
    const theirBrand = token("color.brand", "#aaaaaa");
    const myAccent = token("color.accent", "#bbbbbb");
    const merged = mergeSiteStyleSection(
      "tokens",
      { tokens: [brand, accent] },
      { tokens: [brand, myAccent] },
      { tokens: [theirBrand, accent] },
      "mine"
    );
    expect(merged.value).toEqual({ tokens: [theirBrand, myAccent] });
  });

  it("keeps mine when both changed one value, and reports it", () => {
    const mine = token("color.brand", "#abcd00");
    const theirs = token("color.brand", "#ef0123");
    const merged = mergeSiteStyleSection(
      "tokens",
      { tokens: [brand] },
      { tokens: [mine] },
      { tokens: [theirs] },
      "mine"
    );
    expect(merged.value).toEqual({ tokens: [mine] });
    expect(merged.conflicts).toEqual([
      {
        key: "color.brand",
        setting: false,
        kind: "changed",
        kept: "mine",
        base: brand,
        mine,
        theirs,
      },
    ]);
  });

  it("yields to theirs on an undo or redo", () => {
    const mine = token("color.brand", "#abcd00");
    const theirs = token("color.brand", "#ef0123");
    const merged = mergeSiteStyleSection(
      "tokens",
      { tokens: [brand] },
      { tokens: [mine] },
      { tokens: [theirs] },
      "theirs"
    );
    expect(merged.value).toEqual({ tokens: [theirs] });
    expect(merged.conflicts).toMatchObject([
      { kind: "changed", kept: "theirs" },
    ]);
  });

  it("merges two edits to different fields of one token without a conflict", () => {
    const mine = { ...brand, label: "Brand" };
    const theirs = token("color.brand", "#ef0123");
    const merged = mergeSiteStyleSection(
      "tokens",
      { tokens: [brand] },
      { tokens: [mine] },
      { tokens: [theirs] },
      "mine"
    );
    expect(merged.value).toEqual({ tokens: [{ ...theirs, label: "Brand" }] });
    expect(merged.conflicts).toEqual([]);
  });

  it("puts back a token they removed while mine changed it", () => {
    const mine = token("color.accent", "#abcdef");
    const merged = mergeSiteStyleSection(
      "tokens",
      { tokens: [brand, accent] },
      { tokens: [brand, mine] },
      { tokens: [brand] },
      "mine"
    );
    expect(merged.value).toEqual({ tokens: [brand, mine] });
    expect(merged.conflicts).toMatchObject([
      { key: "color.accent", kind: "removed-by-them", kept: "mine" },
    ]);
  });

  it("removes a token mine removed while they changed it", () => {
    const theirs = token("color.accent", "#abcdef");
    const merged = mergeSiteStyleSection(
      "tokens",
      { tokens: [brand, accent] },
      { tokens: [brand, muted] },
      { tokens: [brand, theirs] },
      "mine"
    );
    expect(merged.value).toEqual({ tokens: [brand, muted] });
    expect(merged.conflicts).toMatchObject([
      { key: "color.accent", kind: "removed-by-me", kept: "mine" },
    ]);
  });

  it("keeps an entry the token rules cannot read exactly as theirs stored it", () => {
    const unreadable = { kind: "color", values: { light: "#000000" } };
    const merged = mergeSiteStyleSection(
      "tokens",
      { tokens: [brand] },
      { tokens: [brand, accent] },
      { tokens: [unreadable, brand] },
      "mine"
    );
    expect(merged.value).toEqual({ tokens: [unreadable, brand, accent] });
  });

  it("reports a section-wide setting both changed as a setting", () => {
    const merged = mergeSiteStyleSection(
      "tokens",
      { tokens: [brand], prefix: "a" },
      { tokens: [brand], prefix: "mine" },
      { tokens: [brand], prefix: "theirs" },
      "mine"
    );
    expect(merged.value).toEqual({ tokens: [brand], prefix: "mine" });
    expect(merged.conflicts).toMatchObject([
      { key: "prefix", setting: true, kind: "changed", kept: "mine" },
    ]);
  });
});

describe("merging classes", () => {
  it("keeps their lock beside mine padding, with no conflict", () => {
    const mine = {
      ...card,
      styles: { base: { desktop: { padding: { top: "8px", left: "4px" } } } },
    };
    const merged = mergeSiteStyleSection(
      "classes",
      [card, hero],
      [mine, hero],
      [{ ...card, locked: true }, hero],
      "mine"
    );
    expect(merged.value).toEqual([{ ...mine, locked: true }, hero]);
    expect(merged.conflicts).toEqual([]);
  });

  it("keeps a class they added after the ones mine holds, and mine's new one after it", () => {
    const promo = { id: "c3", slug: "promo", orderIndex: 2, styles: {} };
    const merged = mergeSiteStyleSection(
      "classes",
      [card],
      [card, promo],
      [card, hero],
      "mine"
    );
    expect(merged.value).toEqual([card, hero, promo]);
  });

  it("keeps mine where both changed one side of a padding", () => {
    const withTop = (top: string) => ({
      ...card,
      styles: { base: { desktop: { padding: { top, left: "4px" } } } },
    });
    const merged = mergeSiteStyleSection(
      "classes",
      [card],
      [withTop("8px")],
      [withTop("2px")],
      "mine"
    );
    expect(merged.value).toEqual([withTop("8px")]);
    expect(merged.conflicts).toMatchObject([
      { key: "c1", kind: "changed", kept: "mine" },
    ]);
  });

  it("removes a class mine removed while they renamed it, and puts it back for theirs", () => {
    const renamed = { ...hero, label: "Banner" };
    const forward = mergeSiteStyleSection(
      "classes",
      [card, hero],
      [card],
      [card, renamed],
      "mine"
    );
    expect(forward.value).toEqual([card]);
    expect(forward.conflicts).toMatchObject([
      { key: "c2", kind: "removed-by-me", kept: "mine" },
    ]);
    const undo = mergeSiteStyleSection(
      "classes",
      [card, hero],
      [card],
      [card, renamed],
      "theirs"
    );
    expect(undo.value).toEqual([card, renamed]);
  });

  it("keeps an entry with no id where theirs stored it", () => {
    const stray = { slug: "stray", styles: {} };
    const changed = { ...hero, label: "Banner" };
    const merged = mergeSiteStyleSection(
      "classes",
      [card, hero],
      [card, changed],
      [stray, card, hero, { id: "c1", slug: "dupe" }],
      "mine"
    );
    expect(merged.value).toEqual([
      stray,
      card,
      changed,
      { id: "c1", slug: "dupe" },
    ]);
  });
});

describe("merging fonts", () => {
  it("keeps a face they added beside the one mine added", () => {
    const merged = mergeSiteStyleSection(
      "fonts",
      [loraRegular],
      [loraRegular, loraBold],
      [loraRegular, interRegular],
      "mine"
    );
    expect(merged.value).toEqual([loraRegular, interRegular, loraBold]);
    expect(merged.conflicts).toEqual([]);
  });

  it("takes a face as one value: two different files for it conflict", () => {
    const mine = face("Lora", "700", "/api/media/m8/raw");
    const theirs = face("Lora", "700", "/api/media/m9/raw");
    const merged = mergeSiteStyleSection(
      "fonts",
      [loraRegular],
      [loraRegular, mine],
      [loraRegular, theirs],
      "mine"
    );
    expect(merged.value).toEqual([loraRegular, mine]);
    expect(merged.conflicts).toMatchObject([{ kind: "changed", kept: "mine" }]);
  });

  it("removes a face they added to a family mine removed, and reports it", () => {
    const merged = mergeSiteStyleSection(
      "fonts",
      [loraRegular, interRegular],
      [interRegular],
      [loraRegular, interRegular, loraBold],
      "mine"
    );
    expect(merged.value).toEqual([interRegular]);
    expect(merged.conflicts).toMatchObject([
      { kind: "removed-by-me", kept: "mine", theirs: loraBold },
    ]);
  });

  it("keeps a second file mine added for a face already there", () => {
    // Same family, weight and style as the stored face: a second entry of
    // one identity, merged while they changed another family.
    const secondFile = face("Lora", "400", "/api/media/m7/raw");
    const interMoved = face("Inter", "400", "/api/media/m6/raw");
    const merged = mergeSiteStyleSection(
      "fonts",
      [loraRegular, interRegular],
      [loraRegular, interRegular, secondFile],
      [loraRegular, interMoved],
      "mine"
    );
    expect(merged.value).toEqual([loraRegular, interMoved, secondFile]);
    expect(merged.conflicts).toEqual([]);
  });

  it("keeps a face that cannot be keyed exactly as stored", () => {
    const unreadable = { family: 7, src: [] };
    const merged = mergeSiteStyleSection(
      "fonts",
      [loraRegular],
      [loraRegular, loraBold],
      [unreadable, loraRegular],
      "mine"
    );
    expect(merged.value).toEqual([unreadable, loraRegular, loraBold]);
  });
});
