import { describe, expect, it } from "vitest";

import {
  childImageContext,
  copiesWantedUpTo,
  narrowForColumns,
  narrowForOwnSize,
  narrowToWidth,
  rootImageSlot,
  sizesFor,
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
    expect(slot.devices.map(device => device.width)).toEqual([480, 256, 320]);
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
      "(max-width: 640px) 320px, (max-width: 1024px) 512px, 960px"
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
  const ctx = { imageSlot: rootImageSlot(BREAKPOINTS), firstBlockId: "hero" };

  it("share a row of columns, and are found early inside the first block", () => {
    const row = childImageContext(ctx, {
      id: "hero",
      type: "core/columns",
      slots: { children: [{}, {}] },
    });
    expect(row?.imageSlot?.devices.map(d => d.width)).toEqual([960, 512, 320]);
    expect(row?.imageSlot?.eager).toBe(true);
    const later = childImageContext(ctx, { id: "later", type: "core/box" });
    expect(later?.imageSlot?.eager).toBeUndefined();
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
});
