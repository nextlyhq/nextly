/**
 * The site's colours in named groups and in the order its authors put them,
 * and the moves that change either: display only, so no code name, value or
 * line of the site's CSS changes with them.
 */
import {
  emitTokenBlocks,
  resolveSiteTokens,
  type SiteToken,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import {
  colourGroups,
  colourOrder,
  moveColour,
  moveColourToGroup,
  placeColour,
  removeColourGroup,
  renameColourGroup,
} from "./colour-groups";

const colour = (name: string, group?: string): SiteToken => ({
  name,
  kind: "color",
  values: { light: "#000000" },
  ...(group === undefined ? {} : { group }),
});

const SET: SiteTokenSet = {
  tokens: [
    colour("color.primary", "Brand"),
    colour("color.accent", "Brand"),
    { name: "space.4", kind: "dimension", values: { light: "1rem" } },
    colour("color.text", "Text and surfaces"),
    colour("color.muted"),
    colour("color.border", "Text and surfaces"),
  ],
};

/** The groups as `name: identities`, the shape the panel draws. */
const shape = (set: SiteTokenSet) =>
  colourGroups(set).map(
    group => `${group.name}: ${group.identities.join(" ")}`
  );

describe("the colours' groups and order", () => {
  it("lists colours in the set's order, under their groups, a colour with none in the group before it", () => {
    expect(shape(SET)).toEqual([
      "Brand: color.primary color.accent",
      "Text and surfaces: color.text color.muted color.border",
    ]);
  });

  it("lists the colours an order names first, in that order, then the rest, each in its group", () => {
    const ordered = {
      ...SET,
      order: ["color.text", "color.gone", "color.primary"],
    };
    expect(shape(ordered)).toEqual([
      "Text and surfaces: color.text color.border",
      "Brand: color.primary color.accent color.muted",
    ]);
    // The flat order is the groups' order: what the pickers list is what
    // the panel draws.
    expect(colourOrder(ordered)).toEqual([
      "color.text",
      "color.border",
      "color.primary",
      "color.accent",
      "color.muted",
    ]);
  });

  it("lists a colour the order misses where its group does, in the pickers too", () => {
    const set: SiteTokenSet = {
      tokens: [
        colour("color.accent", "Accents"),
        colour("color.brand", "Brand"),
        colour("color.brand-copy", "Brand"),
        colour("color.text", "Text"),
      ],
      order: ["color.accent", "color.brand", "color.text"],
    };
    expect(shape(set)).toEqual([
      "Accents: color.accent",
      "Brand: color.brand color.brand-copy",
      "Text: color.text",
    ]);
    expect(colourOrder(set)).toEqual([
      "color.accent",
      "color.brand",
      "color.brand-copy",
      "color.text",
    ]);
  });

  it("starts a new site with Brand, then Text and surfaces", () => {
    expect(colourGroups(resolveSiteTokens()).map(group => group.name)).toEqual([
      "Brand",
      "Text and surfaces",
    ]);
  });

  it("calls the group of a colour with none before it Colours", () => {
    expect(shape({ tokens: [colour("color.a"), colour("color.b")] })).toEqual([
      "Colours: color.a color.b",
    ]);
  });
});

describe("moving a colour", () => {
  it("moves up and down within its group", () => {
    expect(shape(moveColour(SET, "color.border", -1))).toEqual([
      "Brand: color.primary color.accent",
      "Text and surfaces: color.text color.border color.muted",
    ]);
  });

  it("past the top of its group, joins the end of the group above", () => {
    expect(shape(moveColour(SET, "color.text", -1))).toEqual([
      "Brand: color.primary color.accent color.text",
      "Text and surfaces: color.muted color.border",
    ]);
  });

  it("past the end of its group, joins the start of the group below", () => {
    expect(shape(moveColour(SET, "color.accent", 1))).toEqual([
      "Brand: color.primary",
      "Text and surfaces: color.accent color.text color.muted color.border",
    ]);
  });

  it("stays where it is at the very top and the very end", () => {
    expect(moveColour(SET, "color.primary", -1)).toBe(SET);
    expect(moveColour(SET, "color.border", 1)).toBe(SET);
  });

  it("goes to the end of another group", () => {
    expect(
      shape(moveColourToGroup(SET, "color.primary", "Text and surfaces"))
    ).toEqual([
      "Brand: color.accent",
      "Text and surfaces: color.text color.muted color.border color.primary",
    ]);
  });

  it("keeps a colour that inherits its group in that group when one before it moves", () => {
    // color.muted has no group of its own; it reads its group from the colour
    // before it, so a move writes the group it was shown in.
    const moved = moveColour(SET, "color.text", -1);
    expect(
      moved.tokens.find(token => token.name === "color.muted")?.group
    ).toBe("Text and surfaces");
  });
});

describe("placing a colour, as a drag drops it", () => {
  it("drops before another colour, in that colour's group", () => {
    expect(
      shape(placeColour(SET, "color.border", "Brand", "color.accent"))
    ).toEqual([
      "Brand: color.primary color.border color.accent",
      "Text and surfaces: color.text color.muted",
    ]);
  });

  it("drops at the end of a group where no colour is under the pointer", () => {
    expect(shape(placeColour(SET, "color.text", "Brand", undefined))).toEqual([
      "Brand: color.primary color.accent color.text",
      "Text and surfaces: color.muted color.border",
    ]);
  });

  it("drops into a group no colour is in yet", () => {
    expect(shape(placeColour(SET, "color.text", "Accents", undefined))).toEqual(
      [
        "Brand: color.primary color.accent",
        "Text and surfaces: color.muted color.border",
        "Accents: color.text",
      ]
    );
  });

  it("leaves the set as it was where the colour is dropped on itself", () => {
    expect(
      placeColour(SET, "color.text", "Text and surfaces", "color.text")
    ).toBe(SET);
  });
});

describe("renaming and removing a group", () => {
  it("renames a group on every colour in it", () => {
    expect(shape(renameColourGroup(SET, "Brand", "Accents"))).toEqual([
      "Accents: color.primary color.accent",
      "Text and surfaces: color.text color.muted color.border",
    ]);
  });

  it("removes a group, its colours joining the group above", () => {
    expect(shape(removeColourGroup(SET, "Text and surfaces"))).toEqual([
      "Brand: color.primary color.accent color.text color.muted color.border",
    ]);
  });

  it("removes the first group, its colours joining the group below", () => {
    expect(shape(removeColourGroup(SET, "Brand"))).toEqual([
      "Text and surfaces: color.primary color.accent color.text color.muted color.border",
    ]);
  });

  it("leaves the only group in place", () => {
    const one: SiteTokenSet = { tokens: [colour("color.a", "Only")] };
    expect(removeColourGroup(one, "Only")).toBe(one);
  });
});

describe("display only", () => {
  it("writes the same site CSS, byte for byte, before and after every move", () => {
    const before = emitTokenBlocks(SET, ":root").css;
    for (const after of [
      moveColour(SET, "color.text", -1),
      moveColourToGroup(SET, "color.primary", "Text and surfaces"),
      renameColourGroup(SET, "Brand", "Accents"),
      removeColourGroup(SET, "Brand"),
    ]) {
      expect(emitTokenBlocks(after, ":root").css).toBe(before);
      expect(after.tokens.map(token => token.name)).toEqual(
        SET.tokens.map(token => token.name)
      );
    }
  });
});
