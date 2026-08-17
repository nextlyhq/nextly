/**
 * The secondary panel's layout classes, as one decision.
 *
 * The panel is always mounted so that opening and closing it can animate, so
 * "closed" is a zero-width box rather than an absent element. That makes its
 * decoration a separate question from its presence, and the two disagree: a
 * border on a `w-0` box is still a 1px box.
 */

export interface SubSidebarClassInput {
  /** The narrow layout, where the panel overlays instead of sitting in flow. */
  isMobile: boolean;
  /** Whether the current rail selection owns a panel to show. */
  hasSubSidebar: boolean;
}

/**
 * The divider the panel contributes, or none.
 *
 * A panel with no width has no edge to divide, so it draws nothing. Leaving the
 * border on unconditionally paints it flush against the icon rail's own border
 * — two 1px lines a pixel apart — and widens the collapsed panel from 0 to 1px,
 * shifting the content region right. The wide layout is where this shows,
 * because there the panel keeps its opacity when closed.
 *
 * The side follows the panel's position: overlaying from the left edge it
 * divides on its left, and in flow beside the rail it divides on its right.
 */
export function subSidebarBorderClass({
  isMobile,
  hasSubSidebar,
}: SubSidebarClassInput): string {
  if (!hasSubSidebar) return "";
  return isMobile ? "border-l border-border" : "border-r border-border";
}
