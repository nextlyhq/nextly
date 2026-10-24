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
import { listWidgets } from "./registry";
import { knobSourceFor } from "./settings";
import { getSource, type WidgetSourceField } from "./sources";

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

/**
 * A collection a card's content settings may name, with the fields they may
 * offer to filter, sort or group by.
 *
 * @experimental The shape may still change while the settings sheet's
 * content controls are built on it.
 */
export interface PublishedContentSource {
  collection: string;
  label: string;
  /**
   * Whether the collection has a draft and published lifecycle: the source's
   * own `lifecycleStatus`, so a card asks a status split only of a collection
   * that has one. @experimental
   */
  lifecycle: boolean;
  fields: Pick<
    WidgetSourceField,
    "name" | "label" | "type" | "choices" | "groupable"
  >[];
}

/**
 * The collections, and their fields, a card's content settings may offer this
 * reader.
 *
 * 🔴 Derived from the cards the reader may see, never decided again here. A
 * collection's own card is shown only when the reader may read the collection
 * (`readableEntities`, the gate the list routes use, asked once per request in
 * `widgetAudience`), so its source is offered on exactly the same answer. A
 * collection with no card of its own is not offered: there is no answer to
 * read for it, and offering it would be a second, hand-made check.
 *
 * Only fields the source does not mark `offered: false`: a field a read rule
 * could refuse, or a read hook transforms, is never offered as a choice. A
 * field offered to filter and sort that the read will not group by carries
 * `groupable: false`, so a Group by setting leaves it out.
 */
export function publishableContentSources(
  visible: readonly { generated?: boolean; collection?: string }[]
): PublishedContentSource[] {
  const slugs = new Set<string>();
  for (const card of visible) {
    if (card.generated === true && card.collection !== undefined) {
      slugs.add(card.collection);
    }
  }
  const published: PublishedContentSource[] = [];
  for (const slug of slugs) {
    const source = getSource(`collection:${slug}`);
    if (source === undefined) continue;
    published.push({
      collection: slug,
      label: source.label,
      lifecycle: source.lifecycleStatus === true,
      fields: source.fields
        .filter(field => field.offered !== false)
        .map(({ name, label, type, choices, groupable }) => ({
          name,
          type,
          ...(label === undefined ? {} : { label }),
          ...(choices === undefined ? {} : { choices }),
          // Carried so a Group by setting offers only keys the read accepts.
          ...(groupable === undefined ? {} : { groupable }),
        })),
    });
  }
  return published;
}
