/**
 * The secondary panel's width and its divider.
 *
 * On the wide layout the panel's track has width when the route's section owns
 * a panel, decided from the route so it is held from the first paint, or when
 * a panel is open. A page with no panel draws no empty column. A surface that
 * releases the panel takes the width back. On the narrow layout the panel
 * overlays, and has width only while open.
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
/** A page whose section owns a panel, such as a collection. */
const PANEL_PAGE = { sectionHasPanel: true } as const;
/** A page whose section owns none, such as the dashboard. */
const BARE_PAGE = { sectionHasPanel: false } as const;

describe("subSidebarHoldsWidth", () => {
  it("holds the track from the first paint on a page whose section has a panel", () => {
    // Before the reader's answers arrive the panel is not yet open
    // (`hasSubSidebar` false), but the route already says the section has
    // one: holding the track then is what keeps the main column still while
    // the panel's links load.
    expect(
      subSidebarHoldsWidth({ ...WIDE, ...PANEL_PAGE, hasSubSidebar: false })
    ).toBe(true);
    expect(
      subSidebarHoldsWidth({ ...WIDE, ...PANEL_PAGE, hasSubSidebar: true })
    ).toBe(true);
  });

  it("draws no column on a page whose section has no panel", () => {
    // The separating property: the dashboard, Releases and Translations used
    // to hold an empty 256px column beside the rail.
    expect(
      subSidebarHoldsWidth({ ...WIDE, ...BARE_PAGE, hasSubSidebar: false })
    ).toBe(false);
  });

  it("gives a panel opened from such a page its width", () => {
    // The reader opened a panel from the rail on a page without one.
    expect(
      subSidebarHoldsWidth({ ...WIDE, ...BARE_PAGE, hasSubSidebar: true })
    ).toBe(true);
  });

  it("gives the width back on the wide layout when a surface releases the panel", () => {
    // An immersive editor asks for the panel to go to have the width; holding
    // the track there would leave it an empty column instead.
    expect(
      subSidebarHoldsWidth({
        ...WIDE,
        ...PANEL_PAGE,
        hasSubSidebar: false,
        released: true,
      })
    ).toBe(false);
  });

  it("follows the selection on the narrow layout, where the panel overlays", () => {
    expect(
      subSidebarHoldsWidth({ ...NARROW, ...PANEL_PAGE, hasSubSidebar: true })
    ).toBe(true);
    expect(
      subSidebarHoldsWidth({ ...NARROW, ...PANEL_PAGE, hasSubSidebar: false })
    ).toBe(false);
  });

  it("treats an unresolved layout as the wide one", () => {
    expect(
      subSidebarHoldsWidth({
        isMobile: undefined,
        ...PANEL_PAGE,
        hasSubSidebar: false,
        released: false,
      })
    ).toBe(true);
  });
});

describe("subSidebarBorderClass", () => {
  it("draws nothing when the panel has no width, in either layout", () => {
    expect(
      subSidebarBorderClass({ ...NARROW, ...PANEL_PAGE, hasSubSidebar: false })
    ).toBe("");
    expect(
      subSidebarBorderClass({ ...WIDE, ...BARE_PAGE, hasSubSidebar: false })
    ).toBe("");
    expect(
      subSidebarBorderClass({
        ...WIDE,
        ...PANEL_PAGE,
        hasSubSidebar: false,
        released: true,
      })
    ).toBe("");
  });

  it("divides a held track on the right on the wide layout, open or not", () => {
    for (const hasSubSidebar of [true, false]) {
      expect(
        subSidebarBorderClass({ ...WIDE, ...PANEL_PAGE, hasSubSidebar })
      ).toContain("border-r");
    }
  });

  it("divides on the left when the panel overlays from the left edge", () => {
    expect(
      subSidebarBorderClass({ ...NARROW, ...PANEL_PAGE, hasSubSidebar: true })
    ).toContain("border-l");
  });

  it("pairs every border side with the token that colours it", () => {
    // A side utility with no colour utility inherits `currentColor`, which is
    // the text colour rather than the divider token, so the panel would still
    // paint an edge and it would be the wrong one.
    for (const layout of [WIDE, NARROW]) {
      const className = subSidebarBorderClass({
        ...layout,
        ...PANEL_PAGE,
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
        ...PANEL_PAGE,
        hasSubSidebar: true,
        released: false,
      })
    ).toBe(
      subSidebarBorderClass({ ...WIDE, ...PANEL_PAGE, hasSubSidebar: true })
    );
  });

  it("emits no border utility of any side while it has no width", () => {
    // A border on a zero-width box is still a 1px box, painted flush against
    // the rail's own edge, so the invariant is "no side at all", not "not
    // the right one".
    for (const input of [
      { ...NARROW, ...PANEL_PAGE, hasSubSidebar: false },
      { ...WIDE, ...BARE_PAGE, hasSubSidebar: false },
      { ...WIDE, ...PANEL_PAGE, hasSubSidebar: false, released: true },
    ]) {
      expect(subSidebarBorderClass(input)).not.toMatch(/\bborder(-[a-z]+)?\b/);
    }
  });
});
