import {
  MAX_CLASSES_PER_NODE,
  MAX_NAMED_CLASSES,
  type NamedClass,
  type NodeStyles,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import {
  boundLooksOf,
  lookChoice,
  lookLineWords,
  lookTiles,
  lookTileStyle,
  withLook,
  wornLook,
} from "./look-tiles";

const values = (set: Record<string, unknown>): NodeStyles =>
  ({ base: { base: set } }) as unknown as NodeStyles;

const look = (name: string, orderIndex: number, styles: NodeStyles) =>
  ({
    id: `look:core/button:${name}`,
    slug: `button-${name}`,
    label: name[0]?.toUpperCase() + name.slice(1),
    orderIndex,
    blockType: "core/button",
    styles,
  }) as NamedClass;

const outline = look(
  "outline",
  1,
  values({ color: { $token: "color.primary" } })
);
const secondary = look("secondary", 0, values({ color: "#111111" }));
const card = { id: "c-card", slug: "card", orderIndex: 0, styles: {} };
const library = [card, outline, secondary];

describe("a block's look tiles", () => {
  it("are the block's own look, then its type's looks in library order", () => {
    expect(
      lookTiles(library, "core/button", "Primary").map(tile => [
        tile.id,
        tile.name,
      ])
    ).toEqual([
      [null, "Primary"],
      [secondary.id, "Secondary"],
      [outline.id, "Outline"],
    ]);
  });

  it("leave out a look a site's own style holds the name of", () => {
    // The compiler gives the name to the style, so the look never renders and
    // a tile for it would apply nothing.
    const mine = {
      id: "c-mine",
      slug: outline.slug,
      orderIndex: 2,
      styles: {},
    };
    expect(
      lookTiles([...library, mine], "core/button", "Primary").map(
        tile => tile.id
      )
    ).toEqual([null, secondary.id]);
  });

  it("keep the looks a site at its shared-style cap still renders", () => {
    // Looks are read under a cap of their own, so a full library of shared
    // styles leaves every look rendering, and offered.
    const full = Array.from({ length: MAX_NAMED_CLASSES }, (_, index) => ({
      id: `c-${index}`,
      slug: `style-${index}`,
      orderIndex: index,
      styles: {},
    }));
    expect(
      lookTiles([...full, outline, secondary], "core/button", "Primary").map(
        tile => tile.id
      )
    ).toEqual([null, secondary.id, outline.id]);
  });

  it("name a look with a blank label by its slug, as the shared styles list does", () => {
    const blank = { ...secondary, label: "  " };
    expect(
      lookTiles([blank], "core/button", "Primary").map(tile => tile.name)
    ).toEqual(["Primary", "button-secondary"]);
  });

  it("are none for a type with no looks", () => {
    expect(lookTiles(library, "core/text", "Plain")).toEqual([]);
  });
});

describe("wearing a look", () => {
  it("is read from the block's classes, its own look when it wears none", () => {
    const looks = [outline, secondary];
    expect(wornLook([card.id, outline.id], looks)).toBe(outline.id);
    expect(wornLook([card.id], looks)).toBe(null);
  });

  it("ignores a look listed past the classes the engine reads", () => {
    // Past the per-node cap a reference is never applied, so the block wears
    // its own look, and choosing a tile is not taken as already done.
    const filler = Array.from(
      { length: MAX_CLASSES_PER_NODE },
      (_, index) => `c-${index}`
    );
    expect(wornLook([...filler, outline.id], [outline, secondary])).toBeNull();
  });

  it("is the look that wins, when a block lists more than one", () => {
    // Written in library order, so the later one is what the canvas shows,
    // whatever order the block lists them in.
    const looks = [secondary, outline];
    expect(wornLook([outline.id, secondary.id], looks)).toBe(outline.id);
    expect(wornLook([secondary.id, outline.id], looks)).toBe(outline.id);
  });

  it("swaps the look and keeps the shared style", () => {
    const looks = [outline, secondary];
    expect(withLook([card.id, outline.id], looks, secondary.id)).toEqual([
      secondary.id,
      card.id,
    ]);
    expect(withLook([card.id, outline.id], looks, null)).toEqual([card.id]);
  });
});

describe("choosing a tile", () => {
  it("is refused when the block already lists the most classes it can", () => {
    const full = Array.from(
      { length: MAX_CLASSES_PER_NODE },
      (_, index) => `c-${index}`
    );
    expect(lookChoice(full, [outline, secondary], outline.id)).toEqual({
      kind: "full",
    });
  });

  it("never takes off a shared style that holds a look's id", () => {
    // The engine gives the id to the shared style; the look that lost it is
    // not this block's to take off.
    const holder = {
      id: outline.id,
      slug: "holder",
      orderIndex: 0,
      styles: {},
    };
    const library = [holder, outline, secondary];
    const removable = boundLooksOf(library, "core/button");
    expect(removable.map(look => look.id)).toEqual([secondary.id]);
    expect(lookChoice([outline.id], removable, null)).toEqual({
      kind: "unchanged",
    });
  });
});

describe("how a tile draws a look", () => {
  const tokens = {
    tokens: [
      {
        name: "color.primary",
        kind: "color",
        values: { light: "#2563eb", dark: "#60a5fa" },
      },
    ],
  } as unknown as SiteTokenSet;
  const base = values({ backgroundColor: "#ffffff", borderRadius: "8px" });

  it("lays the look over the block's base, its tokens resolved for the mode", () => {
    expect(lookTileStyle(base, outline.styles, tokens, "light")).toMatchObject({
      backgroundColor: "#ffffff",
      color: "#2563eb",
    });
    expect(lookTileStyle(base, outline.styles, tokens, "dark").color).toBe(
      "#60a5fa"
    );
  });

  it("resolves a token by its identity, not a name it no longer answers to", () => {
    // The canvas declares a token under its id, so a look naming the old
    // display name is unresolved there, and the tile must not resolve it.
    const renamed = {
      tokens: [
        {
          id: "brand-ink",
          name: "Brand ink",
          kind: "color",
          values: { light: "#7c3aed", dark: "#a78bfa" },
        },
      ],
    } as unknown as SiteTokenSet;
    const byName = values({ color: { $token: "Brand ink" } });
    const byId = values({ color: { $token: "brand-ink" } });
    expect(
      lookTileStyle(undefined, byName, renamed, "light").color
    ).toBeUndefined();
    expect(lookTileStyle(undefined, byId, renamed, "light").color).toBe(
      "#7c3aed"
    );
  });

  it("draws the block's own look from its base alone", () => {
    expect(lookTileStyle(base, undefined, tokens, "light")).toEqual(
      expect.objectContaining({ backgroundColor: "#ffffff" })
    );
  });
});

describe("a token-built look's tile", () => {
  it("draws its border and colour from the default tokens", () => {
    // Shaped as the core Outline look: a token-coloured hairline.
    const side = "1px";
    const outlineLook = values({
      backgroundColor: "transparent",
      color: { $token: "color.primary" },
      border: {
        width: {
          blockStart: side,
          blockEnd: side,
          inlineStart: side,
          inlineEnd: side,
        },
        style: "solid",
        color: { $token: "color.primary" },
      },
    });
    const tile = lookTileStyle(
      values({ backgroundColor: { $token: "color.primary" } }),
      outlineLook,
      undefined,
      "light"
    );
    expect(tile).toMatchObject({
      backgroundColor: "transparent",
      color: "#2563eb",
      borderStyle: "solid",
      borderBlockStartWidth: "1px",
      borderColor: "#2563eb",
    });
  });
});

describe("a look built from scaled tokens", () => {
  it("draws each token at its factor, as the page compiles it", () => {
    // The page writes `calc(var(--…space-4) * 0.25)`; the tile, which has no
    // variables, writes the token's value at the same factor.
    const side = { $token: "space.4", times: 0.25 };
    const tile = lookTileStyle(
      undefined,
      values({
        border: {
          width: {
            blockStart: side,
            blockEnd: side,
            inlineStart: side,
            inlineEnd: side,
          },
          style: "solid",
        },
      }),
      undefined,
      "light"
    );
    expect(tile.borderBlockStartWidth).toBe("calc(1rem * 0.25)");
  });
});

describe("the bar's line about a worn look", () => {
  it("says an edit here is this block's, and offers the look for every block", () => {
    expect(lookLineWords("Outline", "Button")).toEqual({
      here: "Changes this button only",
      everywhere: "Edit Outline for every button that uses it",
    });
    // No count: what the site knows is an index of documents, not blocks.
    expect(lookLineWords("Circle", "Image").everywhere).not.toMatch(/\d/);
  });
});
