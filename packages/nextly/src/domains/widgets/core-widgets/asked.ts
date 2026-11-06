/**
 * A core card's query as its settings ask it, built on the server.
 *
 * Core's per-collection cards declare the query they ask (a count, a
 * grouping, a series, a list) and their reader's settings change it: the
 * Collection setting names its source, the Filter narrows its `where`, Sort,
 * Fields and Group by set theirs. That is `applyWidgetSettings`, the one
 * reading of how a setting reaches a query, which the admin also applies to
 * the cards it asks itself. Applied here with the same knobs and the same
 * reading of the collection (a stored Filter, Sort or Group by naming a field
 * no longer offered falls back to its default, an unset Group by to what the
 * collection divides by), so a card asked on the server asks what it asked
 * from the browser, and the settings its component is handed name the same
 * values.
 *
 * Read from the public read services alone: the collection is what `describe`
 * answers, and the knobs are core's published ones, so a plugin's own card
 * builds its query the same way.
 *
 * @module domains/widgets/core-widgets/asked
 */

import { declaredSettingList } from "../declaration/card-settings";
import type { WidgetCollectionDescription } from "../declaration/define-widget";
import {
  applyWidgetSettings,
  type AppliedQuery,
  type KnobContext,
} from "../settings";

/** A query core's knobs can apply a card's settings to. */
export type CardQuery = Parameters<typeof applyWidgetSettings>[0];

/**
 * The collection a card's settings are judged against, as the public
 * `describe` read answers it for the person asking: the same reading of it the
 * admin's knobs take from what the server publishes to them. Only the card's
 * own collection is known; any other is unknown, as to the knobs it would be.
 */
function knobContext(
  collection: string,
  described: WidgetCollectionDescription | undefined
): KnobContext {
  if (described === undefined) return {};
  const source = {
    collection,
    label: collection,
    lifecycle: described.status,
    ...(described.title === undefined ? {} : { titleField: described.title }),
    fields: [...described.fields],
  };
  return {
    sourceOf: slug => (slug === collection ? source : undefined),
    fieldsOf: slug => (slug === collection ? source.fields : undefined),
  };
}

/**
 * `query` with a card's settings applied, as core's knobs apply them.
 *
 * `settings` is the widget's declared settings, `values` the card's resolved
 * values as its `load` is handed them, and `described` its collection as the
 * public `describe` read answered it. A titled list set to a collection it
 * cannot title comes back with no source, asking nothing.
 */
export function askedQuery(
  query: CardQuery,
  settings: unknown,
  values: Readonly<Record<string, unknown>> & { collection: string },
  described: WidgetCollectionDescription | undefined
): AppliedQuery<CardQuery> {
  return applyWidgetSettings(
    query,
    declaredSettingList(settings),
    { ...values },
    knobContext(values.collection, described)
  );
}
