/**
 * What the Layout choices route answers, shared by the route and the editor
 * that reads it.
 *
 * Its own module, free of server imports, so the admin bundle that draws the
 * Layout picker takes the shapes without the route's reads.
 *
 * @module layout-choices-contract
 */
import type { BlockDocument, LayoutRegion } from "@nextlyhq/blocks-engine";

import type { FencedLayoutState } from "./layout-removal/words";

/** Where the Layout choices are read, under this plugin's own namespace. */
export const LAYOUT_CHOICES_ROUTE_PATH = "/layouts/choices";

/**
 * The query parameter naming the Layout the page has selected, by id.
 *
 * The list is bounded, so a site with more Layouts than one answer holds can
 * have the page's own Layout past the bound. Named here, it is answered for
 * whatever the bound cut, as the site's default always is.
 */
export const LAYOUT_CHOICES_SELECTED_PARAM = "selected";

/** The query parameter naming the language region content is read in. */
export const LAYOUT_CHOICES_LOCALE_PARAM = "locale";

/**
 * The query parameter searching Layout titles. The list is bounded, so a site
 * with more Layouts than one answer holds finds the rest by title.
 */
export const LAYOUT_CHOICES_SEARCH_PARAM = "q";

/** The longest Layout id the route accepts, as an entry id is bounded. */
export const LAYOUT_ID_MAX = 200;

/** The longest language code the route accepts, past any real BCP 47 tag. */
export const LAYOUT_LOCALE_MAX = 35;

/** The longest search the route accepts. */
export const LAYOUT_SEARCH_MAX = 200;

/**
 * The choices route's path: about the page's selected Layout, in the language
 * being edited, optionally searching titles. An absent value is left out
 * rather than sent empty, so the path, which is the read's cache key, is the
 * same for the same question.
 */
export function layoutChoicesPath(
  selected: string | null,
  options: { locale?: string | null; search?: string } = {}
): string {
  const query = new URLSearchParams();
  if (selected !== null && selected !== "") {
    query.set(LAYOUT_CHOICES_SELECTED_PARAM, selected);
  }
  const locale = options.locale ?? "";
  if (locale !== "") query.set(LAYOUT_CHOICES_LOCALE_PARAM, locale);
  const search = options.search?.trim() ?? "";
  if (search !== "") query.set(LAYOUT_CHOICES_SEARCH_PARAM, search);
  const text = query.toString();
  return text === ""
    ? LAYOUT_CHOICES_ROUTE_PATH
    : `${LAYOUT_CHOICES_ROUTE_PATH}?${text}`;
}

/**
 * Where the admin asks which collection holds the plugin's pages.
 *
 * Asked rather than known: a host may rename the collection, renames resolve
 * on the server at boot, and the admin's static contribution is built before
 * they do. The Layout picker draws only on that collection's forms.
 */
export const PAGE_COLLECTION_ROUTE_PATH = "/layouts/page-collection";

/** The page collection route's answer. */
export interface PageCollectionResponse {
  /** The pages collection's RESOLVED slug. */
  readonly pagesCollection: string;
  /**
   * The Layouts collection's RESOLVED slug, so a surface drawn on every entry
   * form (Remove Layout) can tell a Layout's form, renamed or not.
   */
  readonly layoutsCollection: string;
}

/**
 * One Layout an author may choose for a page.
 *
 * The list holds the Layouts sorted by title up to a bound, then the selected
 * Layout and the default when the bound cut either, so the two a page can be
 * drawn inside are always answered for.
 */
export interface LayoutChoice {
  readonly id: string;
  /** The Layout's title, or its id where it has none. */
  readonly title: string;
  /** Whether the Layout is published now. */
  readonly published: boolean;
  /**
   * Whether a published Layout holds edits a visitor does not see yet. False
   * for one never published: everything about it is unpublished.
   *
   * Asked only of the two Layouts a page can be drawn inside, its selected
   * one and the site's default, and true only for a caller who may see that
   * Layout's working draft (update or publish it), as the service decides:
   * false for every other row.
   */
  readonly draftChangesNotLive: boolean;
  /**
   * The regions the PUBLISHED Layout fills, which is what a visitor gets.
   * Empty for a Layout that is not published, which no page is drawn inside.
   */
  readonly regions: readonly LayoutRegion[];
  /**
   * Where the Layout stands with Remove Layout, when it is behind its fence:
   * being removed now, or unpublished by it and not published since. A page
   * write naming it is refused, so the picker offers it no longer. Absent for
   * every other Layout.
   */
  readonly removal?: FencedLayoutState;
}

/** What the editor needs to know about one region's component. */
export interface RegionComponentFacts {
  /** Whether the component holds edits a visitor does not see yet. */
  readonly draftChangesNotLive: boolean;
}

/** The route's answer: the canonical list envelope. */
export interface LayoutChoicesResponse {
  readonly items: readonly LayoutChoice[];
  readonly meta: {
    /**
     * The site's default Layout, by id: null when none is set, and null when
     * the caller's own reads do not return it.
     */
    readonly defaultLayout: string | null;
    /**
     * Whether a default is set that the caller's reads do not return: hidden
     * from them, or gone. Which one, and its id, they are not told.
     */
    readonly defaultUnreadable: boolean;
    /**
     * The Layouts collection's RESOLVED slug, so "Edit Layout" opens the
     * collection the site actually has, renamed or not.
     */
    readonly layoutsCollection: string;
    /**
     * Whether the caller may update Layouts, which offers "Edit Layout". Only
     * that: who is told of a draft is the service's decision, per row.
     */
    readonly canUpdateLayouts: boolean;
    /**
     * Whether more Layouts match than the list holds: the picker then offers
     * a search, since the rest are reachable by title.
     */
    readonly more: boolean;
    /**
     * The ids of the rows the list itself returned: for a search, the ones
     * whose title the database matched to the query. Rows added whatever the
     * query (the page's selected Layout and the default) are not here, so a
     * search shows exactly what matched.
     */
    readonly matched: readonly string[];
    /**
     * Facts about the region components of the selected Layout and the
     * default, by id, telling of a draft only to a caller who may see the
     * component's working draft (update or publish it). A region has draft
     * changes when any component it draws does, nested ones included.
     */
    readonly regionComponents: Readonly<Record<string, RegionComponentFacts>>;
    /**
     * The PUBLISHED definitions the regions of the selected Layout and the
     * default reach, nested components included, by id: what the canvas draws
     * them from, read as the caller. Only those two can be drawn, so only
     * theirs are sent, which bounds the answer whatever the list holds.
     */
    readonly regionDefinitions: Readonly<Record<string, BlockDocument>>;
  };
}
