/**
 * Which Layout a page is drawn inside.
 *
 * One rule for every reader, so the render, the editor's preview of the
 * regions and a test asking "what does this page get" cannot disagree:
 *
 * 1. A page that switches its header and footer off gets none, whatever
 *    Layout it also names. The switch wins, whoever wrote the page.
 * 2. Otherwise the Layout the page names, while it is published now.
 * 3. Otherwise the site's default Layout, while it is published now: a page
 *    naming nothing, or naming a Layout that is gone or not published.
 * 4. Otherwise none. A site whose default is missing or not published draws
 *    its pages with no regions, and says why, rather than drawing a Layout
 *    nobody published.
 *
 * Pure: the caller supplies what is published, so this reads no store and
 * runs wherever a document is drawn.
 *
 * @module resolve-layout
 */

/** What a page stores about the Layout it is drawn inside. */
export interface PageLayoutChoice {
  /** The Layout the page names, by id; absent or null for the site default. */
  readonly layout?: string | null;
  /** Whether the page is drawn with no header or footer at all. */
  readonly noHeaderFooter?: boolean | null;
}

/** What the rule needs to know about the site's Layouts. */
export interface LayoutSite {
  /** The site's default Layout, by id; null where none is set. */
  readonly defaultLayout: string | null;
  /** Whether a Layout, by id, is published now. A missing one is not. */
  readonly isPublished: (id: string) => boolean;
}

/** The Layout a page is drawn inside, and why; or none, and why. */
export type LayoutResolution =
  | {
      readonly kind: "layout";
      readonly id: string;
      /** Whose choice it is: the page's own, or the site's default. */
      readonly source: "page" | "default";
      /**
       * Why a page that named a Layout got the default instead: the Layout
       * it names is not published now (or no longer exists).
       */
      readonly fellBackFrom?: string;
    }
  | {
      readonly kind: "none";
      /**
       * `switched-off`: the page asked for no header or footer.
       * `no-default`: the page falls back to a default that is not set or
       * not published now, which the site should be told about.
       */
      readonly reason: "switched-off" | "no-default";
      readonly fellBackFrom?: string;
    };

/**
 * The Layout `page` gets, by the rule above.
 *
 * @experimental Shared by the page route's Layout drawing and the plugin, and
 * may still change before Layouts are marked stable.
 */
export function resolvePageLayout(
  page: PageLayoutChoice,
  site: LayoutSite
): LayoutResolution {
  if (page.noHeaderFooter === true) {
    return { kind: "none", reason: "switched-off" };
  }
  const named = page.layout ?? null;
  if (named !== null && site.isPublished(named)) {
    return { kind: "layout", id: named, source: "page" };
  }
  const fellBack = named === null ? {} : { fellBackFrom: named };
  const fallback = site.defaultLayout;
  if (fallback !== null && site.isPublished(fallback)) {
    return { kind: "layout", id: fallback, source: "default", ...fellBack };
  }
  return { kind: "none", reason: "no-default", ...fellBack };
}
