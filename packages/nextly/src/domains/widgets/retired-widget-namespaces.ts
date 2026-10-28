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
 * What took each namespace's place, said after a card's id: "is <this>".
 *
 * 🔴 Each says only what is true of its own namespace. A per-collection card's
 * place is a core widget set to that collection; a Single has no such widget,
 * since those widgets offer collections only, and its edits show in Recently
 * edited, so a per-Single card is never told to pick "that collection".
 */
const REPLACED_BY: Record<RetiredNamespace, string> = {
  collection: `a per-collection card core no longer makes; use a core widget with a Collection setting instead (${[
    CORE_WIDGET_ID.count,
    CORE_WIDGET_ID.breakdown,
    CORE_WIDGET_ID.overTime,
    CORE_WIDGET_ID.recentEntries,
  ].join(", ")}), set to that collection`,
  single: `a per-Single card core no longer makes; a Single's edits show in ${CORE_WIDGET_ID.recentlyEdited}`,
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
 * What replaced the card `widgetId` names, as every door that refuses one
 * says it ("<id>" is ...), or `undefined` for an id in no retired namespace.
 */
export function retiredWidgetReplacement(widgetId: string): string | undefined {
  const namespace = retiredNamespaceOf(widgetId);
  return namespace === undefined ? undefined : REPLACED_BY[namespace];
}
