/**
 * The rules behind previewing the page at a width other than the device's own:
 * the width laid out, its range, the ruler's marks and their snap, the keys,
 * and the words the canvas says about it.
 *
 * @module canvas-preview-width.test
 */
import { describe, expect, it } from "vitest";

import { BASE_BREAKPOINT, type BreakpointSet } from "@nextlyhq/blocks-engine";

import {
  breakpointsAtWidth,
  clampPreviewWidth,
  previewWidthRange,
} from "./canvas-width";
import {
  deviceLabelOf,
  draggedPaintedWidth,
  keyedPreviewWidth,
  previewAnnouncement,
  previewNotice,
  previewValueText,
  rulerMarks,
  snappedPreviewWidth,
} from "./canvas-preview-width";

const site = (): BreakpointSet => ({
  viewport: [
    { id: "tablet", label: "Tablet", maxWidth: 1023 },
    { id: "mobile", label: "Mobile", maxWidth: 767 },
    { id: "small", label: "Small phone", maxWidth: 389 },
  ],
  container: [],
});

describe("the widths a page can be previewed at", () => {
  it("reaches from 320px to the Desktop preview width", () => {
    expect(previewWidthRange(site())).toEqual({ min: 320, max: 1280 });
    // A site with no breakpoints still previews down to 320.
    expect(previewWidthRange(undefined)).toEqual({ min: 320, max: 1280 });
  });

  it("reaches one pixel past the widest bound where that bound reaches 1280", () => {
    const wide: BreakpointSet = {
      viewport: [{ id: "laptop", label: "Laptop", maxWidth: 1440 }],
      container: [],
    };
    expect(previewWidthRange(wide)).toEqual({ min: 320, max: 1441 });
  });

  it("clamps a width to the range, in whole pixels", () => {
    const range = previewWidthRange(site());
    expect(clampPreviewWidth(100, range)).toBe(320);
    expect(clampPreviewWidth(5000, range)).toBe(1280);
    expect(clampPreviewWidth(900.4, range)).toBe(900);
  });

  it("answers which breakpoints are live at a previewed width", () => {
    // Desktop previewed at 900: Tablet's values are live, as on screen.
    expect(breakpointsAtWidth(site(), 900)).toContain("tablet");
    expect(breakpointsAtWidth(site(), 1280)).not.toContain("tablet");
  });
});

describe("the ruler's marks", () => {
  it("marks where each breakpoint starts, narrowest first, with the site's names", () => {
    expect(rulerMarks(site())).toEqual([
      { width: 390, label: "Mobile" },
      { width: 768, label: "Tablet" },
      { width: 1024, label: "Desktop" },
    ]);
  });

  it("leaves out a start below the narrowest width previewed", () => {
    const set: BreakpointSet = {
      viewport: [
        { id: "tablet", label: "Tablet", maxWidth: 991 },
        { id: "tiny", label: "Tiny", maxWidth: 200 },
      ],
      container: [],
    };
    expect(rulerMarks(set)).toEqual([{ width: 992, label: "Desktop" }]);
  });

  it("has no marks on a site with no breakpoints", () => {
    expect(rulerMarks(undefined)).toEqual([]);
  });
});

describe("snapping to a mark", () => {
  const marks = rulerMarks(site());

  it("snaps a width whose handle is within 6 screen pixels of a mark", () => {
    // At scale 1 a handle moves half the width's change: 12px of width is 6px.
    expect(snappedPreviewWidth(780, marks, 1)).toBe(768);
    expect(snappedPreviewWidth(756, marks, 1)).toBe(768);
  });

  it("leaves a width further away than that", () => {
    expect(snappedPreviewWidth(781, marks, 1)).toBe(781);
  });

  it("measures the distance on screen, at the frame's scale", () => {
    // At half scale, 24px of width is 6 screen pixels.
    expect(snappedPreviewWidth(792, marks, 0.5)).toBe(768);
    expect(snappedPreviewWidth(793, marks, 0.5)).toBe(793);
  });
});

