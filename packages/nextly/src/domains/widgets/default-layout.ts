/**
 * The one default dashboard: what everyone with no saved layout is given,
 * built from ONE `defaultLayout` whoever wrote it.
 *
 * The base is the site config's `admin.dashboard.defaultLayout`, or else core's
 * own (`CORE_DEFAULT_LAYOUT`), written the same way, so the two cannot be
 * built by different rules. It is the whole default: nothing follows it. No
 * widget is placed on its own, a plugin's included; the add panel offers it,
 * and a site that wants it on its default names it in `defaultLayout`. A
 * plugin's `contributes.dashboard.suggest`, and the site's `suggestions`, are
 * still accepted and checked at startup, and place nothing.
 *
 * The same default for everyone: what varies per person is only which of its
 * cards they may see, decided where it is read (`api/widget-layout`). A saved
 * layout is never built from here.
 *
 * @module domains/widgets/default-layout
 */

import { sizeFacts, type CanonicalWidget } from "./canonical";
import { CORE_DEFAULT_LAYOUT } from "./core-widgets/ids";
import type { DefaultLayoutCard } from "./declaration/dashboard";
import { clampSize } from "./grid-size";
import type { WidgetPlacement } from "./layout";

/** What startup read from the site config, for the default. */
export interface DefaultLayoutPlan {
  /** The default: the site's `defaultLayout`, or core's own when it gives none. */
  readonly cards: readonly DefaultLayoutCard[];
}

/** Core's default: what a boot that read no config builds. */
const CORE_PLAN: DefaultLayoutPlan = { cards: CORE_DEFAULT_LAYOUT };

/**
 * Pinned where every boot-time widget store is pinned, so a hot reload replaces
 * the plan with the one its own config gives rather than keeping the last.
 */
const globalForPlan = globalThis as unknown as {
  __nextly_defaultLayoutPlan?: DefaultLayoutPlan;
};

/** Replace the plan. Called once per boot, beside the widget registries. */
export function setDefaultLayoutPlan(plan: DefaultLayoutPlan): void {
  globalForPlan.__nextly_defaultLayoutPlan = plan;
}

/** The plan this boot set, or core's own where none was. */
export function defaultLayoutPlan(): DefaultLayoutPlan {
  return globalForPlan.__nextly_defaultLayoutPlan ?? CORE_PLAN;
}

/**
 * The default's cards, in order, over `widgets`: the install's widgets as
 * the layout reads them. An entry whose widget the install does not have is
 * left out: startup refused one not marked `optional`, so what is left out
 * here is an optional plugin widget, or a card core generates for content
 * since deleted.
 *
 * Each card's placement id is the one its entry names, or else its widget's,
 * so repeated reads of an unsaved dashboard return identical ids. A widget the
 * base places more than once names an id for each further card (startup
 * refuses a repeat that does not), so a card's id never depends on another
 * card, or on which cards a reader may see.
 *
 * 🔴 NOT capped here. The submission limit belongs to what a CALLER may send,
 * and this materialization is caller-independent; capping it would let cards a
 * caller cannot see consume the allowance. The cap is applied to the visible
 * partition instead.
 */
export function defaultLayoutPlacements(
  widgets: readonly CanonicalWidget[],
  plan: DefaultLayoutPlan = defaultLayoutPlan()
): WidgetPlacement[] {
  const byId = new Map(widgets.map(widget => [widget.id, widget]));
  return plan.cards.flatMap(card => {
    const widget = byId.get(card.widget);
    return widget === undefined ? [] : [placementOf(widget, card)];
  });
}

/**
 * One default card: at the size its entry states, each direction left out
 * being the widget's starting size, with its entry's starting settings.
 */
function placementOf(
  widget: CanonicalWidget,
  card: Pick<DefaultLayoutCard, "id" | "w" | "h" | "settings">
): WidgetPlacement {
  const bounds = sizeFacts(widget).size;
  // Within the widget's bounds: an entry startup checked already is, and a
  // replaced built-in's size is held to its alternative's.
  const size = clampSize(
    { w: card.w ?? bounds.default.w, h: card.h ?? bounds.default.h },
    bounds
  );
  return {
    id: card.id ?? widget.id,
    widgetId: widget.id,
    // The size travels WITH the placement: the first save stores it, so a
    // later change to the widget's default does not resize a saved card.
    w: size.w,
    h: size.h,
    removed: false,
    ...(card.settings === undefined ? {} : { config: { ...card.settings } }),
  };
}
