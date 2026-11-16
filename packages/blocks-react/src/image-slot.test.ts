import { describe, expect, it } from "vitest";

import {
  childImageContext,
  copiesWantedUpTo,
  narrowForColumns,
  narrowForOwnSize,
  narrowToWidth,
  rootImageSlot,
  sizesFor,
  hasDefaultColumnGap,
  imageSizingFor,
} from "./image-slot";

const BREAKPOINTS = {
  viewport: [
    { id: "base", label: "Desktop" },
    { id: "tablet", label: "Tablet", maxWidth: 1024 },
    { id: "mobile", label: "Mobile", maxWidth: 640 },
  ],
  container: [],
};

describe("an image's slot", () => {
  it("starts as the whole width of each device, a desktop at most 1920px", () => {
    const slot = rootImageSlot(BREAKPOINTS);
    expect(slot.devices).toEqual([
      { id: "base", width: 1920 },
      { id: "tablet", maxViewport: 1024, width: 1024 },
      { id: "mobile", maxViewport: 640, width: 640 },
    ]);
    // A site with no breakpoints is one desktop.
    expect(rootImageSlot(undefined).devices).toEqual([
      { id: "base", width: 1920 },
    ]);
  });

  it("divides a row of columns by how many sit side by side on each device", () => {
    // Columns wrap at 240px each, so a phone fits fewer than a desktop.
    const slot = narrowForColumns(rootImageSlot(BREAKPOINTS), 4);
    // A device's slot covers every viewport up to its widest: a tablet's row
    // of four wraps to two, and a phone's to one, on its way down, and a
    // column just before a row of two wraps is two minimums and the widest
    // gap wide, 512px.
    expect(slot.devices.map(device => device.width)).toEqual([512, 512, 512]);
    // One column is the whole width, and no column count changes nothing.
    expect(
      narrowForColumns(rootImageSlot(BREAKPOINTS), 1).devices[0]?.width
    ).toBe(1920);
  });

  it("is narrowed by a width of its own, in px, rem or a percentage", () => {
    const root = rootImageSlot(BREAKPOINTS);
    expect(narrowToWidth(root, "600px").devices.map(d => d.width)).toEqual([
      600, 600, 600,
    ]);
    expect(narrowToWidth(root, "20rem").devices.map(d => d.width)).toEqual([
      320, 320, 320,
    ]);
    expect(narrowToWidth(root, "50%").devices.map(d => d.width)).toEqual([
      960, 512, 320,
    ]);
    // A width it cannot judge leaves the slot as it was: never narrower than
    // the image may be drawn.
    expect(narrowToWidth(root, "calc(100% - 2rem)")).toBe(root);
    expect(narrowToWidth(root, "auto")).toBe(root);
  });

  it("writes sizes from the narrowest device up", () => {
    const slot = narrowForColumns(rootImageSlot(BREAKPOINTS), 2);
    expect(sizesFor(slot)).toBe(
      "(max-width: 640px) 512px, (max-width: 1024px) 512px, 960px"
    );
  });

  it("asks for copies no wider than twice the slot's widest width", () => {
    expect(copiesWantedUpTo(rootImageSlot(BREAKPOINTS))).toBe(3840);
    expect(
      copiesWantedUpTo(narrowForColumns(rootImageSlot(BREAKPOINTS), 3))
    ).toBe(1280);
  });
});

