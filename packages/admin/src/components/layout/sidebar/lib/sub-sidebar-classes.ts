/**
 * The secondary panel's layout, as one decision.
 *
 * On the wide layout the panel sits in flow between the icon rail and the main
 * column, and its track keeps the open panel's width whether or not the current
 * selection owns a panel: the main column starts where the track ends, so a
 * track that opened and closed with the selection slid the column sideways on
 * every move between the dashboard and a collection. Only a surface that
 * releases the panel (chrome suppression's `subSidebar` layer, asked for by an
 * immersive editor) takes the width back, and that is a deliberate full-screen
 * change rather than a reflow.
 *
 * On the narrow layout the panel overlays inside the navigation drawer, so it
 * has width only while it is open.
 */

export interface SubSidebarClassInput {
  /**
   * The narrow layout, where the panel overlays instead of sitting in flow.
   *
   * Undefined until the media query resolves, which the panel's other classes
   * already treat as the wide layout, so this does too. Rendering the narrow
   * arrangement first and correcting it would move the panel on the first
   * paint of every load.
   */
  isMobile: boolean | undefined;
  /** Whether the current rail selection owns a panel to show. */
  hasSubSidebar: boolean;
  /** Whether a mounted surface has asked for the panel to go. */
  released: boolean;
}

/** Whether the panel's box has width: the held track on the wide layout, the open panel on the narrow one. */
export function subSidebarHoldsWidth({
  isMobile,
  hasSubSidebar,
  released,
}: SubSidebarClassInput): boolean {
  if (released) return false;
  return isMobile ? hasSubSidebar : true;
}

/**
 * The divider the panel contributes, or none.
 *
 * It follows the box's width, not the selection: a box with no width has no
 * edge to divide, and a border on it would still paint a 1px line flush against
 * the icon rail's own and widen the box from 0 to 1px. The held track keeps its
 * edge while empty, so it reads as the shell's own column rather than as part
 * of the page beside it.
 *
 * The side follows the panel's position: overlaying from the left edge it
 * divides on its left, and in flow beside the rail it divides on its right.
 */
export function subSidebarBorderClass(input: SubSidebarClassInput): string {
  if (!subSidebarHoldsWidth(input)) return "";
  return input.isMobile ? "border-l border-border" : "border-r border-border";
}
