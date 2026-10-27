/**
 * The rail's Content item and the two sections it stands for.
 *
 * Routes still belong to `collections` or `singles`, the sections the route
 * registry declares, and the panel still shows one of them at a time. Only the
 * rail folds them into one item, so this is the one place that says which
 * sections that item covers: the rail's selected state, its visibility and the
 * panel's open state all read it rather than listing the two sections again.
 */

/** The rail id of the Content item. */
export const CONTENT_RAIL_ID = "content";

/** The sections the Content item covers, in the order its control shows them. */
export const CONTENT_SECTIONS = ["collections", "singles"] as const;

export type ContentSection = (typeof CONTENT_SECTIONS)[number];

/** Whether a section is one of the Content item's. */
export function isContentSection(section: string): section is ContentSection {
  return (CONTENT_SECTIONS as readonly string[]).includes(section);
}

/** The rail item a section is shown under: Content for both content sections. */
export function railItemOf(section: string): string {
  return isContentSection(section) ? CONTENT_RAIL_ID : section;
}

/**
 * The rail ids the panel reads to decide whether it is open: the Content item
 * expanded into whichever of its sections the reader can see, since the panel
 * shows a section, not the item.
 */
export function panelSectionIds(
  railIds: readonly string[],
  available: Readonly<Record<ContentSection, boolean>>
): string[] {
  return railIds.flatMap(id =>
    id === CONTENT_RAIL_ID ? CONTENT_SECTIONS.filter(s => available[s]) : [id]
  );
}
