/**
 * What a plugin's dashboard widget component is handed, and the shapes its data
 * arrives in.
 *
 * 🔴 Its OWN subpath rather than the root barrel. `index.ts` re-exports VALUES
 * from bare `nextly` — `definePlugin`, `NextlyError`, the field builders — so
 * evaluating it loads the whole package, and a plugin that wanted nothing but a
 * type would pay for the Direct API graph to get it. Reached through
 * `@nextlyhq/plugin-sdk/widgets`, these cost nothing: the module behind them
 * emits a zero-byte runtime chunk.
 *
 * The wire shapes are RE-EXPORTED from core rather than restated. They describe
 * what the server sends, so the server declares them; the admin and every
 * plugin are consumers of one definition. Each of those three used to carry its
 * own copy, and the copies had already drifted.
 *
 * @module widgets
 */

import type { WidgetSlot } from "nextly/widget-result";

export type {
  WidgetQueryBatchResponse,
  WidgetResult,
  WidgetResultField,
  WidgetSlot,
} from "nextly/widget-result";

/**
 * The props a widget component receives, whatever it draws.
 *
 * 🔴 Declared HERE and not in core, because it is a React contract between the
 * admin and a plugin author. Core produces the data and has no notion of a
 * component receiving it, so putting this beside the wire types would make the
 * server the author of a UI convention it cannot see.
 *
 * Nested rather than spread: a widget declaring a setting named `slot` would
 * otherwise overwrite the answer to its own query.
 */
export interface WidgetComponentProps {
  /** The widget definition's id — what the plugin registered. */
  widgetId: string;
  /**
   * The CARD's id, which is what identifies this instance.
   *
   * 🔴 Not `widgetId`. One widget may sit on a dashboard twice — a "recent
   * entries" card for posts beside one for pages — and everything belonging to
   * a card, its settings and its answer included, is keyed by this.
   */
  placementId: string;
  /**
   * This card's settings, RESOLVED: the reader's stored values where they are
   * usable and the declared defaults everywhere else, so a component never
   * decides what a missing or unusable setting should have been.
   */
  settings: Record<string, unknown>;
  /**
   * This card's answer, or `undefined` when the widget declared no query.
   *
   * A failure arrives as a value with `ok: false`, never as a throw: the batch
   * answers with every other widget's data intact, so one query failing colours
   * one card rather than blanking the dashboard.
   */
  slot: WidgetSlot | undefined;
  /** Whether a refresh is in flight. The first load is not distinguished. */
  isFetching: boolean;
}
