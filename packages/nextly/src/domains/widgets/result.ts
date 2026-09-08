/**
 * What a widget query ANSWERS with, whatever kind of source answered it.
 *
 * Its own module because two producers now share it: the collection path, which
 * compiles a query to the Direct API, and a system source's resolver, which
 * hands the question to a domain service. Left in `execute.ts`, the resolver
 * contract would import the executor and the executor would import the resolver
 * registry -- a cycle around a type neither of them owns.
 *
 * @module domains/widgets/result
 */

import type { WidgetSourceFieldType } from "./sources";

/**
 * One column of a list result, as the admin needs to head it.
 *
 * Carried on the RESULT rather than published as source metadata, and the
 * difference is an access-control one. A widget's declared source is proven
 * readable by the caller before a row is returned, and `select` names the
 * fields they asked for -- so answering with labels for exactly those fields
 * tells them nothing they did not already have. Publishing a source's field
 * list separately would be an enumeration surface: the endpoint is careful
 * that a source the caller may not read answers exactly as one that does not
 * exist, and a metadata channel beside it would undo that.
 */
export interface WidgetResultField {
  name: string;
  /** Absent when the source has no human label for this field. */
  label?: string;
  /**
   * What KIND of value this column holds, as the source declared it.
   *
   * 🔴 Carried so the renderer can present a value instead of printing it. Every
   * source already declares this -- `{ name: "scheduledAt", type: "date" }` --
   * and it stopped at the server, so a date crossed as an ISO string and the row
   * drew `2026-09-01T07:00:00.000Z` at the reader. Selecting a different field
   * is not a fix for that; it is choosing which column to not render properly,
   * and the next card that selects a date has the same problem again.
   *
   * Optional because a source may describe a field it has no declaration for,
   * and because a widget result predating this carries none. The renderer treats
   * an absent type as "print it as text", which is what it did for everything
   * before this existed -- so an old result and a new one differ in quality, not
   * in correctness.
   */
  type?: WidgetSourceFieldType;
}

export type WidgetResult =
  | {
      op: "count";
      total: number;
      /**
       * Whether `total` is a FLOOR rather than the whole answer.
       *
       * 🔴 Present because some counts cannot be computed in the database. Where
       * a source's rows are filtered by a rule the query cannot express — a
       * stored `owner-only` or `custom` read rule lives on the collection, not
       * on the sidecar table being counted — the only honest count walks
       * candidates and authorizes them, which is bounded work. Past that bound
       * the choice is to refuse, to publish a number that is quietly too small,
       * or to say plainly that there are at least this many.
       *
       * Saying so is the option that stays true: a reader learns the scale
       * without being told a wrong figure, and a card renders `1,000+` rather
       * than failing. Absent means the count is whole.
       */
      atLeast?: boolean;
    }
  | {
      op: "list";
      items: Record<string, unknown>[];
      /**
       * The selected fields, in the order they were asked for.
       *
       * Present only when the query declared `select`: without it the rows
       * carry whatever the collection holds, so there are no columns the
       * widget chose and nothing honest to head them with.
       */
      fields?: WidgetResultField[];
    }
  | {
      op: "groupBy";
      /**
       * Distinct values of the grouped field, largest bucket first.
       *
       * `value` is null where the column is null, which is a bucket in its own
       * right rather than an absence: "how many rows have no region" is a real
       * answer and folding it into another bucket would misreport both.
       */
      buckets: { value: string | null; count: number }[];
      /**
       * Whether buckets were left out because a cap was reached.
       *
       * The bucket set is ranked and capped after grouping completes, so the
       * ones returned are genuinely the largest -- but a chart drawn from a
       * capped set is not the whole picture, and saying so is the same choice
       * `atLeast` makes for a bounded count. Absent means every bucket is here.
       */
      truncated?: boolean;
    };

/**
 * One slot of the dashboard batch response: what ONE widget's query answered.
 *
 * 🔴 A failure is a VALUE here, not a thrown error, because the batch answers
 * 200 with every other widget's data intact -- one widget failing must colour
 * one card, never blank the dashboard.
 *
 * 🔴 A discriminated union, not an object with three optional fields. The loose
 * shape could describe a slot that reports success and carries no result, or
 * reports failure and says nothing about why -- neither of which any producer
 * here means to send, and both of which a consumer would have to defend against
 * on every read. Declared this way, the compiler refuses the malformed slot at
 * the point it would be constructed rather than leaving every reader to
 * discover it.
 */
export type WidgetSlot =
  | { ok: true; result: WidgetResult }
  | { ok: false; error: string };

/**
 * The dashboard batch response body, positionally matched to the queries asked.
 *
 * Positional rather than keyed, because two placements may ask the SAME widget
 * different questions; a key would have to be invented and agreed by both ends,
 * and the array index already is one.
 */
export interface WidgetQueryBatchResponse {
  results: WidgetSlot[];
}

/**
 * The props a widget component is handed, whatever it draws.
 *
 * 🔴 Declared in core rather than in the admin that builds it or the plugin-sdk
 * that publishes it, because those two cannot both see a third place: plugin-sdk
 * already depends on the admin, so an admin dependency on plugin-sdk closes a
 * cycle the build refuses. Core is the one package both already depend on, and
 * it is not a stranger to presentation -- a widget definition here declares its
 * `component`, its `chrome` and its default size.
 *
 * The admin ANNOTATES the object it builds with this type, so a renamed or
 * dropped prop fails to compile rather than silently leaving plugin authors
 * compiling against a contract nothing keeps.
 *
 * Nested rather than spread: a widget declaring a setting named `slot` would
 * otherwise overwrite the answer to its own query.
 *
 * 🔴 A `type` and not an `interface`, for a reason the compiler enforces: an
 * interface has no implicit index signature, so it is not assignable to the
 * `Record<string, unknown>` that `PluginSlot` forwards props through -- the
 * admin could not annotate the object it builds with it, which is the whole
 * point of publishing it. Losing declaration merging is a second, smaller
 * benefit: a plugin cannot widen a contract the host has to satisfy.
 */
export type WidgetComponentProps = {
  /** The widget definition's id -- what the plugin registered. */
  widgetId: string;
  /**
   * The CARD's id, which is what identifies this instance.
   *
   * 🔴 Not `widgetId`. One widget may sit on a dashboard twice -- a "recent
   * entries" card for posts beside one for pages -- and everything belonging to
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
   * This card's answer, when it has one.
   *
   * 🔴 `undefined` means TWO different things, and a component that treats them
   * alike will draw an empty state over a request that is still running: the
   * widget declared no query, so no answer is ever coming; or the batch carrying
   * this card's query has not answered YET. `isFetching` tells them apart.
   */
  slot: WidgetSlot | undefined;
  /**
   * Whether this card's query is in flight, the FIRST request included.
   *
   * Always `false` for a widget that declared no query, which is what makes it
   * the discriminator for an absent `slot`.
   */
  isFetching: boolean;
};
