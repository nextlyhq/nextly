/**
 * What "CSS properties" holds and what "Add CSS property" offers, read from
 * the inspection: only catalog properties, each once, and only those that
 * have an effect on the block now.
 *
 * @module css-properties.test
 */
import {
  BASE_BREAKPOINT,
  clearBlocks,
  getStyleProperty,
  registerBlocks,
  STYLE_CATALOG,
  STYLE_GROUPS,
  type AppliesWhen,
  type BlockDocument,
  type BlockNode,
  type NodeStyles,
  type StyleShape,
} from "@nextlyhq/blocks-engine";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  addableRows,
  arrangeCssProperties,
  cssPropertyRows,
} from "./css-properties";
import { entryMatches } from "./settings-index";
import { styleEntries } from "./settings-entries";
import { inspectStyle } from "./style-inspector";

beforeEach(() => {
  registerBlocks(
    [
      {
        name: "acme/everything",
        version: 1,
        description: "A block offering every style group.",
        example: { props: {} },
        supports: Object.fromEntries(STYLE_GROUPS.map(group => [group, true])),
        render: () => null,
      },
    ] as never,
    { source: "css-properties-test" }
  );
});

afterEach(() => {
  clearBlocks();
});

/** A page of one block holding these styles, inside one holding those. */
function page(inner?: NodeStyles, outer?: NodeStyles): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "outer",
        type: "acme/everything",
        version: 1,
        props: {},
        styles: outer,
        slots: {
          main: [
            {
              id: "inner",
              type: "acme/everything",
              version: 1,
              props: {},
              styles: inner,
            },
          ],
        },
      },
    ] as BlockNode[],
  } as BlockDocument;
}

/** The inner block's sections, arranged as the Style tab draws them. */
function arranged(inner?: NodeStyles, outer?: NodeStyles) {
  const inspection = inspectStyle(page(inner, outer), "inner");
  if (inspection === null) throw new Error("the block was not inspected");
  return arrangeCssProperties(inspection.sections, "acme/everything");
}

/** Styles at the base state and breakpoint. */
function at(values: Record<string, unknown>): NodeStyles {
  return { base: { [BASE_BREAKPOINT]: values } } as NodeStyles;
}

/** The shape stored at a path of a catalog property, if the catalog has one. */
function shapeAt(
  shape: StyleShape | undefined,
  path: readonly string[]
): StyleShape | undefined {
  let here = shape;
  for (const field of path) {
    here = here?.kind === "object" ? here.fields[field] : undefined;
  }
  return here;
}

/** The conditions only a flex or grid container, or child, meets. */
const FLEX_OR_GRID: ReadonlySet<AppliesWhen> = new Set([
  "flex-container",
  "grid-container",
  "flex-or-grid-container",
  "wrapping-flex-or-grid",
  "flex-child",
  "grid-child",
  "flex-or-grid-child",
]);

describe("what Add CSS property offers", () => {
  it("offers only properties the engine's catalog defines, each once", () => {
    const { extras } = arranged();
    const offered = addableRows(extras, new Set());
    // The control: there is a list to judge.
    expect(offered.length).toBeGreaterThan(5);
    for (const each of offered) {
      const entry = getStyleProperty(each.row.property);
      expect(entry, each.id).toBeDefined();
      // A field offered on its own is one the catalog's shape holds.
      expect(shapeAt(entry?.shape, each.path), each.id).toBeDefined();
    }
    const ids = offered.map(each => each.id);
    expect(new Set(ids).size).toBe(ids.length);
    const keys = new Set(STYLE_CATALOG.map(entry => entry.property));
    expect(offered.every(each => keys.has(each.row.property))).toBe(true);
  });

  it("offers no flex- or grid-only property on a block that stacks in flow", () => {
    // Both boxes say they are block boxes, so neither is a flex or grid
    // container and the inner one is no flex or grid child.
    const offered = addableRows(
      arranged(at({ display: "block" }), at({ display: "block" })).extras,
      new Set()
    );
    const flexOrGridOnly = offered.filter(each => {
      const entry = getStyleProperty(each.row.property);
      const field = each.path[0];
      const conditions =
        (field === undefined ? undefined : entry?.fieldAppliesWhen?.[field]) ??
        entry?.appliesWhen ??
        [];
      return (
        conditions.length > 0 &&
        conditions.every(condition => FLEX_OR_GRID.has(condition))
      );
    });
    expect(flexOrGridOnly.map(each => each.id)).toEqual([]);
    // The control: on a grid, its own properties are offered.
    const onGrid = addableRows(
      arranged(at({ display: "grid" }), at({ display: "block" })).extras,
      new Set()
    ).map(each => each.id);
    expect(onGrid).toContain("gridAutoFlow");
    expect(onGrid).toContain("justifyItems");
  });

  it("offers z-index only where it stacks: positioned, or in a flex or grid", () => {
    const ids = (inner: NodeStyles, outer: NodeStyles) =>
      addableRows(arranged(inner, outer).extras, new Set()).map(
        each => each.id
      );
    // Static and in flow, as stored: a z-index there stacks nothing.
    expect(
      ids(at({ position: { type: "static" } }), at({ display: "block" }))
    ).not.toContain("position.zIndex");
    expect(
      ids(at({ position: { type: "relative" } }), at({ display: "block" }))
    ).toContain("position.zIndex");
    expect(
      ids(at({ position: { type: "static" } }), at({ display: "flex" }))
    ).toContain("position.zIndex");
  });

  it("leaves out what is added or set, which is drawn instead", () => {
    const { extras } = arranged(at({ mixBlendMode: "multiply" }));
    const added = new Set(["filter"]);
    const offered = addableRows(extras, added).map(each => each.id);
    expect(offered).not.toContain("mixBlendMode");
    expect(offered).not.toContain("filter");
    expect(cssPropertyRows(extras, added).map(each => each.id)).toEqual([
      "filter",
      "mixBlendMode",
    ]);
  });
});

