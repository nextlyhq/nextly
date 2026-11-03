/**
 * The Shared styles tab's rules: names and the class names derived from them,
 * the search, and how widely a style is used, in words.
 */
import { BASE_BREAKPOINT, type NamedClass } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import {
  isUnused,
  renameSharedStyle,
  searchSharedStyles,
  sharedStyleDeclares,
  sharedStylePreview,
  sharedStyleReachChip,
  sharedStyleReachSentence,
  sharedStyleRemoval,
  sharedStyleRows,
  sharedStyleSearchText,
  sharedStyleSlug,
  SHARED_STYLE_NOT_WHOLE_REMOVAL,
  type SharedStyleReach,
} from "./shared-style-library";

const card: NamedClass = {
  id: "c-card",
  slug: "card",
  label: "Card",
  orderIndex: 0,
  styles: {
    base: { [BASE_BREAKPOINT]: { color: "#112233" } },
    // Set only on hover: still found by its property and value.
    hover: { [BASE_BREAKPOINT]: { padding: { blockStart: "24px" } } },
  },
};
const hero: NamedClass = {
  id: "c-hero",
  slug: "hero-banner",
  orderIndex: 1,
  styles: { base: { [BASE_BREAKPOINT]: { color: { $token: "color.brand" } } } },
};

const NONE = { pages: 0, components: 0, patterns: 0, layouts: 0 };
const reachOf = (
  byKind: Partial<SharedStyleReach["byKind"]>,
  complete = true
): SharedStyleReach => {
  const kinds = { ...NONE, ...byKind };
  return {
    documents: Object.values(kinds).reduce((sum, n) => sum + n, 0),
    byKind: kinds,
    complete,
  };
};

describe("the rows", () => {
  it("names a style by its label, an older one by its slug, and the class the page carries", () => {
    const rows = sharedStyleRows([card, hero], new Set());
    // The class name is the one the compiler emits, prefix included, since
    // that is what hand-written CSS has to select.
    expect(rows.map(row => [row.name, row.className])).toEqual([
      ["Card", ".nx-c-card"],
      ["hero-banner", ".nx-c-hero-banner"],
    ]);
  });

  it("marks a locked style and one the site's code supplies", () => {
    const rows = sharedStyleRows(
      [{ ...card, locked: true }, hero],
      new Set(["c-hero"])
    );
    expect(rows.map(row => [row.locked, row.inCode])).toEqual([
      [true, false],
      [false, true],
    ]);
  });
});

describe("a name and the class name it gives", () => {
  it("derives a class name from the name", () => {
    expect(sharedStyleSlug("Primary button")).toBe("primary-button");
    expect(sharedStyleSlug("  Café  card!! ")).toBe("cafe-card");
  });

  it("starts with a letter, as a class name must", () => {
    expect(sharedStyleSlug("2 columns")).toBe("style-2-columns");
  });

  it("gives nothing for a name with no letter or digit", () => {
    expect(sharedStyleSlug("!!!")).toBe("");
  });

  it("renames to the label typed and the class name derived from it", () => {
    expect(renameSharedStyle(" Promo card ", "c-card", [card, hero])).toEqual({
      ok: true,
      label: "Promo card",
      slug: "promo-card",
    });
  });

  it("keeps a style's own class name without calling it taken", () => {
    expect(renameSharedStyle("CARD", "c-card", [card, hero])).toEqual({
      ok: true,
      label: "CARD",
      slug: "card",
    });
  });

  it("refuses a class name another style has", () => {
    expect(renameSharedStyle("Hero banner", "c-card", [card, hero])).toEqual({
      ok: false,
      reason: "“hero-banner” is already a shared style. Choose another name.",
    });
  });

  it("refuses an empty name and one that gives no class name", () => {
    expect(renameSharedStyle("  ", "c-card", [card])).toMatchObject({
      ok: false,
      reason: "A shared style needs a name.",
    });
    expect(renameSharedStyle("***", "c-card", [card])).toMatchObject({
      ok: false,
      reason: "Use at least one letter or digit in the name.",
    });
  });
});

