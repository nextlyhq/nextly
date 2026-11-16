/**
 * The Style tab's arrangement, held to the catalog it arranges.
 *
 * The table in `inspector-sections.ts` is the first release's placement
 * catalogue. These cases are what keep it complete as the engine's catalog
 * grows: every property placed once, nothing placed that does not exist, and
 * the two properties the old "Advanced" style section held sitting where the
 * catalogue now puts them.
 */
import { STYLE_CATALOG } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import {
  INSPECTOR_SECTIONS,
  placementOf,
  tierShows,
  type TierContext,
} from "./inspector-sections";

const placed = INSPECTOR_SECTIONS.flatMap(section =>
  section.properties.map(([property]) => property)
);

describe("the placement table", () => {
  it("orders the sections Icon, Layout, Spacing, Size, Position, Typography, Background, Border, Effects", () => {
    // Icon first, shown only by a block offering it: an Accordion.
    expect(INSPECTOR_SECTIONS.map(section => section.label)).toEqual([
      "Icon",
      "Layout",
      "Spacing",
      "Size",
      "Position",
      "Typography",
      "Background",
      "Border",
      "Effects",
    ]);
  });

  it("names no style section Advanced", () => {
    expect(INSPECTOR_SECTIONS.map(section => section.label)).not.toContain(
      "Advanced"
    );
  });

  it("places every catalog property exactly once", () => {
    const catalog = STYLE_CATALOG.map(entry => entry.property);
    // The positive control: the catalog is the one the engine ships.
    expect(catalog.length).toBeGreaterThan(40);
    const twice = placed.filter(
      (property, index) => placed.indexOf(property) !== index
    );
    expect(twice).toEqual([]);
    expect([...placed].sort()).toEqual([...catalog].sort());
  });

  it("puts the container query behind Layout's More and box sizing behind Size's", () => {
    expect(placementOf("containerType", "container")).toMatchObject({
      section: "layout",
      tier: "more",
    });
    expect(placementOf("boxSizing", "layout")).toMatchObject({
      section: "size",
      tier: "more",
    });
  });

  it("puts colour and list in Typography and shadow in Effects", () => {
    expect(placementOf("color", "color").section).toBe("typography");
    expect(placementOf("linkColor", "color").section).toBe("typography");
    expect(placementOf("listStyleType", "list").section).toBe("typography");
    expect(placementOf("boxShadow", "shadow").section).toBe("effects");
  });

  it("places a property the table has not met yet behind More, by its engine group", () => {
    const fresh = placementOf("acmeNewProperty", "shadow");
    expect(fresh).toMatchObject({ section: "effects", tier: "more" });
    // After every property the table places in that section.
    const effects = INSPECTOR_SECTIONS.find(
      section => section.key === "effects"
    );
    for (const [property] of effects?.properties ?? []) {
      expect(placementOf(property, "effects").order).toBeLessThan(fresh.order);
    }
  });
});

describe("which tier shows without being asked", () => {
  const plain: TierContext = { state: "base" };

  it("shows common always and more never", () => {
    expect(tierShows("common", plain)).toBe(true);
    expect(tierShows("more", plain)).toBe(false);
  });

  it("keeps no tier of its own for flex, grid or media", () => {
    // Whether a property has an effect is the engine's `applies`; a tier
    // that also answered it would be a second answer, free to disagree.
    const tiers = new Set(
      INSPECTOR_SECTIONS.flatMap(section =>
        section.properties.map(([, tier]) => tier)
      )
    );
    expect([...tiers].sort()).toEqual([
      "common",
      "common-on-media",
      "icon-drawn",
      "more",
      "state",
    ]);
  });

  it("makes every Layout and Size property that depends on the block common", () => {
    // They show where they apply and nowhere else, so none needs More to
    // stay out of a block it does nothing for.
    for (const property of [
      "flexDirection",
      "flexWrap",
      "justifyContent",
      "alignItems",
      "gap",
      "gridTemplateColumns",
      "gridTemplateRows",
      "objectFit",
      "objectPosition",
      "flexGrow",
      "flexShrink",
      "flexBasis",
      "alignSelf",
      "justifySelf",
      "order",
    ]) {
      expect(placementOf(property, "layout").tier, property).toBe("common");
    }
    expect(placementOf("justifyItems", "layout").tier).toBe("more");
  });

  it("puts an image's fit and focal point first in Size, a child's share after its size", () => {
    // What an author changes first on an image is how it fills its box.
    const order = (property: string) =>
      placementOf(property, "dimensions").order;
    expect(placementOf("objectFit", "dimensions").section).toBe("size");
    expect(order("objectFit")).toBeLessThan(order("objectPosition"));
    expect(order("objectPosition")).toBeLessThan(order("width"));
    expect(order("maxWidth")).toBeLessThan(order("aspectRatio"));
    expect(order("aspectRatio")).toBeLessThan(order("flexGrow"));
    expect(placementOf("flexGrow", "dimensions").section).toBe("size");
  });

  it("shows an aspect ratio at once on an image, behind More on a box", () => {
    expect(placementOf("aspectRatio", "dimensions").tier).toBe(
      "common-on-media"
    );
    expect(tierShows("common-on-media", { ...plain, replaced: true })).toBe(
      true
    );
    expect(tierShows("common-on-media", { ...plain, replaced: false })).toBe(
      false
    );
    // Not yet known: shown, as anything that cannot be read is.
    expect(tierShows("common-on-media", plain)).toBe(true);
  });

  it("shows transition in a state", () => {
    expect(tierShows("state", plain)).toBe(false);
    expect(tierShows("state", { ...plain, state: "hover" })).toBe(true);
  });
});
