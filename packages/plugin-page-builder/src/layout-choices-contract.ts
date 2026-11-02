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

/** The longest Layout id the route accepts, as an entry id is bounded. */
export const LAYOUT_ID_MAX = 200;

/** The choices route's path, asking about the page's selected Layout. */
export function layoutChoicesPath(selected: string | null): string {
  if (selected === null || selected === "") return LAYOUT_CHOICES_ROUTE_PATH;
  const query = new URLSearchParams({
    [LAYOUT_CHOICES_SELECTED_PARAM]: selected,
  });
  return `${LAYOUT_CHOICES_ROUTE_PATH}?${query.toString()}`;
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
   * one and the site's default, and only for an author who may update
   * Layouts: false for every other row.
   */
  readonly draftChangesNotLive: boolean;
  /**
   * The regions the PUBLISHED Layout fills, which is what a visitor gets.
   * Empty for a Layout that is not published, which no page is drawn inside.
   */
  readonly regions: readonly LayoutRegion[];
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
    /** The site's default Layout, by id, or null when none is set. */
    readonly defaultLayout: string | null;
    /**
     * The Layouts collection's RESOLVED slug, so "Edit Layout" opens the
     * collection the site actually has, renamed or not.
     */
    readonly layoutsCollection: string;
    /** Whether the caller may update Layouts, which offers "Edit Layout". */
    readonly canUpdateLayouts: boolean;
    /**
     * Facts about the region components of the selected Layout and the
     * default, by id, for an author who may update components.
     */
    readonly regionComponents: Readonly<Record<string, RegionComponentFacts>>;
    /**
     * The PUBLISHED definitions the regions reach, nested components
     * included, by id: what the canvas draws them from, read as the caller.
     */
    readonly regionDefinitions: Readonly<Record<string, BlockDocument>>;
  };
}