describe("the search", () => {
  const rows = sharedStyleRows([card, hero], new Set());
  const find = (query: string) =>
    searchSharedStyles(rows, query, row => sharedStyleSearchText(row)).map(
      row => row.id
    );

  it("finds a style by its name and by its class name", () => {
    expect(find("card")).toEqual(["c-card"]);
    expect(find("hero banner")).toEqual(["c-hero"]);
    expect(find(".hero-banner")).toEqual(["c-hero"]);
  });

  it("finds a style by a property it sets only in another state", () => {
    expect(find("padding")).toEqual(["c-card"]);
    expect(find("padding block start")).toEqual(["c-card"]);
  });

  it("finds a style by a value, and by a variable's name", () => {
    expect(find("24px")).toEqual(["c-card"]);
    expect(find("#112233")).toEqual(["c-card"]);
    expect(find("color.brand")).toEqual(["c-hero"]);
  });

  it("finds nothing for what no style holds, and everything for no query", () => {
    expect(find("margin")).toEqual([]);
    expect(find("  ")).toEqual(["c-card", "c-hero"]);
  });
});

describe("what a style declares", () => {
  it("lists the base declarations and counts the rest", () => {
    expect(sharedStyleDeclares(card.styles)).toEqual({
      lines: ["color: #112233"],
      elsewhere: 1,
    });
  });
});

describe("the row's preview", () => {
  it("draws the colours a style sets, and leaves out a variable it reads", () => {
    expect(sharedStylePreview(card.styles)).toEqual({ color: "#112233" });
    expect(sharedStylePreview(hero.styles)).toEqual({});
  });
});

describe("how widely a style is used, in words", () => {
  it("says blocks on this page and documents by kind", () => {
    expect(
      sharedStyleReachSentence(
        { count: 3, complete: true },
        reachOf({ pages: 4, components: 1 })
      )
    ).toBe("3 blocks on this page · on 4 pages and 1 component");
  });

  it("says at least while some pages are still being counted", () => {
    expect(
      sharedStyleReachSentence(
        { count: 1, complete: true },
        reachOf({ pages: 4, patterns: 2, layouts: 1 }, false)
      )
    ).toBe(
      "1 block on this page · on at least 4 pages, 2 patterns and 1 layout"
    );
  });

  it("says at least for blocks when the page could not all be read", () => {
    expect(
      sharedStyleReachSentence({ count: 2, complete: false }, undefined)
    ).toBe("At least 2 blocks on this page");
  });

  it("says when nothing uses it, and when none have been counted yet", () => {
    expect(
      sharedStyleReachSentence({ count: 0, complete: true }, reachOf({}))
    ).toBe("Not used anywhere");
    expect(
      sharedStyleReachSentence({ count: 0, complete: true }, reachOf({}, false))
    ).toBe("No uses counted yet");
  });

  it("puts a plus on a count that is a floor", () => {
    expect(sharedStyleReachChip(reachOf({ pages: 4 }))).toBe("4");
    expect(sharedStyleReachChip(reachOf({ pages: 4 }, false))).toBe("4+");
  });
});

describe("removing one style", () => {
  const free = { locked: false, inCode: false };
  const clear = { count: 0, complete: true };

  it("is offered only for an unused style once every page is counted", () => {
    expect(sharedStyleRemoval(free, clear, reachOf({}), true)).toEqual({
      kind: "removable",
    });
  });

  it("is refused in the route's words while pages are being counted", () => {
    expect(sharedStyleRemoval(free, clear, reachOf({}, false), false)).toEqual({
      kind: "refused",
      reason: SHARED_STYLE_NOT_WHOLE_REMOVAL,
    });
  });

  it("counts a block on the open page as a use", () => {
    expect(
      sharedStyleRemoval(free, { count: 1, complete: true }, reachOf({}), true)
        .kind
    ).toBe("refused");
    expect(isUnused({ count: 0, complete: false }, reachOf({}))).toBe(false);
  });

  it("says nothing of its own for a locked style or one in code", () => {
    expect(
      sharedStyleRemoval({ ...free, locked: true }, clear, reachOf({}), true)
    ).toEqual({ kind: "quiet" });
    expect(
      sharedStyleRemoval({ ...free, inCode: true }, clear, reachOf({}), true)
    ).toEqual({ kind: "quiet" });
  });
});
