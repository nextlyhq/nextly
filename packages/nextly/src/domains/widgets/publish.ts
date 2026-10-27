/**
 * The registered widgets as the admin may receive them.
 *
 * The registry is the single place that knows which widgets exist in a running
 * app, and `registerWidget` is the public API an app or plugin uses to add one.
 * Nothing carried that store to the browser, so the admin grid could only ever
 * render `contributes.admin.widgets` -- a plugin that registered a widget and
 * did not ALSO declare it as a contribution was invisible to its own renderer.
 * This is the projection that closes that gap.
 *
 * Per widget rather than per payload, and that is the whole reason this is a
 * function rather than a `listWidgets()` call at the call site. A registration
 * happens in code at boot, so unlike `contributes.admin.widgets` it never passed
 * `assertAdminWidgets` -- the registry's own gate is `structuredClone`, which
 * carries a `BigInt` under `WidgetQuery.where` happily where `JSON.stringify`
 * throws. One such widget would take the whole authenticated workspace payload
 * down for every admin. Skipping the offender and logging it costs that one
 * widget its card and leaves the dashboard standing.
 *
 * @module domains/widgets/publish
 */

import { getNextlyLogger } from "../../observability/logger";
import { jsonOnly, unserializableKeys } from "../../plugins/json-round-trip";

import type { WidgetDefinition } from "./definition";
import type { PublishedContentSource } from "./published-content-source";
import { listWidgets } from "./registry";
import { knobSourceFor } from "./settings";
import { getSource, type WidgetSource } from "./sources";

/**
 * Every registered widget that survives the trip to the browser unchanged, in
 * registration order.
 *
 * Returns the DECODED value rather than the stored object, so what is checked is
 * exactly what ships -- the same reading `validatedAdminWidgets` takes of a
 * contributed widget, and for the same reason.
 */
export function publishableWidgets(): WidgetDefinition[] {
  const publishable: WidgetDefinition[] = [];

  for (const definition of listWidgets()) {
    const serializable = jsonOnly(definition);
    if (serializable === undefined) {
      getNextlyLogger().error({
        kind: "widget-not-serializable",
        widget: definition.id,
        keys: unserializableKeys(definition),
      });
      continue;
    }
    publishable.push(
      withSourceFilters(serializable as unknown as WidgetDefinition)
    );
  }

  return publishable;
}

/**
 * `definition` with the filters its source takes, read from the source
 * registry now that every source is registered, in place of any it stated.
 * Absent when its source takes none, as on every widget not reading one.
 */
function withSourceFilters(definition: WidgetDefinition): WidgetDefinition {
  const rest: WidgetDefinition = { ...definition };
  delete rest.sourceFilters;
  const source = definition.query?.source;
  const filters =
    typeof source === "string" ? knobSourceFor(source).filters : undefined;
  return filters === undefined ? rest : { ...rest, sourceFilters: filters };
}

// The collection a card's content settings may name has a module of its own, holding the type
// alone, so the knobs that read it reach nothing of this one.
export type { PublishedContentSource } from "./published-content-source";

/**
 * The collections, and their fields, a card's content settings may offer this
 * reader.
 *
 * 🔴 Derived from the audience's readable collections, never decided again
 * here: `readableEntities`, the gate the list routes use, asked once per
 * request in `widgetAudience` of every collection with a content source. A
 * card's settings may then name exactly the collections a card set to one is
 * shown for.
 *
 * Only fields the source does not mark `offered: false`: a field a read rule
 * could refuse, or a read hook transforms, is never offered as a choice. A
 * field offered to filter and sort that the read will not group by carries
 * `groupable: false`, so a Group by setting leaves it out.
 */
export function publishableContentSources(
  readableCollections: Iterable<string>
): PublishedContentSource[] {
  const published: PublishedContentSource[] = [];
  for (const slug of readableCollections) {
    const source = getSource(`collection:${slug}`);
    if (source !== undefined) published.push(publishedSourceOf(slug, source));
  }
  return published;
}

/** One collection's source as a reader's content settings see it. */
function publishedSourceOf(
  slug: string,
  source: WidgetSource
): PublishedContentSource {
  const offered = source.fields.filter(field => field.offered !== false);
  // Published only where the reader is offered the field itself: a title a
  // read rule could refuse is no row label to ask for.
  const titleField = offered.some(field => field.name === source.titleField)
    ? source.titleField
    : undefined;
  return {
    collection: slug,
    label: source.label,
    lifecycle: source.lifecycleStatus === true,
    ...(titleField === undefined ? {} : { titleField }),
    fields: offered.map(({ name, label, type, choices, groupable }) => ({
      name,
      type,
      ...(label === undefined ? {} : { label }),
      ...(choices === undefined ? {} : { choices }),
      // Carried so a Group by setting offers only keys the read accepts.
      ...(groupable === undefined ? {} : { groupable }),
    })),
  };
}
