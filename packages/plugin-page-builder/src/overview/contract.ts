/**
 * The Page Builder overview's address and its route's answer, apart from the
 * route, so the admin reads them without loading the server code that
 * answers.
 *
 * FREE OF RUNTIME IMPORTS, for the reason `library-contract.ts` gives: the
 * route reaches the Direct API through `nextly/runtime`, which is
 * server-only, and a browser module importing the route for one path
 * constant would bring it along.
 *
 * @module overview/contract
 */

/** Where the route is mounted under the plugin, and the page's own path. */
export const OVERVIEW_ROUTE_PATH = "/overview";

/**
 * Where the overview page is, relative to the admin: the plugin's admin page
 * at the same path, as the "Bindings to fix" page is.
 */
export const OVERVIEW_ADMIN_PATH: string = `plugins/nextlyhq-plugin-page-builder${OVERVIEW_ROUTE_PATH}`;

/** The overview's address from the admin's root, which the rail item opens. */
export const OVERVIEW_PAGE_HREF: string = `/admin/${OVERVIEW_ADMIN_PATH}`;

/** The four libraries, in the order the panel and the overview list them. */
export const LIBRARY_KINDS = [
  "patterns",
  "components",
  "layouts",
  "templates",
] as const;

/** One of the libraries. */
export type LibraryKind = (typeof LIBRARY_KINDS)[number];

/** One library as the reader may see it. */
export interface OverviewLibrary {
  readonly kind: LibraryKind;
  /** The collection's slug as the site registered it, which its links name. */
  readonly collection: string;
  /** How many entries the reader may read; `null` when it could not be read. */
  readonly count: number | null;
  /** Whether the reader may create an entry, which offers New. */
  readonly mayCreate: boolean;
}

/** A collection or Single with a Page Builder field, as the reader knows it. */
export interface OverviewUse {
  readonly kind: "collection" | "single";
  readonly slug: string;
  /** Its name as the admin shows it: a collection's plural, a Single's label. */
  readonly label: string;
  /** The first Page Builder field it has, by its label. */
  readonly field: string;
  /** A collection's entries the reader may read, when they could be counted. */
  readonly entries?: number;
}

/** The route's answer. */
export interface PageBuilderOverview {
  /** The libraries the reader may read, in {@link LIBRARY_KINDS} order. */
  readonly libraries: readonly OverviewLibrary[];
  /** The collections, then the Singles, the reader may read, each by name. */
  readonly usedIn: readonly OverviewUse[];
}
