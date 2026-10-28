/**
 * Which of the rail's entries are drawn while the answers that decide them arrive.
 *
 * The rail is a column of entries from the top, so an entry that appears after the first paint
 * pushes every entry below it down. Its place is kept by drawing only what is already certain:
 * the entries whose presence AND position are decided, which is every entry up to the first one
 * still waiting on an answer. Entries arriving later are added below the ones drawn, so nothing
 * already painted moves. An undecided entry is never drawn on a guess, since a guess that turned
 * out wrong would have to be taken back, which moves everything below it just the same.
 *
 * @module components/layout/sidebar/lib/settled-rail
 */

import type { MainMenuItem } from "../sidebar-types";

import { CONTENT_RAIL_ID } from "./content-rail";

/** Which of the answers the rail's entries wait on are still unanswered. */
export interface RailAnswersPending {
  /** The workspace answer: whether the builder is shown, and the plugins and their entries. */
  workspace: boolean;
  /** The reader's permission list. */
  permissions: boolean;
  /** The server's answer about collections and Singles, and the two lists the rail reads. */
  content: boolean;
}

/** A standalone plugin's entry, which `placeStandalonePlugins` names after the plugin. */
const isStandaloneEntry = (id: string): boolean => id.startsWith("standalone-");

/**
 * Whether an entry's presence is decided: every answer its visibility reads has arrived. Each
 * case names the answers the rail's visibility rule reads for that entry, in `DualSidebar`.
 */
export function railEntryDecided(
  item: Pick<MainMenuItem, "id" | "requiredPermission">,
  pending: RailAnswersPending
): boolean {
  if (item.requiredPermission && pending.permissions) return false;
  if (isStandaloneEntry(item.id)) {
    // Shown by the collections it names (the content answer) or, naming none, by the settings
    // grant (the permission list).
    return !pending.workspace && !pending.permissions && !pending.content;
  }
  switch (item.id) {
    case CONTENT_RAIL_ID:
      return !pending.content;
    case "plugins":
      // The settings grant shows it, and otherwise a visible plugin-owned collection.
      return !pending.permissions && !pending.content;
    case "media":
    case "settings":
      return !pending.permissions;
    case "builders":
      return !pending.workspace;
    default:
      return true;
  }
}

/**
 * The entries to draw, in order: those shown, up to the first entry not yet decided.
 *
 * `isShown` is the rail's own visibility rule, and is read only for decided entries, where it is
 * final. While the workspace answer is pending the entries themselves are not all known: a
 * plugin's entry may still be placed after any entry, so only the first is certain of its place.
 */
export function settledRailItems<T extends MainMenuItem>(
  items: readonly T[],
  isShown: (item: T) => boolean,
  pending: RailAnswersPending
): T[] {
  const settled: T[] = [];
  for (const item of items) {
    if (!railEntryDecided(item, pending)) break;
    if (isShown(item)) settled.push(item);
    if (pending.workspace) break;
  }
  return settled;
}
