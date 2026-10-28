/**
 * The widget namespaces core once filled with a card per collection and per
 * Single, and fills no longer.
 *
 * Core used to mint `collection/<slug>-<kind>` and `single/<slug>-<kind>` cards
 * from the install's content. Those are gone: a card about one collection is
 * now a core widget (`core/count`, `core/breakdown`, `core/over-time`,
 * `core/recent-entries`) whose Collection setting names it. The namespaces stay
 * spelled here because four doors still answer for them: a saved layout drops
 * a card in one when it is read, a layout write refuses one, the site config
 * may not name one, and the registry registers none.
 *
 * Judged by NAMESPACE, never by a list of the ids core once made: the ids were
 * derived from each install's own collections, so no list could be complete.
 *
 * Its own module importing only core's widget ids (themselves importing
 * nothing), so the config check, which runs wherever a config is read, the CLI
 * included, reads it without loading the widgets.
 *
 * @module domains/widgets/retired-widget-namespaces
 */

import { CORE_WIDGET_ID } from "./core-widgets/ids";

/** The namespaces of the per-collection and per-Single cards, as `namespace/` prefixes name them. */
export const RETIRED_WIDGET_NAMESPACES = ["collection", "single"] as const;

type RetiredNamespace = (typeof RETIRED_WIDGET_NAMESPACES)[number];

/**
 * The slug a retired card was minted from: `collection/blog-posts-count` gives
 * `blog-posts`. Each id was `<namespace>/<slug>-<kind>` with a one-word kind,
 * so the slug is all but the last segment; an id of any other shape is named
 * whole.
 */
function mintedSlug(widgetId: string, namespace: RetiredNamespace): string {
  const rest = widgetId.slice(namespace.length + 1);
  const cut = rest.lastIndexOf("-");
  return cut > 0 ? rest.slice(0, cut) : rest;
}

/**
 * What a retired card is and what replaced it, said after its id: `"<id>" is a
 * retired card: ...`.
 *
 * 🔴 Each says only what is true of its own namespace. A per-collection card's
 * place is a core widget set to that collection; a Single has no such widget,
 * since those widgets offer collections only, and its edits show in Recently
 * edited, so a per-Single card is never told to pick a collection. The widgets
 * are named by their titles here, as a person finds them in the add panel; this
 * module cannot load them (see above), so the titles are spelled out.
 */
const RETIRED_CARD: Record<RetiredNamespace, (slug: string) => string> = {
  collection: slug =>
    `is a retired card: core no longer makes a card per collection. Add Count, Breakdown, Over time or Recent entries and set its Collection to ${slug}.`,
  single: () =>
    `is a retired card: core no longer makes a card per Single. A Single's edits show in Recently edited (${CORE_WIDGET_ID.recentlyEdited}).`,
};

/** The retired namespace `widgetId` is in, or `undefined`. */
function retiredNamespaceOf(widgetId: string): RetiredNamespace | undefined {
  return RETIRED_WIDGET_NAMESPACES.find(namespace =>
    widgetId.startsWith(`${namespace}/`)
  );
}

/** Whether `widgetId` is in one of the retired namespaces. */
export function inRetiredWidgetNamespace(widgetId: string): boolean {
  return retiredNamespaceOf(widgetId) !== undefined;
}

/**
 * What the card `widgetId` names is, as every door that refuses one says it
 * after the id (`"<id>" is a retired card: ...`), or `undefined` for an id in
 * no retired namespace.
 */
export function retiredWidgetReplacement(widgetId: string): string | undefined {
  const namespace = retiredNamespaceOf(widgetId);
  return namespace === undefined
    ? undefined
    : RETIRED_CARD[namespace](mintedSlug(widgetId, namespace));
}
