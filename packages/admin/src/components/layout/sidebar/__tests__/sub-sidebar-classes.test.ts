/**
 * The secondary panel draws a divider only when it has width.
 *
 * The panel stays mounted while closed so the transition has something to
 * animate, so "closed" is a zero-width box rather than an absent element. A
 * border on a zero-width box is still a 1px box, and in the wide layout the
 * closed panel keeps its opacity — so an unconditional border renders a second
 * vertical line a pixel from the rail's own, and widens the panel from 0 to 1.
 *
 * The assertion is "no border utility at all" rather than "not `border-r`",
 * because the defect is a painted edge and any side would paint one.
 */
import { describe, expect, it } from "vitest";

import { subSidebarBorderClass } from "../lib/sub-sidebar-classes";

describe("subSidebarBorderClass", () => {
  it("draws nothing when the panel is collapsed, in either layout", () => {
    for (const isMobile of [true, false]) {
      expect(subSidebarBorderClass({ isMobile, hasSubSidebar: false })).toBe(
        ""
      );
    }
  });

  it("divides on the right when the panel sits in flow beside the rail", () => {
    expect(
      subSidebarBorderClass({ isMobile: false, hasSubSidebar: true })
    ).toContain("border-r");
  });

  it("divides on the left when the panel overlays from the left edge", () => {
    expect(
      subSidebarBorderClass({ isMobile: true, hasSubSidebar: true })
    ).toContain("border-l");
  });

  it("pairs every border side with the token that colours it", () => {
    // A side utility with no colour utility inherits `currentColor`, which is
    // the text colour rather than the divider token, so the panel would still
    // paint an edge and it would be the wrong one.
    for (const isMobile of [true, false]) {
      const className = subSidebarBorderClass({
        isMobile,
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
      subSidebarBorderClass({ isMobile: undefined, hasSubSidebar: true })
    ).toBe(subSidebarBorderClass({ isMobile: false, hasSubSidebar: true }));
  });

  it("emits no border utility of any side while collapsed", () => {
    // The separating property: an implementation that swapped `border-r` for
    // `border-l` when collapsed would satisfy the first case's exact-match on
    // "" only by accident. This states the invariant the pixel depends on.
    for (const isMobile of [true, false]) {
      const className = subSidebarBorderClass({
        isMobile,
        hasSubSidebar: false,
      });
      expect(className).not.toMatch(/\bborder(-[a-z]+)?\b/);
    }
  });
});