describe("a container's children", () => {
  // Under the default gap between columns, so a row divides its slot.
  const ctx = {
    imageSlot: { ...rootImageSlot(BREAKPOINTS), columnsDivide: true },
    firstBlockId: "hero",
  };

  it("share a row of columns, and are found early inside the first block", () => {
    const row = childImageContext(ctx, {
      id: "hero",
      type: "core/columns",
      slots: { children: [{}, {}] },
    });
    expect(row?.imageSlot?.devices.map(d => d.width)).toEqual([960, 512, 512]);
    expect(row?.imageSlot?.eager).toBe(true);
    const later = childImageContext(ctx, { id: "later", type: "core/box" });
    expect(later?.imageSlot?.eager).toBeUndefined();
  });

  it("are not divided by a row whose layout the author changed", () => {
    // A grid the author set, a direction, or a named class may draw the
    // columns at any width, so the row's own width is the bound.
    for (const changed of [
      { styles: { base: { base: { gridTemplateColumns: "1fr 3fr" } } } },
      { styles: { hover: { mobile: { display: "flex" } } } },
      { styles: { base: { base: { gap: "200px" } } } },
      { styles: { base: { tablet: { columnGap: "4rem" } } } },
      { classes: ["wide-row"] },
    ]) {
      const row = childImageContext(ctx, {
        id: "row",
        type: "core/columns",
        slots: { children: [{}, {}] },
        ...changed,
      });
      expect(row?.imageSlot?.devices.map(d => d.width)).toEqual([
        1920, 1024, 640,
      ]);
    }
  });

  it("are not divided by a row where the site's column gap is not the default", () => {
    // A site that sets its own gap may wrap a row sooner than the bound
    // knows, so the row's width is the bound: never too narrow an image.
    const row = childImageContext(
      { imageSlot: rootImageSlot(BREAKPOINTS), firstBlockId: "hero" },
      { id: "row", type: "core/columns", slots: { children: [{}, {}] } }
    );
    expect(row?.imageSlot?.devices.map(d => d.width)).toEqual([
      1920, 1024, 640,
    ]);
  });

  it("are handed nothing where the page sizes no images", () => {
    expect(childImageContext({}, { type: "core/box" })).toBeUndefined();
  });

  it("are narrowed by a width the container sets on every device only", () => {
    const root = rootImageSlot(BREAKPOINTS);
    const fixed = { base: { base: { maxWidth: "600px" } } };
    expect(narrowForOwnSize(root, fixed).devices.map(d => d.width)).toEqual([
      600, 600, 600,
    ]);
    // A width that changes on a device is left unjudged: the base value would
    // size the image too small where it is drawn wider.
    const varies = {
      base: { base: { width: "50%" }, mobile: { width: "100%" } },
    };
    expect(narrowForOwnSize(root, varies)).toBe(root);
  });

  it("is not narrowed by a width another state changes", () => {
    const root = rootImageSlot(BREAKPOINTS);
    for (const styles of [
      {
        base: { base: { width: "100px" } },
        hover: { base: { width: "1000px" } },
      },
      {
        base: { base: { maxWidth: "300px" } },
        focus: { base: { maxWidth: "none" } },
      },
      {
        base: { base: { width: "300px" } },
        active: { mobile: { minWidth: "90%" } },
      },
    ]) {
      expect(narrowForOwnSize(root, styles)).toBe(root);
    }
  });

  it("is drawn at a width set in pixels, even past its container", () => {
    // CSS draws `width: 1000px` at 1000 inside a 300px container; a maximum
    // and a percentage are shares of the container.
    const narrow = narrowToWidth(rootImageSlot(BREAKPOINTS), "300px");
    const wide = { base: { base: { width: "1000px" } } };
    expect(narrowForOwnSize(narrow, wide).devices.map(d => d.width)).toEqual([
      1000, 1000, 1000,
    ]);
    const capped = { base: { base: { width: "1000px", maxWidth: "50%" } } };
    expect(narrowForOwnSize(narrow, capped).devices.map(d => d.width)).toEqual([
      150, 150, 150,
    ]);
  });

  it("is not narrowed where a minimum width could widen the block", () => {
    const root = rootImageSlot(BREAKPOINTS);
    for (const styles of [
      { base: { base: { width: "300px", minWidth: "100%" } } },
      { base: { base: { maxWidth: "300px" }, mobile: { minWidth: "50%" } } },
    ]) {
      expect(narrowForOwnSize(root, styles)).toBe(root);
    }
  });

  it("resolves a width and a maximum width each against the container", () => {
    const root = rootImageSlot(BREAKPOINTS);
    // CSS draws `width: 50%; max-width: 50%` at half the container, not a
    // quarter: the maximum is a share of the container, not of the width.
    const halves = { base: { base: { width: "50%", maxWidth: "50%" } } };
    expect(narrowForOwnSize(root, halves).devices.map(d => d.width)).toEqual([
      960, 512, 320,
    ]);
    const capped = { base: { base: { width: "80%", maxWidth: "600px" } } };
    expect(narrowForOwnSize(root, capped).devices.map(d => d.width)).toEqual([
      600, 600, 512,
    ]);
  });
});

describe("a site's gap between columns", () => {
  it("is the default where the site keeps the shipped space.columns", () => {
    expect(hasDefaultColumnGap(undefined)).toBe(true);
    expect(hasDefaultColumnGap({ tokens: [] })).toBe(true);
  });

  it("is not the default where the site sets its own", () => {
    expect(
      hasDefaultColumnGap({
        tokens: [{ name: "space.columns", kind: "dimension", value: "200px" }],
      } as never)
    ).toBe(false);
  });

  it("decides whether a page's columns divide their images' slot", () => {
    expect(
      imageSizingFor(async () => [], undefined, [], true).imageSlot
        ?.columnsDivide
    ).toBe(true);
    // Not known: columns divide nothing.
    expect(
      imageSizingFor(async () => [], undefined, []).imageSlot?.columnsDivide
    ).toBeUndefined();
  });
});
