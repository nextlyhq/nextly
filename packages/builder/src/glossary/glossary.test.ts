/**
 * The glossary says each idea's agreed word, and none it has retired.
 *
 * The words pinned here are the ones the editor's places read; a rename is
 * one edit in the glossary and one here. Whether the shown text of the
 * builder, the plugin and the admin keeps to them is the repository's
 * retired-words test (`scripts/retired-words.test.mjs`).
 */
import { describe, expect, it } from "vitest";

import {
  ADD_PANEL_WORDS,
  BOX_DESCRIPTION,
  CHOICE_WORDS,
  CONNECT_WORDS,
  DESIGN_ACTION_WORDS,
  EDITOR_WORDS,
  GAP_WORDS,
  HEADER_FOOTER_WORDS,
  IMAGE_FIT_WORDS,
  INDUSTRY_KEYWORDS,
  LINK_WORDS,
  MESSAGE_WORDS,
  PANEL_TOGGLE_WORDS,
  POSITION_WORDS,
  PROPERTY_WORDS,
  RETIRED_WORDS,
  SAVED_SECTION_SIZE_WORDS,
  SCREEN_SIZE_WORDS,
  SIZE_WORDS,
  VARIABLE_WORDS,
  VERB_WORDS,
  changeForThis,
  connectedTo,
  contentThisPageLoads,
  headerAndFooterNamed,
  letEachPageChange,
  propertyCount,
} from "./index";

/** The groups of words the glossary sets, by name. */
const GROUPS = {
  ADD_PANEL_WORDS,
  CHOICE_WORDS,
  CONNECT_WORDS,
  GAP_WORDS,
  HEADER_FOOTER_WORDS,
  IMAGE_FIT_WORDS,
  LINK_WORDS,
  MESSAGE_WORDS,
  PANEL_TOGGLE_WORDS,
  POSITION_WORDS,
  PROPERTY_WORDS,
  SAVED_SECTION_SIZE_WORDS,
  SCREEN_SIZE_WORDS,
  SIZE_WORDS,
  VARIABLE_WORDS,
  VERB_WORDS,
};

/** Every text the glossary's words and its phrase builders produce. */
function glossaryTexts(): string[] {
  return [
    ...Object.values(GROUPS).flatMap(group => Object.values(group)),
    BOX_DESCRIPTION,
    changeForThis("Box"),
    connectedTo("Title"),
    contentThisPageLoads(430, 500),
    headerAndFooterNamed("Landing"),
    letEachPageChange("Title"),
    propertyCount("Feature card", 2),
  ];
}

