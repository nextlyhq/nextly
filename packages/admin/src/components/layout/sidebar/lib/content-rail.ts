/**
 * The rail's Content item and the two sections it stands for.
 *
 * Routes still belong to `collections` or `singles`, the sections the route
 * registry declares, and the panel still shows one of them at a time. Only the
 * rail folds them into one item, so this is the one place that says which
 * sections that item covers: the rail's selected state, its visibility and the
 * panel's open state all read it rather than listing the two sections again.
 */

import { ROUTES } from "@admin/constants/routes";

/** The rail id of the Content item. */
export const CONTENT_RAIL_ID = "content";

/** The sections the Content item covers, in the order its control shows them. */
const CONTENT_SECTIONS = ["collections", "singles"] as const;

export type ContentSection = (typeof CONTENT_SECTIONS)[number];

/**
 * Each part's address. The panel's links and the rail's fallback both read it,
 * so the two can't name different pages for one part.
 */
export const CONTENT_SECTION_HREF: Readonly<Record<ContentSection, string>> = {
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
export interface ContentPanelView {
  /** The part whose list shows. */
  shown: ContentSection;
  /** The part that isn't showing. */
  other: ContentSection;
  /** Whether there are two parts to switch between. */
  showControl: boolean;
  /** Whether the part that isn't showing has matches for the search. */
  otherHasMatches: boolean;
  /** Whether the search found nothing in the part that shows. */
  shownIsEmpty: boolean;
}

/**
 * Decides what the Content panel shows, from what each part holds.
 *
 * A pure function so the panel only draws: every choice it makes about which
 * part shows and what the search says lives here.
 */
export function contentPanelView({
  part,
  search,
  available,
  matches,
  loading,
}: {
  /** The part the route asks for. */
  part: ContentSection;
  search: string;
  /** Whether the reader has anything of each kind to list. */
  available: Readonly<Record<ContentSection, boolean>>;
  /** How many of each kind match the search. */
  matches: Readonly<Record<ContentSection, number>>;
  /** Whether each kind's list is still loading. */
  loading: Readonly<Record<ContentSection, boolean>>;
}): ContentPanelView {
  // With one kind to list there is nothing to choose between, so the control
  // goes and that kind's list shows alone.
  const shown: ContentSection = available[part]
    ? part
    : available.collections
      ? "collections"
      : "singles";
  const other: ContentSection =
    shown === "collections" ? "singles" : "collections";
  const showControl = available.collections && available.singles;
  const searching = search !== "";
  return {
    shown,
    other,
    showControl,
    otherHasMatches: showControl && searching && matches[other] > 0,
    // A list still loading has not found nothing yet.
    shownIsEmpty: searching && matches[shown] === 0 && !loading[shown],
  };
}
