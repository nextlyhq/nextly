/**
 * What the editor and the server say to each other before a publish: which
 * documents the page needs that are not live, and the request to publish them
 * as the author.
 *
 * Shared by the admin bundle and the routes, so it imports nothing.
 *
 * @module publish-readiness-contract
 */

/** Asks what a publish would leave unpublished. Writes nothing. */
export const PUBLISH_READINESS_ROUTE_PATH = "/publish-readiness";

/** Publishes the documents the author chose, each as the author. */
export const PUBLISH_DEPENDENCIES_ROUTE_PATH = "/publish-dependencies";

/**
 * How many documents one publish request may name. A page that needs more than
 * this many components published is not one an author confirms in a dialog.
 */
export const MAX_PUBLISHED_DEPENDENCIES = 50;

/** What a publish is about to put live, as the editor holds it. */
export interface PublishReadinessRequest {
  /** The document's block documents, as they will be stored. */
  readonly documents: readonly unknown[];
  /** The Layout the page names, when it names one. */
  readonly layout?: string | null;
  /**
   * True for a page that names no Layout and still draws its header and
   * footer: it is drawn inside the site's default Layout, which the server
   * reads, so its header and footer components are asked about.
   */
  readonly siteDefault?: boolean;
}

/** The kinds of document a page depends on. */
export type DependencyKind = "component" | "layout";

/** One document the page needs that is not published. */
export interface UnpublishedDependency {
  readonly kind: DependencyKind;
  /** Its id, or an opaque key when the author may not read it. */
  readonly id: string;
  /** Its title, or `null` when the author may not read it. */
  readonly title: string | null;
  /** Whether this author may publish it: the offer names only these. */
  readonly mayPublish: boolean;
}

/** The readiness answer. */
export interface PublishReadinessResponse {
  /**
   * In the order they should be published: a component before the components
   * and Layout that place it, so nothing goes live naming one that is not.
   */
  readonly dependencies: readonly UnpublishedDependency[];
  /**
   * How many components the page places that no longer exist. Publishing
   * cannot help those, so they are counted rather than offered.
   */
  readonly missing: number;
}

/** The documents the author chose to publish beside the page. */
export interface PublishDependenciesRequest {
  readonly dependencies: readonly {
    readonly kind: DependencyKind;
    readonly id: string;
  }[];
}

/** One document the route did not publish, and why, in the author's words. */
export interface RefusedDependency {
  readonly kind: DependencyKind;
  readonly id: string;
  readonly reason: string;
}

/** What publishing the chosen documents came to. */
export interface PublishDependenciesResult {
  readonly published: readonly { kind: DependencyKind; id: string }[];
  readonly refused: readonly RefusedDependency[];
}
