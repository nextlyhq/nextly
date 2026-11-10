/**
 * Where a Layout region's mark sits: outside the region at the edge it shares
 * with the page, inside only where outside would leave the screen, and across
 * within the part of the frame on screen.
 */
import { describe, expect, it } from "vitest";

import {
  REGION_MARK_INSET,
  regionMarkLeft,
  regionMarkPlacement,
} from "./canvas-region-placement";

describe("which side of its page edge a region's mark sits on", () => {
  const viewport = 800;
  const height = 40;

  it("hangs below a header, and flips inside where below is off screen", () => {
    // A 48px header at the top of the page: room below.
    expect(
      regionMarkPlacement({
        area: "header",
        edge: { top: 0, bottom: 48 },
        height,
        viewport,
      })
    ).toBe("outside");
    // A tall header whose bottom edge is at the foot of the canvas.
    expect(
      regionMarkPlacement({
        area: "header",
        edge: { top: 500, bottom: 790 },
        height,
        viewport,
      })
    ).toBe("inside");
  });

  it("sits above a footer, and flips inside where above is off screen", () => {
    expect(
      regionMarkPlacement({
        area: "footer",
        edge: { top: 600, bottom: 672 },
        height,
        viewport,
      })
    ).toBe("outside");
    // Scrolled so the footer's top edge is at the head of the canvas.
    expect(
      regionMarkPlacement({
        area: "footer",
        edge: { top: 10, bottom: 82 },
        height,
        viewport,
      })
    ).toBe("inside");
  });

  it("stays outside where inside is off screen too: a region scrolled away", () => {
    expect(
      regionMarkPlacement({
        area: "header",
        edge: { top: -300, bottom: -100 },
        height,
        viewport,
      })
    ).toBe("outside");
    expect(
      regionMarkPlacement({
        area: "footer",
        edge: { top: 900, bottom: 972 },
        height,
        viewport,
      })
    ).toBe("outside");
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