describe("the keys on a handle", () => {
  const set = site();
  const marks = rulerMarks(set);
  const range = previewWidthRange(set);
  const keyed = (key: string, width: number, shiftKey = false) =>
    keyedPreviewWidth({ key, shiftKey }, width, marks, range);

  it("moves 10px with the arrows and 1px with Shift", () => {
    expect(keyed("ArrowRight", 900)).toBe(910);
    expect(keyed("ArrowUp", 900)).toBe(910);
    expect(keyed("ArrowLeft", 900)).toBe(890);
    expect(keyed("ArrowDown", 900)).toBe(890);
    expect(keyed("ArrowRight", 900, true)).toBe(901);
    expect(keyed("ArrowLeft", 900, true)).toBe(899);
  });

  it("goes to the next and previous mark with Page Up and Page Down", () => {
    expect(keyed("PageUp", 900)).toBe(1024);
    expect(keyed("PageUp", 1024)).toBe(1280);
    expect(keyed("PageDown", 900)).toBe(768);
    expect(keyed("PageDown", 768)).toBe(390);
    expect(keyed("PageDown", 390)).toBe(320);
  });

  it("goes to the narrowest and widest with Home and End", () => {
    expect(keyed("Home", 900)).toBe(320);
    expect(keyed("End", 900)).toBe(1280);
  });

  it("stays in the range", () => {
    expect(keyed("ArrowLeft", 325)).toBe(320);
    expect(keyed("ArrowRight", 1275)).toBe(1280);
  });

  it("answers nothing for any other key", () => {
    expect(keyed("Enter", 900)).toBeUndefined();
    expect(keyed("a", 900)).toBeUndefined();
  });
});

describe("the words", () => {
  it("names the device being edited by the site's own name", () => {
    expect(deviceLabelOf(site(), BASE_BREAKPOINT)).toBe("Desktop");
    expect(deviceLabelOf(site(), "tablet")).toBe("Tablet");
  });

  it("says the width and the breakpoint range it is in, for the slider", () => {
    expect(previewValueText(site(), 900)).toBe("900 pixels, Tablet range");
    expect(previewValueText(site(), 1100)).toBe("1100 pixels, Desktop range");
  });

  it("says under the frame which device is still being edited", () => {
    expect(previewNotice(900, "Desktop")).toBe(
      "Previewing at 900px · still editing Desktop styles"
    );
  });

  it("announces the settled width in words", () => {
    expect(previewAnnouncement(900, "Desktop")).toBe(
      "Previewing at 900 pixels, still editing Desktop styles"
    );
  });
});

describe("the painted width a dragged edge asks for", () => {
  it("moves both edges together while the frame is centred in the region", () => {
    // 600 painted in an 800 region: the right edge 100px in, both move.
    expect(
      draggedPaintedWidth({ side: 1, start: 600, region: 800, travel: -50 })
    ).toBe(500);
    expect(
      draggedPaintedWidth({ side: -1, start: 600, region: 800, travel: -50 })
    ).toBe(700);
  });

  it("centres an overflowing frame in the width it started at, both edges moving", () => {
    // 1280 painted in an 800 region: the stage is held at 1280 for the drag,
    // so the frame is centred in it and the right edge follows the pointer.
    expect(
      draggedPaintedWidth({ side: 1, start: 1280, region: 800, travel: -100 })
    ).toBe(1080);
    expect(
      draggedPaintedWidth({ side: -1, start: 1280, region: 800, travel: 100 })
    ).toBe(1080);
  });

  it("changes an overflowing frame smoothly from its first pixel, either way", () => {
    // No jump to the region's width on the first move.
    expect(
      draggedPaintedWidth({ side: -1, start: 1280, region: 800, travel: 1 })
    ).toBe(1278);
    expect(
      draggedPaintedWidth({ side: -1, start: 1280, region: 800, travel: -1 })
    ).toBe(1282);
    // Outward past the width it started at, the right edge moves alone.
    expect(
      draggedPaintedWidth({ side: 1, start: 1280, region: 800, travel: 30 })
    ).toBe(1310);
  });

  it("moves both edges together where the region is not measured", () => {
    expect(
      draggedPaintedWidth({ side: 1, start: 600, region: 0, travel: -50 })
    ).toBe(500);
  });
});
