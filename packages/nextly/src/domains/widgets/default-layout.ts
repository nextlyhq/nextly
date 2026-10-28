/**
 * The one default dashboard: what everyone with no saved layout is given,
 * built from ONE `defaultLayout` whoever wrote it.
 *
 * The base is the site config's `admin.dashboard.defaultLayout`, or else core's
 * own (`CORE_DEFAULT_LAYOUT`), written the same way, so the two cannot be
 * built by different rules. After it come the plugins' suggestions, unless the
 * site sets `suggestions: false`: first the widgets plugins name in
 * `contributes.dashboard.suggest`, in the order the site lists its plugins,
 * then the widgets of the older contribution shape, which were placed on the
 * default before suggestions existed and so are suggested by being declared,
 * by their `defaultOrder`. A widget the base already places is not suggested
 * again.
 *
 * The same default for everyone: what varies per person is only which of its
 * cards they may see, decided where it is read (`api/widget-layout`). A saved
 * layout is never built from here, so nothing a plugin suggests reaches one.
 *
 * @module domains/widgets/default-layout
 */

import { placedByDefault, sizeFacts, type CanonicalWidget } from "./canonical";
import { CORE_DEFAULT_LAYOUT, CORE_WIDGET_IDS } from "./core-widgets/ids";
import type { DefaultLayoutCard } from "./declaration/dashboard";
import type { WidgetPlacement } from "./layout";

/** What startup read from the site config and the plugins, for the default. */
export interface DefaultLayoutPlan {
  /** The base: the site's `defaultLayout`, or core's own when it gives none. */
  readonly cards: readonly DefaultLayoutCard[];
  /** Whether plugins' suggestions are placed after it (`suggestions: false` is not). */
  readonly suggestions: boolean;
  /** The widgets plugins suggest, in the order the site lists its plugins. */
  readonly suggested: readonly string[];
}

/** Core's default and nothing suggested: what a boot that read no config builds. */
const CORE_PLAN: DefaultLayoutPlan = {
  cards: CORE_DEFAULT_LAYOUT,
  suggestions: true,
  suggested: [],
};

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

const CORE_IDS: ReadonlySet<string> = new Set(CORE_WIDGET_IDS);

/**
 * The default's cards, in order, over `widgets`: the install's widgets as
 * the layout reads them. An entry whose widget the install does not have is
 * left out: startup refused one not marked `optional`, so what is left out
 * here is an optional plugin widget, or a card core generates for content
 * since deleted.
 *
 * The placement id is the widget id here, and only here, so repeated reads of
 * an unsaved dashboard return identical ids; a widget placed twice is re-keyed
 * stably where the arrangement is read (`partitionPlacements`).
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
  const base = plan.cards.flatMap(card => {
    const widget = byId.get(card.widget);
    return widget === undefined ? [] : [placementOf(widget, card)];
  });
  if (!plan.suggestions) return base;
  const placed = new Set(base.map(placement => placement.widgetId));
  const suggested = suggestedWidgets(widgets, plan.suggested).filter(
    widget => !placed.has(widget.id)
  );
  return [...base, ...suggested.map(widget => placementOf(widget, {}))];
}

/**
 * The widgets suggested for the default, each once: those plugins name, in
 * order, then the older shape's, by `defaultOrder`.
 */
function suggestedWidgets(
  widgets: readonly CanonicalWidget[],
  named: readonly string[]
): CanonicalWidget[] {
  const byId = new Map(widgets.map(widget => [widget.id, widget]));
  const chosen = [...new Set(named)].flatMap(id => {
    const widget = byId.get(id);
    return widget === undefined ? [] : [widget];
  });
  const chosenIds = new Set(chosen.map(widget => widget.id));
  const older = widgets
    .filter(widget => !chosenIds.has(widget.id) && suggestedByItsShape(widget))
    .sort(byDefaultOrder);
  return [...chosen, ...older];
}

/**
 * Whether a widget of the older shape is suggested by being declared: one
 * placed on the default before suggestions existed. Never one of core's, whose
 * place is the base's to give, nor one core generated or one offered (per
 * collection, or on request), which are offered and never placed.
 */
function suggestedByItsShape(widget: CanonicalWidget): boolean {
  return (
    !CORE_IDS.has(widget.id) &&
    widget.generated !== true &&
    placedByDefault(widget)
  );
}

/**
 * The older shape's order: a widget with no `defaultOrder` after every widget
 * that states one.
 *
 * 🔴 Equal orders compare EQUAL, so the declaration order then stands (the
 * sort is stable). Any tie-break here would rearrange every default dashboard
 * holding widgets that state no order.
 */
function byDefaultOrder(a: CanonicalWidget, b: CanonicalWidget): number {
  const aOrder = a.defaultOrder ?? Number.POSITIVE_INFINITY;
  const bOrder = b.defaultOrder ?? Number.POSITIVE_INFINITY;
  if (aOrder === bOrder) return 0;
  return aOrder < bOrder ? -1 : 1;
}

/**
 * One default card: at the size its entry states, each direction left out
 * being the widget's starting size, with its entry's starting settings.
 */
function placementOf(
  widget: CanonicalWidget,
  card: Pick<DefaultLayoutCard, "w" | "h" | "settings">
): WidgetPlacement {
  const starting = sizeFacts(widget).size.default;
  return {
    id: widget.id,
    widgetId: widget.id,
    // The size travels WITH the placement: the first save stores it, so a
    // later change to the widget's default does not resize a saved card.
    w: card.w ?? starting.w,
    h: card.h ?? starting.h,
    removed: false,
    ...(card.settings === undefined ? {} : { config: { ...card.settings } }),
  };
}
