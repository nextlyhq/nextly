/**
 * The settings index: what a typed word finds, what Only changed keeps, and
 * what the panel says of it.
 */
import { describe, expect, it } from "vitest";

import {
  changedElsewhere,
  elsewhereLine,
  entryMatches,
  filterEntries,
  normalise,
  resultsAnnouncement,
  tabCounts,
  type SettingEntry,
} from "./settings-index";

function entry(over: Partial<SettingEntry>): SettingEntry {
  return {
    tab: "style",
    section: "s",
    sectionLabel: "Section",
    id: "x",
    label: "Label",
    options: [],
    css: [],
    set: false,
    ...over,
  };
}

const COLOUR = entry({
  id: "color",
  label: "Colour",
  css: ["color"],
  sectionLabel: "Text",
});
const BACKGROUND = entry({
  id: "backgroundColor",
  label: "Background",
  css: ["background-color"],
  sectionLabel: "Background",
  set: true,
});
const LAYER = entry({
  id: "zIndex",
  label: "Layer order",
  css: ["z-index"],
  sectionLabel: "Position",
});
const RADIUS = entry({
  id: "borderRadius",
  label: "Corner radius",
  css: ["border-radius"],
  sectionLabel: "Border",
});
const REL = entry({
  tab: "advanced",
  id: "rel",
  label: "Link relationship",
  options: ["No follow", "Sponsored"],
  sectionLabel: "HTML",
});
const ALL = [COLOUR, BACKGROUND, LAYER, RADIUS, REL];

const found = (query: string) =>
  ALL.filter(each => entryMatches(each, query)).map(each => each.id);

describe("normalising what is typed", () => {
  it("ignores case, accents, hyphens, underscores and camel case", () => {
    expect(normalise("Z-Index")).toBe("z index");
    expect(normalise("zIndex")).toBe("z index");
    expect(normalise("z_index")).toBe("z index");
    expect(normalise("Café  Colour")).toBe("cafe colour");
  });
});

describe("finding a setting by a word", () => {
  it("finds Colour by colour and by color, and a background colour too", () => {
    expect(found("colour")).toEqual(["color", "backgroundColor"]);
    expect(found("color")).toEqual(["color", "backgroundColor"]);
  });

  it("finds Layer order by z-index and by zindex", () => {
    expect(found("z-index")).toEqual(["zIndex"]);
    expect(found("zindex")).toEqual(["zIndex"]);
  });

  it("finds the radius by corners", () => {
    expect(found("corners")).toEqual(["borderRadius"]);
  });

  it("finds Link relationship by nofollow", () => {
    expect(found("nofollow")).toEqual(["rel"]);
  });

  it("finds a setting by its section", () => {
    expect(found("position")).toEqual(["zIndex"]);
  });

  it("finds every setting by nothing typed", () => {
    expect(found("  ")).toEqual(ALL.map(each => each.id));
  });
});

describe("filtering", () => {
  it("keeps what is changed and matches, both at once, in the panel's order", () => {
    expect(
      filterEntries(ALL, { query: "colour", onlyChanged: true }).map(
        each => each.id
      )
    ).toEqual(["backgroundColor"]);
    expect(
      filterEntries(ALL, { query: "", onlyChanged: true }).map(each => each.id)
    ).toEqual(["backgroundColor"]);
  });

  it("counts each tab's matches and says them", () => {
    const counts = tabCounts(
      filterEntries(ALL, { query: "o", onlyChanged: false })
    );
    expect(counts).toEqual({ content: 0, style: 4, advanced: 1 });
    expect(resultsAnnouncement(counts)).toBe(
      "5 settings found: 4 in Style, 1 in Advanced"
    );
    expect(resultsAnnouncement({ content: 0, style: 0, advanced: 0 })).toBe(
      "No setting matches. Try another word."
    );
  });
});

describe("where else a target holds values", () => {
  it("counts other devices at this state and other states at this device", () => {
    const counts = changedElsewhere(
      {
        base: { base: { color: "red" }, md: { color: "blue", margin: "1px" } },
        hover: { base: { color: "green" } },
      },
      { state: "base", device: "base" },
      {
        devices: [
          { id: "base", label: "Desktop" },
          { id: "md", label: "Tablet" },
          { id: "sm", label: "Mobile" },
        ],
        states: [
          { id: "base", label: "Normal" },
          { id: "hover", label: "Hover" },
        ],
      }
    );
    expect(elsewhereLine(counts)).toBe(
      "Also changed on Tablet (2) · Hover (1)"
    );
  });
});
