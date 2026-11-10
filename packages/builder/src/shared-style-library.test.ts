/**
 * The Shared styles tab's rules: names and the class names derived from them,
 * the search, and how widely a style is used, in words.
 */
import { BASE_BREAKPOINT, type NamedClass } from "@nextlyhq/blocks-engine";
import { describe, expect, it, vi } from "vitest";

import {
  isUnused,
  sharedStyleUse,
  renameSharedStyle,
  searchSharedStyles,
  sharedStyleDeclares,
  sharedStylePageTile,
  sharedStyleTile,
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
import { contrastOf } from "./style-colour";

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

describe("the tile a row's preview is drawn on", () => {
  // The engine's defaults: white page and near-black text in light mode.
  const tokens = { tokens: [] };

  it("is the site's page, in the mode the canvas shows", () => {
    expect(sharedStylePageTile(tokens, "light")).toEqual({
      backgroundColor: "#ffffff",
      color: "#111827",
    });
    expect(sharedStylePageTile(tokens, "dark")).toEqual({
      backgroundColor: "#0b0f19",
      color: "#f9fafb",
    });
  });

  it("follows a site that changed its page colour", () => {
    const own = {
      tokens: [
        {
          name: "color.background",
          kind: "color" as const,
          values: { light: "#fdf6e3" },
        },
      ],
    };
    expect(sharedStylePageTile(own, "light").backgroundColor).toBe("#fdf6e3");
  });

  it("says nothing without the site's variables, so the neutral tile shows", () => {
    expect(sharedStylePageTile(undefined, "light")).toEqual({});
  });
});

describe("a row's tile in dark mode", () => {
  const tokens = { tokens: [] };
  const LIGHT_PAGE = { backgroundColor: "#ffffff", color: "#111827" };
  const DARK_PAGE = { backgroundColor: "#0b0f19", color: "#f9fafb" };
  const ratio = (fg: string | undefined, bg: string | undefined) =>
    contrastOf(fg, bg, undefined)?.ratio ?? 0;

  it("falls back to the light page, marked, when the style's text is unreadable on the dark one", () => {
    expect(sharedStyleTile(tokens, "dark", { color: "#112233" })).toEqual({
      page: LIGHT_PAGE,
      specimen: { color: "#112233" },
      darkUnreadable: true,
      // It reads on the light page it falls back to.
      outlined: false,
    });
  });

  it("keeps the dark page, unmarked, for a style that reads on it", () => {
    expect(sharedStyleTile(tokens, "dark", { color: "#e5e7eb" })).toEqual({
      page: DARK_PAGE,
      specimen: { color: "#e5e7eb" },
      darkUnreadable: false,
      outlined: false,
    });
    // Its own background keeps dark text readable on the dark page.
    expect(
      sharedStyleTile(tokens, "dark", {
        color: "#112233",
        backgroundColor: "#fef3c7",
      }).darkUnreadable
    ).toBe(false);
  });

  it("gives a white background with no text colour readable text, never a blank square", () => {
    for (const mode of ["light", "dark"] as const) {
      const tile = sharedStyleTile(tokens, mode, {
        backgroundColor: "#ffffff",
      });
      expect(ratio(tile.specimen.color, "#ffffff")).toBeGreaterThanOrEqual(3);
    }
    // A site whose text is light in both modes still gets text that reads:
    // the engine's own colours come after the site's.
    const pale = {
      tokens: [
        {
          name: "color.text",
          kind: "color" as const,
          values: { light: "#fafafa", dark: "#f5f5f5" },
        },
      ],
    };
    for (const mode of ["light", "dark"] as const) {
      const tile = sharedStyleTile(pale, mode, { backgroundColor: "#ffffff" });
      expect(ratio(tile.specimen.color, "#ffffff")).toBeGreaterThanOrEqual(3);
    }
    // Without the site's variables too.
    const plain = sharedStyleTile(undefined, "dark", {
      backgroundColor: "#ffffff",
    });
    expect(ratio(plain.specimen.color, "#ffffff")).toBeGreaterThanOrEqual(3);
  });

  it("marks text that clears 3:1 but not 4.5:1, the bar for small text", () => {
    // Muted grey: about 4:1 on the engine's dark page, faint for 14px text.
    const tile = sharedStyleTile(tokens, "dark", { color: "#6b7280" });
    expect(tile.darkUnreadable).toBe(true);
    expect(tile.page).toEqual(LIGHT_PAGE);
  });

  it("passes over text that clears 3:1 but not 4.5:1 for one that clears 4.5:1", () => {
    // The site's light text is a mid grey: about 3.5:1 on white, enough for
    // large text and not for the small "Aa". Its dark text fails outright,
    // so the engine's light text, past 4.5:1, is the one chosen.
    const grey = {
      tokens: [
        {
          name: "color.text",
          kind: "color" as const,
          values: { light: "#8a8a8a", dark: "#f5f5f5" },
        },
      ],
    };
    expect(ratio("#8a8a8a", "#ffffff")).toBeGreaterThan(3);
    expect(ratio("#8a8a8a", "#ffffff")).toBeLessThan(4.5);
    const tile = sharedStyleTile(grey, "light", { backgroundColor: "#ffffff" });
    expect(tile.specimen.color).toBe("#111827");
    expect(ratio(tile.specimen.color, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("does not count a background it cannot measure as readable", () => {
    // `white` and oklch are valid CSS the contrast verdict cannot read here
    // (no canvas). No text is taken as readable on them: the tile falls back
    // to the light page, marked, and the "Aa" is outlined.
    for (const backgroundColor of ["white", "oklch(0.98 0 0)"]) {
      const tile = sharedStyleTile(tokens, "dark", { backgroundColor });
      expect(tile.darkUnreadable).toBe(true);
      expect(tile.page).toEqual(LIGHT_PAGE);
      expect(tile.outlined).toBe(true);
    }
  });

  it("does not guess two near-identical colours apart by their lightness", () => {
    // 0.59 and 0.60 sit either side of any light/dark line, and read as one.
    const tile = sharedStyleTile(tokens, "light", {
      color: "oklch(0.59 0 0)",
      backgroundColor: "oklch(0.60 0 0)",
    });
    expect(tile.outlined).toBe(true);
  });

  it("outlines in a colour that shows on the style's own background", () => {
    // A site whose page is black, and a style black on black: an outline in
    // the page colour would be black too.
    const black = {
      tokens: [
        {
          name: "color.background",
          kind: "color" as const,
          values: { light: "#000000" },
        },
      ],
    };
    const tile = sharedStyleTile(black, "light", {
      color: "#000000",
      backgroundColor: "#000000",
    });
    expect(tile.outlined).toBe(true);
    const stroke = String(tile.specimen.WebkitTextStroke ?? "");
    const outline = stroke.replace(/^2px /, "");
    expect(ratio(outline, "#000000")).toBeGreaterThanOrEqual(4.5);
  });

  it("gives a background it cannot measure a light and a dark outline", () => {
    const tile = sharedStyleTile(tokens, "light", {
      color: "navy",
      backgroundColor: "navy",
    });
    expect(tile.outlined).toBe(true);
    const shadow = String(tile.specimen.textShadow ?? "");
    expect(shadow).toContain("#111827");
    expect(shadow).toContain("#f9fafb");
    // And no stroke over them: one would hide the inner dark halo, and could
    // itself be the colour of a background it cannot measure. Set inline, so
    // it wins over any stroke a class supplies.
    expect(tile.specimen.WebkitTextStroke).toBe("0");
  });

  it("outlines text it cannot show reads on a colour it cannot measure", () => {
    // No canvas here, so `navy` and hsl() stay unmeasurable: the "Aa" gets an
    // outline in the page colour, visible on any background, rather than
    // risk the same colour as its ground.
    const navy = sharedStyleTile(tokens, "light", { backgroundColor: "navy" });
    expect(navy.outlined).toBe(true);
    expect(navy.specimen.textShadow).toBeDefined();
    const hsl = sharedStyleTile(tokens, "dark", {
      backgroundColor: "hsl(220 60% 20%)",
    });
    expect(hsl.outlined).toBe(true);
    expect(hsl.darkUnreadable).toBe(true);
    // CONTROL: a pair it can measure, and that reads, is not outlined.
    expect(
      sharedStyleTile(tokens, "light", { color: "#112233" }).outlined
    ).toBe(false);
  });

  it("measures a colour the browser can name, through a canvas", () => {
    // A 2D context normalises any colour CSS takes; a fake one stands in for
    // the browser's, knowing `navy`.
    const known: Record<string, string> = {
      "#000": "#000000",
      "#fff": "#ffffff",
      navy: "#000080",
    };
    class FakeCanvas {
      getContext() {
        let fill = "#000000";
        return {
          get fillStyle() {
            return fill;
          },
          set fillStyle(value: string) {
            fill = known[value] ?? fill;
          },
        };
      }
    }
    vi.stubGlobal("OffscreenCanvas", FakeCanvas);
    try {
      const tile = sharedStyleTile(tokens, "light", {
        backgroundColor: "navy",
      });
      expect(tile.specimen.color).toBe("#f9fafb");
      expect(tile.outlined).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("never marks a tile in light mode", () => {
    expect(
      sharedStyleTile(tokens, "light", { color: "#112233" }).darkUnreadable
    ).toBe(false);
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

  it("says what a count counts, with a plus on one that is a floor", () => {
    // A bare number read as uses: 17 blocks on 2 pages read "2". The chip
    // names what it counts, so the number is not taken for blocks.
    const words = (reach: SharedStyleReach) =>
      sharedStyleReachChip(reach).words;
    expect(words(reachOf({ pages: 4 }))).toBe("4 pages");
    expect(words(reachOf({ pages: 1 }))).toBe("1 page");
    expect(words(reachOf({ pages: 4 }, false))).toBe("4+ pages");
    expect(words(reachOf({ pages: 1 }, false))).toBe("1+ pages");
    expect(words(reachOf({ components: 2 }))).toBe("2 components");
    // Several kinds: one total, in a word that covers them; the row's name
    // and hover say each kind.
    expect(words(reachOf({ pages: 4, layouts: 1 }))).toBe("5 places");
    // Nothing used, counted in full: pages, the kind a style is most often on.
    expect(sharedStyleReachChip(reachOf({}))).toEqual({
      words: "0 pages",
      uncounted: false,
    });
  });

  it("says a zero is not counted yet while it is a floor, rather than 0+", () => {
    // "0+ pages" is a number that says nothing: no use found so far, on a
    // site not counted in full. Said as what it is, and marked so the row
    // can mute it.
    expect(sharedStyleReachChip(reachOf({}, false))).toEqual({
      words: "Not counted yet",
      uncounted: true,
    });
    expect(sharedStyleReachChip(reachOf({ pages: 1 }, false)).uncounted).toBe(
      false
    );
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

  it("calls a zero unused only once both counts are complete", () => {
    // A zero while counting is "none counted yet", under neither filter.
    expect(sharedStyleUse(clear, reachOf({}, false))).toBeUndefined();
    expect(
      sharedStyleUse({ count: 0, complete: false }, reachOf({}))
    ).toBeUndefined();
    expect(sharedStyleUse(clear, reachOf({}))).toBe("unused");
    // A counted use is a use however incomplete the rest is.
    expect(sharedStyleUse(clear, reachOf({ pages: 1 }, false))).toBe("used");
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
