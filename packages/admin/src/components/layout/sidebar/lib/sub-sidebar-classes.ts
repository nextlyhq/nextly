/**
 * The secondary panel's layout, as one decision.
 *
 * On the wide layout the panel sits in flow between the icon rail and the main
 * column, and its track has width when the page's own section owns a panel, or
 * a panel is open. A page with no panel (the dashboard, Releases, Translations)
 * draws no empty column beside the rail.
 *
 * The section comes from the route, so it is known at the first paint, before
 * the reader's permissions and content lists arrive: a collection's page holds
 * its panel's track from its first frame and nothing shifts while the panel's
 * links load. Moving between a page with a panel and one without moves the
 * main column once, as part of the navigation the reader started, and each
 * page is drawn at the geometry a direct load of it draws.
 *
 * A surface that releases the panel (chrome suppression's `subSidebar` layer,
 * asked for by an immersive editor) takes the width back whatever the section.
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
  /**
   * Whether the section the route is in owns a panel at all, whatever the
   * reader turns out to be allowed to see in it. Decided from the route alone,
   * so the track is held from the first paint.
   */
  sectionHasPanel: boolean;
  /** Whether a mounted surface has asked for the panel to go. */
  released: boolean;
}

/** Whether the panel's box has width: the held track on the wide layout, the open panel on the narrow one. */
export function subSidebarHoldsWidth({
  isMobile,
  hasSubSidebar,
  sectionHasPanel,
  released,
}: SubSidebarClassInput): boolean {
  if (released) return false;
  return isMobile ? hasSubSidebar : sectionHasPanel || hasSubSidebar;
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
