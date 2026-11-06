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
  const plain: TierContext = {
    display: undefined,
    media: false,
    state: "base",
  };

  it("shows common always and more never", () => {
    expect(tierShows("common", plain)).toBe(true);
    expect(tierShows("more", plain)).toBe(false);
  });

  it("shows the flex controls on a flex container, the grid ones on a grid", () => {
    expect(tierShows("flex", plain)).toBe(false);
    expect(tierShows("flex", { ...plain, display: "flex" })).toBe(true);
    expect(tierShows("flex", { ...plain, display: "inline-flex" })).toBe(true);
    expect(tierShows("flex", { ...plain, display: "grid" })).toBe(false);
    expect(tierShows("grid", { ...plain, display: "grid" })).toBe(true);
    expect(
      tierShows("flex-or-grid", { ...plain, display: "inline-grid" })
    ).toBe(true);
    expect(tierShows("flex-or-grid", { ...plain, display: "block" })).toBe(
      false
    );
  });

  it("puts an image's fit and ratio first in Size, before its width and height", () => {
    // What an author changes first on an image is how it fills its box.
    const fit = placementOf("objectFit", "dimensions");
    const ratio = placementOf("aspectRatio", "dimensions");
    const width = placementOf("width", "dimensions");
    expect(fit.section).toBe("size");
    expect(fit.order).toBeLessThan(ratio.order);
    expect(ratio.order).toBeLessThan(width.order);
  });

  it("shows the media controls on a replaced element, and transition in a state", () => {
    expect(tierShows("media", plain)).toBe(false);
    expect(tierShows("media", { ...plain, media: true })).toBe(true);
    expect(tierShows("state", plain)).toBe(false);
    expect(tierShows("state", { ...plain, state: "hover" })).toBe(true);
  });
});
