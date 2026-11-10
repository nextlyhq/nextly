/**
 * The one pass that places the tabs drawn on blocks' outlines, from every
 * layer of the canvas's chrome, so that none covers another.
 */
import { describe, expect, it } from "vitest";

import { tabsApart, type TabDraft } from "./canvas-tab-places";
import type { Rect } from "./geometry";

/** A 120px-wide, 22px-high tab on `edge` that may only stand above it. */
const aboveOnly = (edge: Rect, leftmost: number): TabDraft => ({
  block: edge,
  edge,
  places: ["above"],
  side: 0,
  width: 120,
  height: 22,
  foot: 1,
  leftmost,
});

describe("a tab whose every place is taken", () => {
  it("steps left past the box it would cover, where the screen has room", () => {
    // A block from x=400 to 800; a toolbar across the right of its top edge.
    const edge = { x: 400, y: 200, width: 400, height: 40 };
    const toolbar = { x: 600, y: 160, width: 200, height: 40 };
    const [placed] = tabsApart([aboveOnly(edge, 0)], [toolbar]);
    // Wholly left of the toolbar, 2px apart: its right edge at 598.
    expect(placed).toEqual({ at: "above", side: 800 - 598 });
  });

  it("stops at the screen's left edge rather than stepping out of view", () => {
    // The same block at the screen's left edge (x=400), the toolbar across
    // its whole top: stepping past it would start the tab at 400 - 2 - 120.
    const edge = { x: 400, y: 200, width: 400, height: 40 };
    const toolbar = { x: 400, y: 160, width: 400, height: 40 };
    const [placed] = tabsApart([aboveOnly(edge, 400)], [toolbar]);
    // Its box starts at the screen's edge: side = 800 - 120 - 400. Fails on
    // a pass that steps on past it, which gives a side of 800 - 398 = 402.
    expect(placed).toEqual({ at: "above", side: 280 });
  });

  it("keeps its own place where it starts left of the screen's edge alone", () => {
    // Never moved right to reach the screen: a tab placed as it is alone
    // keeps that place, whatever it covers.
    const edge = { x: 400, y: 200, width: 400, height: 40 };
    const toolbar = { x: 400, y: 160, width: 400, height: 40 };
    const draft = { ...aboveOnly(edge, 400), side: 300 };
    const [placed] = tabsApart([draft], [toolbar]);
    expect(placed).toEqual({ at: "above", side: 300 });
  });
});
