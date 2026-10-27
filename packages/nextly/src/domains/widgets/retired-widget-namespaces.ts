/**
 * The widget namespaces core once filled with a card per collection and per
 * Single, and fills no longer.
 *
 * Core used to mint `collection/<slug>-<kind>` and `single/<slug>-<kind>` cards
 * from the install's content. Those are gone: a card about one collection is
 * now a core widget (`core/count`, `core/breakdown`, `core/over-time`,
 * `core/recent-entries`) whose Collection setting names it. The namespaces stay
 * spelled here because three doors still answer for them: a saved layout drops
 * a card in one when it is read, a layout write refuses one, and the site
 * config may not name one.
 *
 * Judged by NAMESPACE, never by a list of the ids core once made: the ids were
 * derived from each install's own collections, so no list could be complete.
 *
 * Its own module with NO imports, so the config check, which runs wherever a
 * config is read, the CLI included, reads it without loading the widgets.
 *
 * @module domains/widgets/retired-widget-namespaces
 */

/** The namespaces of the per-collection and per-Single cards, as `namespace/` prefixes name them. */
export const RETIRED_WIDGET_NAMESPACES = ["collection", "single"] as const;

/** Whether `widgetId` is in one of the retired namespaces. */
export function inRetiredWidgetNamespace(widgetId: string): boolean {
  return RETIRED_WIDGET_NAMESPACES.some(namespace =>
    widgetId.startsWith(`${namespace}/`)
  );
}
