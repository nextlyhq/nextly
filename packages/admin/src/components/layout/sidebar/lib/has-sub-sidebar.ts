/**
 * Which rail categories own a secondary panel.
 *
 * Standalone plugins are not listed: their ids are generated per install, so
 * they are recognised by prefix rather than enumerated.
 */
const CATEGORIES_WITH_SUB_SIDEBAR: readonly string[] = [
  "collections",
  "singles",
  "media",
  "plugins",
  "settings",
  "builders",
];

/**
 * Whether a rail id is one that owns a secondary panel at all.
 *
 * Media only owns one while the folder tree is visible; treating it as a
 * sub-sidebar category with the tree hidden turns the mobile Media icon into a
 * button that opens nothing instead of a link.
 */
export function isSubSidebarCategory(
  id: string,
  isFolderTreeVisible: boolean
): boolean {
  return (
    (CATEGORIES_WITH_SUB_SIDEBAR.includes(id) &&
      (id !== "media" || isFolderTreeVisible)) ||
    id.startsWith("standalone-")
  );
}

/**
 * Whether the secondary panel is open for the current selection.
 *
 * The panel follows the rail rather than a list of its own. A selection
 * outlives the item it names: it is synced from the pathname and from clicks,
 * and nothing revisits it when a pending query settles into nothing or fails.
 * A second list of panel-owning categories answers the same question as the
 * rail and disagrees in exactly that window, leaving a panel open with nothing
 * to put in it, so the visible destinations decide both.
 */
export function isSubSidebarOpen(
  selectedMain: string,
  visibleMenuItemIds: readonly string[],
  isFolderTreeVisible: boolean,
  suppressed: ReadonlySet<string> = new Set()
): boolean {
  // An immersive surface may ask for the panel to go while keeping the rail: a
  // full-bleed editor wants the width back, not the whole of the admin's
  // navigation. The layout above only drops the sidebar COLUMN when the rail is
  // surrendered too, so without this the `subSidebar` layer is declared,
  // resolved by `resolveSuppressedChrome`, and implemented by nothing.
  //
  // Defaulted to an empty set so every existing caller keeps its behaviour and
  // the parameter is opt-in rather than a change to what "open" means.
  if (suppressed.has("subSidebar")) return false;

  return (
    isSubSidebarCategory(selectedMain, isFolderTreeVisible) &&
    visibleMenuItemIds.includes(selectedMain)
  );
}
