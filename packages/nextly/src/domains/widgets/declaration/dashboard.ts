/**
 * Where widget declarations enter: a plugin's `contributes.dashboard` and the
 * site config's `admin.dashboard`.
 *
 * Both take the same `defineWidget()` declarations. What differs is what each
 * may ask for: a plugin may only ask (a suggested default place, an
 * alternative to a built-in card), and the site decides (what is hidden, what
 * the default dashboard is, which alternative replaces which built-in).
 *
 * @module domains/widgets/declaration/dashboard
 */

import type { CoreWidgetId } from "../core-widgets";
import type { WidgetSizeDeclaration } from "../grid-size";

import type { AnyWidget, WidgetDataInput } from "./define-widget";

/**
 * The ids of core's own widgets, read from core's widget list, so a plugin
 * offering an alternative to a built-in, or a site hiding one, is told of a
 * misspelt id when it compiles, and the set follows core's widgets with no
 * second edit.
 */
export type { CoreWidgetId } from "../core-widgets";

/**
 * A count for the Needs attention card: a whole number, or one marked as a
 * floor when counting stopped at a bound.
 */
export type AttentionCount = number | { count: number; atLeast: true };

/**
 * One line of the Needs attention card, from a plugin.
 *
 * It has no title, size, settings or display: the card that draws it owns
 * those. Who may see it is either a permission, or the collections it counts,
 * in which case it shows to anyone who may read one of them.
 */
export type AttentionItem = {
  id: string;
  label: string;
  /** Counts as the person asking, through services bound to them. */
  count: (
    input: Omit<WidgetDataInput<never>, "settings">
  ) => Promise<AttentionCount>;
  /** A path relative to the admin, which core resolves. */
  link: string;
} & (
  | { permission: string; collections?: never }
  | { collections: readonly [string, ...string[]]; permission?: never }
);

/** Declares a Needs attention item. */
export function defineAttentionItem(item: AttentionItem): AttentionItem {
  return item;
}

/**
 * A plugin's dashboard contribution.
 *
 * `suggest` and `alternatives` sit here rather than on each widget, so one
 * declaration means the same through a plugin and through the site config.
 *
 * `W` defaults to any widget, which is what `contributes.dashboard` holds when
 * nothing infers it: then `suggest` and the keys of `alternatives` are plain
 * strings, and startup refuses one that names no widget of the plugin's. Where
 * the widgets' types are known, the same type refuses it when it compiles.
 */
export interface DashboardContribution<W extends AnyWidget = AnyWidget> {
  widgets: readonly W[];
  /**
   * Widgets of this plugin to place on the default dashboard. Core places
   * them after every built-in card, in the order the site lists its plugins,
   * while there is room; a site may turn suggestions off.
   */
  suggest?: readonly W["id"][];
  /**
   * Widgets of this plugin offered in place of a built-in one. Only the site
   * config puts one in the built-in's place.
   */
  alternatives?: { readonly [Own in W["id"]]?: CoreWidgetId };
  attention?: readonly AttentionItem[];
}

/**
 * A widget's id as the site config names it: a core id, which completes as it
 * is typed, or any other widget's, a plugin's or the site's own, which startup
 * checks against the whole registry.
 *
 * @experimental While the dashboard widget SDK is being built.
 */
export type WidgetRef = CoreWidgetId | (string & {});

/**
 * A card of the site's own default dashboard: a widget, at a size it allows,
 * with starting values for its settings.
 *
 * `w` and `h` are in grid units, each within the widget's bounds; either left
 * out is the widget's starting size in that direction.
 *
 * @experimental While the dashboard widget SDK is being built.
 */
export interface DefaultLayoutCard {
  widget: WidgetRef;
  /** Columns, of twelve. */
  w?: number;
  /** Rows. */
  h?: number;
  settings?: Readonly<Record<string, unknown>>;
}

/**
 * What a site may change about a widget, its own or not.
 *
 * @experimental While the dashboard widget SDK is being built.
 */
export interface WidgetOverride {
  title?: string;
  description?: string;
  /**
   * A new starting size, smallest or largest size, each within the widget's
   * own bounds: an override narrows the sizes a widget allows and never
   * widens them. An end left out keeps the widget's own.
   */
  size?: Partial<WidgetSizeDeclaration>;
  /** New starting values, for everyone who has not changed them. */
  settings?: Readonly<Record<string, unknown>>;
}

/**
 * The site config's `admin.dashboard`.
 *
 * Every reference to another widget is checked against the whole registry at
 * startup, the plugins' widgets included, which no type here can see, and all
 * the faults are reported together.
 *
 * @experimental While the dashboard widget SDK is being built.
 */
export interface AdminDashboardConfig<W extends AnyWidget = AnyWidget> {
  /** Widgets of the site's own, declared as a plugin declares them. */
  widgets?: readonly W[];
  /**
   * Widgets nobody is offered and no card draws, built-in or a plugin's. Their
   * cards are kept, and drawn again where they were once a widget is no
   * longer hidden.
   */
  hide?: readonly WidgetRef[];
  /** Title, description, starting settings, and a narrowed size. */
  overrides?: Partial<Record<WidgetRef, WidgetOverride>>;
  /**
   * The default dashboard, in place of core's, for everyone who has not
   * arranged theirs. A widget added here later is offered to people who have
   * saved a dashboard, never placed on it.
   */
  defaultLayout?: readonly (WidgetRef | DefaultLayoutCard)[];
  /** `false` ignores every plugin's suggestion. */
  suggestions?: boolean;
  /**
   * A plugin's offered alternative, in the place of the built-in it names, at
   * the alternative's own starting size.
   */
  replace?: { readonly [Core in CoreWidgetId]?: string };
}
