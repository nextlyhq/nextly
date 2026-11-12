/**
 * The rail's Content item and the two sections it stands for.
 *
 * Routes still belong to `collections` or `singles`, the sections the route
 * registry declares, and the panel lists both, each under its heading. Only
 * the rail folds them into one item, so this is the one place that says which
 * sections that item covers: the rail's selected state, its visibility and the
 * panel's open state all read it rather than listing the two sections again.
 */

import { ROUTES } from "@admin/constants/routes";

/** The rail id of the Content item. */
export const CONTENT_RAIL_ID = "content";

/** The Content overview, where the panel's title goes. */
export const CONTENT_OVERVIEW_HREF = "/admin/content";

/** The sections the Content item covers, in the order the panel lists them. */
const CONTENT_SECTIONS = ["collections", "singles"] as const;

export type ContentSection = (typeof CONTENT_SECTIONS)[number];

/** Each part's address, where the rail's fallback goes. */
const CONTENT_SECTION_HREF: Readonly<Record<ContentSection, string>> = {
  collections: ROUTES.COLLECTIONS,
  singles: ROUTES.SINGLES,
};

/** Whether a section is one of the Content item's. */
export function isContentSection(section: string): section is ContentSection {
  return (CONTENT_SECTIONS as readonly string[]).includes(section);
}

/** The rail item a section is shown under: Content for both content sections. */
export function railItemOf(section: string): string {
  return isContentSection(section) ? CONTENT_RAIL_ID : section;
}

/**
 * The section selecting the Content item opens.
 *
 * The item is a button, not a link: it opens the panel and navigates nowhere.
 * Already in a content section the reader can see, it stays there; otherwise
 * it opens the first kind the reader may read, so a reader of Singles alone is
 * never shown the Collections part, which they cannot open.
 */
export function contentSectionToOpen(
  current: string,
  available: Readonly<Record<ContentSection, boolean>>
): ContentSection {
  if (isContentSection(current) && available[current]) return current;
  return available.collections ? "collections" : "singles";
}

/**
 * The section the sidebar shows for a selection: a content section is read
 * against what the reader can see now, so one chosen before the lists settled
 * (Collections, while a Singles-only reader's collections were still loading)
 * gives way to the kind there is. Any other section shows as selected.
 */
export function sectionShown<S extends string>(
  selected: S,
  available: Readonly<Record<ContentSection, boolean>>
): S | ContentSection {
  return isContentSection(selected)
    ? contentSectionToOpen(selected, available)
    : selected;
}

/**
 * Where the Content item goes when selected: nowhere while it has a panel to
 * open, and to the part it would have opened when the panel is suppressed.
 */
export function contentItemHref({
  panelShown,
  current,
  available,
}: {
  /** Whether the Content panel can open on this surface. */
  panelShown: boolean;
  current: string;
  available: Readonly<Record<ContentSection, boolean>>;
}): string {
  // A surface that suppresses the panel leaves selecting Content nothing to
  // show, so the item goes to the part it would have opened instead.
  return panelShown
    ? "#"
    : CONTENT_SECTION_HREF[contentSectionToOpen(current, available)];
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

/** What the Content panel shows for one search. */
interface ContentPanelView {
  /** Whether each kind's heading shows. */
  shows: Readonly<Record<ContentSection, boolean>>;
  /** Whether the search found nothing under any heading that shows. */
  nothingMatches: boolean;
}

/**
 * Decides what the Content panel shows, from what each kind holds.
 *
 * A pure function so the panel only draws: every choice it makes about which
 * headings show and what the search says lives here.
 */
export function contentPanelView({
  search,
  available,
  totals,
  matches,
  complete,
}: {
  search: string;
  /** Whether the reader may read anything of each kind. */
  available: Readonly<Record<ContentSection, boolean>>;
  /** How many of each kind the panel lists before any search. */
  totals: Readonly<Record<ContentSection, number>>;
  /** How many of each kind match the search. */
  matches: Readonly<Record<ContentSection, number>>;
  /** Whether each kind's list has fully arrived. */
  complete: Readonly<Record<ContentSection, boolean>>;
}): ContentPanelView {
  // A kind the reader may not read has no heading; nor does one that turned
  // out to list nothing. Until its list arrives it keeps its heading, so the
  // panel doesn't draw one in later.
  const shows = {
    collections:
      available.collections &&
      (!complete.collections || totals.collections > 0),
    singles: available.singles && (!complete.singles || totals.singles > 0),
  };
  return {
    shows,
    // A list still arriving has not found nothing yet: the match may be on a
    // page still on its way.
    nothingMatches:
      search !== "" &&
      CONTENT_SECTIONS.every(
        kind => !shows[kind] || (complete[kind] && matches[kind] === 0)
      ),
  };
}
