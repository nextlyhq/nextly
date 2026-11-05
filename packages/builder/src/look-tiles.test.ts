import type {
  NamedClass,
  NodeStyles,
  SiteTokenSet,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { lookTiles, lookTileStyle, withLook, wornLook } from "./look-tiles";

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

  it("swaps the look and keeps the shared style", () => {
    const looks = [outline, secondary];
    expect(withLook([card.id, outline.id], looks, secondary.id)).toEqual([
      secondary.id,
      card.id,
    ]);
    expect(withLook([card.id, outline.id], looks, null)).toEqual([card.id]);
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

  it("draws the block's own look from its base alone", () => {
    expect(lookTileStyle(base, undefined, tokens, "light")).toEqual(
      expect.objectContaining({ backgroundColor: "#ffffff" })
    );
  });
});
