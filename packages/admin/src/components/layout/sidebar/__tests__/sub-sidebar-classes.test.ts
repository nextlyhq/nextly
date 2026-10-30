/**
 * The secondary panel's width and its divider.
 *
 * On the wide layout the panel's track keeps its width whether or not the
 * selection owns a panel, so the main column beside it never moves; only a
 * surface that releases the panel takes the width back. On the narrow layout
 * the panel overlays, and has width only while open.
 *
 * A border on a zero-width box is still a 1px box, painted a pixel from the
 * rail's own edge, so the divider follows the width, not the selection.
 */
import { describe, expect, it } from "vitest";

import {
  subSidebarBorderClass,
  subSidebarHoldsWidth,
} from "../lib/sub-sidebar-classes";

const WIDE = { isMobile: false, released: false } as const;
const NARROW = { isMobile: true, released: false } as const;

describe("subSidebarHoldsWidth", () => {
  it("holds the panel's width on the wide layout whether or not the selection owns a panel", () => {
    // The separating property: the main column's left edge follows this box,
    // so a track that took its width from the selection would slide the
    // column 256 px each time a reader moved between the dashboard and a
    // collection.
    expect(subSidebarHoldsWidth({ ...WIDE, hasSubSidebar: true })).toBe(true);
    expect(subSidebarHoldsWidth({ ...WIDE, hasSubSidebar: false })).toBe(true);
  });

  it("gives the width back on the wide layout when a surface releases the panel", () => {
    // An immersive editor asks for the panel to go to have the width; holding
    // the track there would leave it an empty column instead.
    expect(
      subSidebarHoldsWidth({ ...WIDE, hasSubSidebar: false, released: true })
    ).toBe(false);
  });

  it("follows the selection on the narrow layout, where the panel overlays", () => {
    expect(subSidebarHoldsWidth({ ...NARROW, hasSubSidebar: true })).toBe(true);
    expect(subSidebarHoldsWidth({ ...NARROW, hasSubSidebar: false })).toBe(
      false
    );
  });

  it("treats an unresolved layout as the wide one", () => {
    expect(
      subSidebarHoldsWidth({
        isMobile: undefined,
        hasSubSidebar: false,
        released: false,
      })
    ).toBe(true);
  });
});

describe("subSidebarBorderClass", () => {
  it("draws nothing when the panel has no width, in either layout", () => {
    expect(subSidebarBorderClass({ ...NARROW, hasSubSidebar: false })).toBe("");
    expect(
      subSidebarBorderClass({ ...WIDE, hasSubSidebar: false, released: true })
    ).toBe("");
  });

  it("divides the held track on the right on the wide layout, open or not", () => {
    // The track keeps its width with nothing in it, so it keeps its edge too:
    // without one the empty track reads as part of the page beside it.
    for (const hasSubSidebar of [true, false]) {
      expect(subSidebarBorderClass({ ...WIDE, hasSubSidebar })).toContain(
        "border-r"
      );
    }
  });

  it("divides on the left when the panel overlays from the left edge", () => {
    expect(subSidebarBorderClass({ ...NARROW, hasSubSidebar: true })).toContain(
      "border-l"
    );
  });

  it("pairs every border side with the token that colours it", () => {
    // A side utility with no colour utility inherits `currentColor`, which is
    // the text colour rather than the divider token, so the panel would still
    // paint an edge and it would be the wrong one.
    for (const layout of [WIDE, NARROW]) {
      const className = subSidebarBorderClass({
        ...layout,
        hasSubSidebar: true,
      });
      expect(className).toContain("border-border");
    }
  });

  it("treats an unresolved layout as the wide one", () => {
    // The media query has no answer on the first render. Choosing the narrow
    // arrangement there would divide on the wrong side and then switch sides
    // once it resolves, moving the panel on the first paint of every load.
    expect(
      subSidebarBorderClass({
        isMobile: undefined,
        hasSubSidebar: true,
        released: false,
      })
    ).toBe(subSidebarBorderClass({ ...WIDE, hasSubSidebar: true }));
  });

  it("emits no border utility of any side while it has no width", () => {
    // A border on a zero-width box is still a 1px box, painted flush against
    // the rail's own edge, so the invariant is "no side at all", not "not
    // the right one".
    for (const input of [
      { ...NARROW, hasSubSidebar: false },
      { ...WIDE, hasSubSidebar: false, released: true },
    ]) {
      expect(subSidebarBorderClass(input)).not.toMatch(/\bborder(-[a-z]+)?\b/);
    }
  });
});