describe("the sections beside CSS properties", () => {
  it("keeps in its section what a plain control there draws", () => {
    const inspection = inspectStyle(
      page(at({ display: "grid", rowGap: "8px", minHeight: "100svh" })),
      "inner"
    );
    const sections = inspection?.sections ?? [];
    const keys = (arranged: ReturnType<typeof arrangeCssProperties>) => ({
      layout: arranged.sections
        .find(section => section.key === "layout")
        ?.properties.map(each => each.property),
      size: arranged.sections
        .find(section => section.key === "size")
        ?.properties.map(each => each.property),
      extras: arranged.extras.map(each => each.id),
    });
    // Arrange draws rows and columns apart; a Section's Height presets stand
    // over its min height.
    const section = keys(arrangeCssProperties(sections, "core/section"));
    expect(section.layout).toContain("rowGap");
    expect(section.size).toContain("minHeight");
    expect(section.extras).not.toContain("rowGap");
    expect(section.extras).not.toContain("minHeight");
    // Another block, or a shared style, has no Height presets: its min height
    // is one of its CSS properties.
    for (const other of ["acme/everything", undefined]) {
      const arranged = keys(arrangeCssProperties(sections, other));
      expect(arranged.size).not.toContain("minHeight");
      expect(arranged.extras).toContain("minHeight");
      expect(arranged.layout).toContain("rowGap");
    }
  });

  it("keeps what a tier shows unasked, and moves a set value it doesn't to CSS properties", () => {
    const { sections, extras } = arranged(at({ mixBlendMode: "multiply" }));
    const effects = sections.find(section => section.key === "effects");
    const keys = effects?.properties.map(each => each.property) ?? [];
    expect(keys).toContain("opacity");
    expect(keys).not.toContain("mixBlendMode");
    const row = extras.find(each => each.id === "mixBlendMode");
    expect(row).toMatchObject({
      cssName: "mix-blend-mode",
      section: { key: "effects", label: "Effects" },
      row: { set: true, label: "mix-blend-mode" },
    });
  });

  it("draws a position's z-index on its own, and the rest in Position", () => {
    const { sections, extras } = arranged(
      at({ position: { zIndex: 2 } }),
      at({ display: "flex" })
    );
    const position = sections
      .find(section => section.key === "position")
      ?.properties.find(each => each.property === "position");
    expect(position?.controls.map(control => control.path[0])).not.toContain(
      "zIndex"
    );
    // Its own fields hold nothing, so Position marks no value.
    expect(position?.set).toBe(false);
    const zIndex = extras.find(each => each.id === "position.zIndex");
    expect(zIndex).toMatchObject({
      cssName: "z-index",
      plainName: "Layer order",
      path: ["zIndex"],
      row: { set: true, applies: true },
    });
    expect(
      zIndex?.row.controls.every(control => control.path[0] === "zIndex")
    ).toBe(true);
  });
});

describe("what Find a setting offers to add", () => {
  /** The inner block's Style entries, as the index reads them. */
  function entries(inner?: NodeStyles, outer?: NodeStyles) {
    const inspection = inspectStyle(page(inner, outer), "inner");
    return styleEntries(inspection?.sections ?? [], null);
  }

  it("offers a property the block can use but doesn't show, under CSS properties", () => {
    const found = entries(at({ display: "block" })).find(
      entry => entry.id === "mixBlendMode"
    );
    expect(found).toMatchObject({
      section: "css-properties",
      sectionLabel: "CSS properties",
      label: "Mix blend mode",
      addable: true,
      set: false,
    });
    // Found by its CSS name, hyphens or not.
    expect(found && entryMatches(found, "mix-blend-mode")).toBe(true);
    expect(found && entryMatches(found, "mixblend")).toBe(true);
  });

  it("indexes a set one as the row it is, not as one to add", () => {
    const found = entries(at({ mixBlendMode: "multiply" })).find(
      entry => entry.id === "mixBlendMode"
    );
    expect(found?.set).toBe(true);
    expect(found?.addable).toBeUndefined();
  });

  it("indexes neither a row the tab doesn't draw nor one that does nothing here", () => {
    // A block box: a flex direction does nothing, and isn't drawn.
    const ids = entries(at({ display: "block" }), at({ display: "block" })).map(
      entry => entry.id
    );
    expect(ids).not.toContain("flexDirection");
    expect(ids).not.toContain("gridAutoFlow");
    // The control: what is drawn is indexed, in its own section.
    const opacity = entries(at({ display: "block" })).find(
      entry => entry.id === "opacity"
    );
    expect(opacity).toMatchObject({ section: "effects" });
    expect(opacity?.addable).toBeUndefined();
  });
});