describe("the glossary", () => {
  it("names the space between blocks Gap, and the built-in gaps after it", () => {
    expect(GAP_WORDS).toEqual({
      gap: "Gap",
      rowGap: "Row gap",
      columnGap: "Column gap",
      hint: "Space between the blocks inside",
      spreadOut: "Spread out",
      defaultGap: "Default gap",
      gapBetweenColumns: "Gap between columns",
    });
  });

  it("calls the width ranges screen sizes, and keeps the device names", () => {
    expect(SCREEN_SIZE_WORDS).toEqual({
      screenSizes: "Screen sizes",
      screenSize: "Screen size",
      edit: "Edit screen sizes",
      add: "Add screen size",
      save: "Save screen sizes",
      needsLargestWidth: "Give this screen size a largest width.",
      desktop: "Desktop",
      tablet: "Tablet",
      mobile: "Mobile",
    });
  });

  it("names Position's choices by their standard names, and Overlap order", () => {
    expect(POSITION_WORDS).toEqual({
      default: "Default",
      relative: "Relative",
      absolute: "Absolute",
      fixed: "Fixed",
      sticky: "Sticky",
      absoluteHint: "Placed on top of its parent, out of the flow.",
      overlapOrder: "Overlap order",
      overlapOrderHint: "Higher numbers sit in front.",
    });
  });

  it("says properties for a component's per-copy settings, and More details in Page settings", () => {
    expect(PROPERTY_WORDS).toEqual({
      properties: "Properties",
      moreDetails: "More details",
    });
    expect(propertyCount("Feature card", 2)).toBe(
      "Feature card · 2 properties"
    );
    expect(propertyCount("Feature card", 1)).toBe("Feature card · 1 property");
    expect(letEachPageChange("Title")).toBe("Let each page change Title");
  });

  it("says the rename package's words", () => {
    expect(SAVED_SECTION_SIZE_WORDS).toEqual({
      oneBlock: "One block",
      aFewBlocks: "A few blocks",
      fullWidthBand: "A full-width band",
    });
    expect(SIZE_WORDS).toEqual({
      width: "Width",
      insideItsParent: "Inside its parent",
      contentWidth: "Content width",
    });
    expect(changeForThis("Box")).toBe("Change for this box");
    expect(HEADER_FOOTER_WORDS).toEqual({
      headerAndFooter: "Header & footer",
      siteDefault: "Site default",
    });
    expect(headerAndFooterNamed("Landing")).toBe("Header & footer: Landing");
    expect(CONNECT_WORDS).toEqual({
      connect: "Connect to a field",
      disconnect: "Disconnect",
      toFix: "Connected fields to fix",
    });
    expect(connectedTo("Title")).toBe("Connected to Title");
    expect(VARIABLE_WORDS).toEqual({
      import: "Import variables…",
      export: "Export variables (.json)",
      exported: "Variables exported",
    });
    expect(DESIGN_ACTION_WORDS.copyCss).toBe("Copy CSS variables");
    expect(IMAGE_FIT_WORDS).toEqual({
      imageFit: "Image fit",
      cover: "Cover",
      contain: "Contain",
      stretch: "Stretch",
      originalSize: "Original size",
      shrinkIfTooBig: "Shrink if too big",
    });
    expect(LINK_WORDS).toEqual({
      link: "Link",
      linkPlaceholder: "Search pages or paste a link",
      address: "Address",
      tellSearchEngines: "Tell search engines",
    });
    expect(VERB_WORDS).toEqual({
      saveDraft: "Save draft",
      addSavedSection: "Add a saved section",
      browseAll: "Browse all blocks and saved sections →",
    });
    expect(BOX_DESCRIPTION).toBe("An empty box that holds other blocks.");
    expect(CHOICE_WORDS).toEqual({
      staysPutWhileScrolling: "Stays put while scrolling",
      noneHidden: "None (hidden)",
      cutOff: "Cut off",
      linkStyle: "Link style",
      notOffered: "Not offered",
    });
    expect(ADD_PANEL_WORDS).toEqual({
      textAndLists: "Text & lists",
      collections: "Collections",
      collectionTemplates: "Collection templates",
    });
    expect(PANEL_TOGGLE_WORDS).toEqual({
      rightPanel: "Right panel",
      showCssNames: "Show CSS names",
    });
    expect(contentThisPageLoads(430, 500)).toBe(
      "Content this page loads: 430 of 500"
    );
  });

  it("uses none of the words it retires", () => {
    const path = "packages/builder/src/glossary/words.ts";
    const used = glossaryTexts().flatMap(text =>
      RETIRED_WORDS.filter(
        rule =>
          (rule.where === undefined ||
            rule.where.some(prefix => path.startsWith(prefix))) &&
          rule.test(text, path)
      ).map(rule => `${rule.id}: ${text}`)
    );
    expect(used).toEqual([]);
  });

  it("finds each renamed thing by its industry word", () => {
    expect(
      Object.fromEntries(
        Object.entries(INDUSTRY_KEYWORDS).map(([word, { keywords }]) => [
          word,
          keywords,
        ])
      )
    ).toEqual({
      [EDITOR_WORDS.sharedStyles]: ["class"],
      "Screen sizes": ["breakpoint"],
      "Overlap order": ["z-index"],
      "Image fit": ["object-fit"],
      [EDITOR_WORDS.layers]: ["navigator", "structure"],
      "Connect to a field": ["dynamic data", "bind"],
      "Collection templates": ["template"],
      [EDITOR_WORDS.variables]: ["token"],
      [EDITOR_WORDS.add]: ["insert"],
    });
  });
});
