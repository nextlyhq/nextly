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

/** One Layout an author may choose for a page. */
export interface LayoutChoice {
  readonly id: string;
  /** The Layout's title, or its id where it has none. */
  readonly title: string;
  /** Whether the Layout is published now. */
  readonly published: boolean;
  /**
   * Whether a published Layout holds edits a visitor does not see yet. False
   * for one never published: everything about it is unpublished.
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
    /** Whether there were more Layouts than one answer lists. */
    readonly truncated: boolean;
    /** Facts about each region component of a published Layout, by id. */
    readonly regionComponents: Readonly<Record<string, RegionComponentFacts>>;
    /**
     * The PUBLISHED definitions the regions reach, nested components
     * included, by id: what the canvas draws them from, read as the caller.
     */
    readonly regionDefinitions: Readonly<Record<string, BlockDocument>>;
  };
}
