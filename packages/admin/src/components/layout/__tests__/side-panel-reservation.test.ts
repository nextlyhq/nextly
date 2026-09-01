/**
 * How much of the window's edge is kept clear for the panels that are open.
 *
 * The property worth guarding is that overlapping panels do not ADD: they are
 * pinned to the same edge and cover each other, so two 480px panels still
 * occupy 480. Summing is the natural way to write this and it is wrong only in
 * the rare two-panel state, which is the state nobody opens by hand.
 *
 * @module components/layout/__tests__/side-panel-reservation.test
 */
import { describe, expect, it } from "vitest";

import { resolveReservedInlineEnd } from "../lib/side-panel-reservation";

describe("the width kept clear", () => {
  it("is nothing when no panel is open", () => {
    // The default the layout runs in almost all the time: no panel, no indent.
    expect(resolveReservedInlineEnd([])).toBe(0);
  });

  it("is the panel's own width when one is open", () => {
    expect(resolveReservedInlineEnd([{ width: 480 }])).toBe(480);
  });

  it("is the WIDEST of several, not their total", () => {
    // 960 would indent the page past two panels that occupy one edge between
    // them, emptying half the window in a state nobody looks at.
    expect(resolveReservedInlineEnd([{ width: 480 }, { width: 480 }])).toBe(
      480
    );
    expect(resolveReservedInlineEnd([{ width: 320 }, { width: 480 }])).toBe(
      480
    );
  });

  it("does not depend on the order they registered in", () => {
    // The control for the case above: a resolver returning the LAST width would
    // satisfy both assertions there, and would shrink the reservation whenever
    // a narrow panel happened to open second.
    expect(resolveReservedInlineEnd([{ width: 480 }, { width: 320 }])).toBe(
      480
    );
  });
});
