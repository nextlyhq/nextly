/**
 * Client-side registry of plugin-contributed document views.
 *
 * A document view is a full-screen screen of one document, served under the
 * document's own address: `/admin/collections/<slug>/<id>/<path>`, or
 * `/admin/singles/<slug>/<path>` for a Single. `resolveRoute` asks this
 * registry whether the last segment of such an address names a view the slug
 * actually has, so an address nobody declared renders the not-found page
 * rather than an editor drawing nothing.
 *
 * Module-level singleton (mirrors `plugin-route-registry`), rebuilt from
 * `branding.plugins[].documentViews` when admin-meta loads. The server has
 * already refused malformed, reserved and twice-claimed paths at boot, so this
 * holds exactly what it is given.
 *
 * @module lib/plugins/document-view-registry
 */
import type { PluginMetadata } from "@admin/types/branding";

/**
 * One view, in the shape admin-meta delivers it. Derived from the metadata
 * type rather than restated, so a field the server adds to a view reaches the
 * registry without a second declaration to keep in step.
 */
export type RegisteredDocumentView = NonNullable<
  PluginMetadata["documentViews"]
>[number];

const registry = new Map<string, RegisteredDocumentView>();

/**
 * One key per slug and path. JSON rather than a joined string, because a slug
 * and a path are both free text to this module and a delimiter inside either
 * would make two different pairs one key.
 */
function viewKey(slug: string, path: string): string {
  return JSON.stringify([slug, path]);
}

/** Register every view in `views`, each under its own slug and path. */
export function registerDocumentViews(
  views: readonly RegisteredDocumentView[]
): void {
  for (const view of views) {
    registry.set(viewKey(view.slug, view.path), view);
  }
}

/** The view `slug` declares at `path`, or `undefined` when it declares none. */
export function matchDocumentView(
  slug: string,
  path: string
): RegisteredDocumentView | undefined {
  return registry.get(viewKey(slug, path));
}

/** Clear every registered view (rebuild on admin-meta change / tests). */
export function clearDocumentViews(): void {
  registry.clear();
}

/**
 * The view a route's params name, or `undefined` when they name none.
 *
 * The one reading of a document-view address, shared by the resolver that
 * decides whether the address is found and the page that draws the view, so
 * the two cannot disagree about what is at it. Takes the router's loose param
 * values: a missing or repeated segment names no view.
 */
export function routedDocumentView(
  slug: string | string[] | undefined,
  view: string | string[] | undefined
): RegisteredDocumentView | undefined {
  if (typeof slug !== "string" || typeof view !== "string") return undefined;
  return matchDocumentView(slug, view);
}
