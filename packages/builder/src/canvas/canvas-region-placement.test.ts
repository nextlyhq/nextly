/**
 * Where a header or footer's tag sits: inside the region, at its top left,
 * or at its bottom left where the top left is off screen, and across within
 * the part of the frame on screen. Never outside, over the page.
 */
import { describe, expect, it } from "vitest";

import {
  REGION_MARK_INSET,
  regionMarkLeft,
  regionMarkPlacement,
} from "./canvas-region-placement";

describe("which corner inside a region its tag sits in", () => {
  const viewport = 800;
  const height = 24;

  it("sits at the top left while the region's top is on screen", () => {
    // A 48px header at the top of the page.
    expect(
      regionMarkPlacement({ edge: { top: 0, bottom: 48 }, height, viewport })
    ).toBe("top");
    // A footer whose top edge is on screen, its foot below the canvas.
    expect(
      regionMarkPlacement({ edge: { top: 700, bottom: 980 }, height, viewport })
    ).toBe("top");
  });

  it("drops to the bottom left where the top is scrolled off screen", () => {
    // A tall footer scrolled so its top edge is above the canvas.
    expect(
      regionMarkPlacement({
        edge: { top: -200, bottom: 300 },
        height,
        viewport,
      })
    ).toBe("bottom");
    // A header scrolled the same way.
    expect(
      regionMarkPlacement({ edge: { top: -40, bottom: 60 }, height, viewport })
    ).toBe("bottom");
  });

  it("keeps the top where the bottom is no better: a region scrolled away", () => {
    expect(
      regionMarkPlacement({
        edge: { top: -300, bottom: -100 },
        height,
        viewport,
      })
    ).toBe("top");
    expect(
      regionMarkPlacement({ edge: { top: 900, bottom: 972 }, height, viewport })
    ).toBe("top");
  });

  it("draws no tag in a region shorter than the tag, rather than over the page", () => {
    // A 48px header at 25%: 12px on screen, the tag 24px with its gap.
    expect(
      regionMarkPlacement({ edge: { top: 0, bottom: 12 }, height, viewport })
    ).toBe("none");
    // Scrolled half away, still too short for it.
    expect(
      regionMarkPlacement({ edge: { top: -10, bottom: 12 }, height, viewport })
    ).toBe("none");
    // CONTROL: exactly as tall as the tag takes it.
    expect(
      regionMarkPlacement({ edge: { top: 0, bottom: 24 }, height, viewport })
    ).toBe("top");
  });
});

describe("how far in from a region's left edge its mark starts", () => {
  const region = { left: 0, right: 1280 };

  it("starts at the inset while the region's left edge is on screen", () => {
    expect(
      regionMarkLeft({ region, visible: { left: 0, right: 1040 }, width: 300 })
    ).toBe(REGION_MARK_INSET);
  });

  it("starts where the screen does once the left part is scrolled away, at 100%", () => {
    expect(
      regionMarkLeft({
        region,
        visible: { left: 240, right: 1280 },
        width: 300,
      })
    ).toBe(240 + REGION_MARK_INSET);
  });

  it("never leaves the region on the right", () => {
    expect(
      regionMarkLeft({
        region,
        visible: { left: 1200, right: 1280 },
        width: 300,
      })
    ).toBe(1280 - 300 - REGION_MARK_INSET);
  });
});
