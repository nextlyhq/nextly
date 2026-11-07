/**
 * The "Bindings to fix" dashboard card's declaration: for the people who edit
 * pages, hidden while the reader may see no broken binding.
 *
 * Its `load` counts the broken bindings the reader may see, by the report
 * route's own read as them, so the card, the attention line and the page give
 * one number, and a card that would list nothing is never drawn. The rows the card draws are read by the card itself, through
 * the report's route, which names each document as the reader knows it.
 *
 * @module bindings-report/widget
 */
import {
  defineAttentionItem,
  defineWidget,
  type AnyWidget,
  type AttentionItem,
  type PluginRouteIdentity,
} from "@nextlyhq/plugin-sdk";

import { BINDINGS_TO_FIX_CARD_COMPONENT } from "../builder-view";

/** The permission the card, the page and the route ask for. */
export const EDIT_PAGES_PERMISSION = "update-pages";

/** How many broken bindings the person a card is loaded for may see. */
export type VisibleBindings = (
  user: PluginRouteIdentity["user"]
) => Promise<number>;

/**
 * The report's line on the dashboard's Needs your attention card, which every
 * dashboard shows: how many bindings to fix, linking to the page. The card
 * leaves out a line with nothing to count.
 */
export function bindingsToFixAttention(
  visible: VisibleBindings
): AttentionItem {
  return defineAttentionItem({
    id: "page-builder/bindings-to-fix",
    label: "Bindings to fix",
    reason: "Bindings whose field or block changed after they were saved",
    permission: EDIT_PAGES_PERMISSION,
    link: "plugins/nextlyhq-plugin-page-builder/bindings-to-fix",
    count: ({ user }) => visible(user),
  });
}

/** The card's declaration, reading the report's store when it loads. */
export function bindingsToFixWidget(visible: VisibleBindings): AnyWidget {
  return defineWidget({
    id: "page-builder/bindings-to-fix",
    title: "Bindings to fix",
    description:
      "Bindings whose field or block changed after they were saved, each showing its fallback until it is fixed.",
    category: "Content",
    size: { default: { w: 6, h: 4 }, min: { w: 6, h: 4 } },
    access: EDIT_PAGES_PERMISSION,
    hidesWhenEmpty: true,
    load: async ({ user }) => ({ bindings: await visible(user) }),
    view: { component: BINDINGS_TO_FIX_CARD_COMPONENT },
    isEmpty: data => data.bindings === 0,
  });
}
