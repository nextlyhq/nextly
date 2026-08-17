import type {
  ActiveNavSection,
  NavSection,
} from "@admin/constants/nav-sections";

import type { ApiCollection } from "./entities";

/**
 * The subset of a standalone plugin's metadata that section resolution reads.
 *
 * Narrower than `PluginMetadata` so a caller can supply a literal without
 * constructing fields this decision never consults.
 */
export interface StandalonePluginSummary {
  name: string;
  collections?: string[];
}

/**
 * Everything the active-section decision depends on.
 *
 * Placement arrives as a FUNCTION rather than as resolved values because the
 * caller memoises it over plugin metadata, and re-deriving it here would be a
 * second implementation of a question that already has one.
 */
export interface RouteSectionContext {
  pathname: string;
  /**
   * The `from` search param. Typed as the router reports it: a repeated param
   * parses to an array, which names no section and therefore falls through.
   */
  from?: string | string[];
  collections: ApiCollection[] | undefined;
  getCollectionPlacement: (collection: ApiCollection) => string | undefined;
  standalonePlugins: readonly StandalonePluginSummary[];
  showBuilder: boolean;
}

/**
 * Which rail section a route belongs to.
 *
 * A literal for the routes whose answer is fixed, and a function for the few
 * whose answer depends on data the URL does not carry — a collection's
 * placement, or which standalone plugin owns it. Both forms are DECLARATIONS
 * made by the route; neither is a guess made by the sidebar.
 *
 * The literal arm is `NavSection` rather than `ActiveNavSection` so a
 * standalone id cannot be written as a static literal. The resolver arm returns
 * the wider type, because resolving one at runtime is exactly its job.
 */
export type RouteSection =
  | NavSection
  | ((context: RouteSectionContext) => ActiveNavSection);
