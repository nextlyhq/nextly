/**
 * A card per collection, derived from the sources the install actually has.
 *
 * ## Why these are GENERATED rather than registered
 *
 * A collection is created while the process is running — the Schema Builder
 * makes one without a restart — so a widget declared for it at boot describes
 * an install that has since changed. These are derived at REQUEST time from the
 * registered sources, the same read `refreshCollectionSources` already performs
 * per batch, so a collection added a minute ago has its cards and a collection
 * deleted a minute ago does not.
 *
 * Django's admin takes the same position for the same reason: it builds a
 * per-model view set at request time rather than freezing one at import.
 *
 * ## Why they are OFFERED and never placed
 *
 * They do not appear on anybody's dashboard until a reader adds one. An install
 * with forty collections would otherwise open onto eighty cards, and the reader
 * who wanted three has to remove seventy-seven. Payload shipped the auto-placing
 * version and withdrew it: one card per collection produced duplicates with no
 * clean opt-out, and the arrangement had no way to say "I have seen this and I
 * do not want it".
 *
 * The picker is what makes "not placed" workable. Without a list naming the
 * unplaced widgets these would be reachable from nothing.
 *
 * ## Why they are derived from SOURCES rather than from collections
 *
 * A widget and the source it queries must agree about three things: that the
 * source exists, which ops it answers, and which permission gates it. Reading
 * the collection registry a second time here would answer all three again, and
 * the copies would drift — a source that stopped supporting `count` would leave
 * a metric card whose every request is refused. Taking them from the registered
 * source means there is nothing to disagree with.
 *
 * @module domains/widgets/collection-widgets
 */

import { entryTitleField } from "../collections/entry-title";

import { refreshCollectionSources } from "./collection-sources";
import { isValidWidgetId, type WidgetDefinition } from "./definition";
import { listSources, type WidgetSource } from "./sources";

/** How many rows a generated list asks for. The renderer draws at most five. */
const LIST_ROWS = 5;

/**
 * The id of a generated widget, from the source it draws.
 *
 * Namespaced under `collection/` so it cannot collide with core's own `core/`
 * cards, and suffixed by what it draws so one collection can have both. Derived
 * from the source id rather than from a slug passed alongside it, for the same
 * reason every other field here is.
 */
function widgetId(
  source: WidgetSource,
  kind: "count" | "recent"
): string | undefined {
  const id = `collection/${source.id.slice("collection:".length)}-${kind}`;
  // ASKED rather than assumed. A widget id is `namespace/name` in lowercase
  // slug form -- two segments, so the kind is a suffix rather than a third
  // segment -- and a collection slug that cannot produce one is skipped instead
  // of minting an id the registry would refuse. The predicate is the registry's
  // own, so this cannot drift away from what it accepts.
  return isValidWidgetId(id) ? id : undefined;
}

/**
 * The metric card for a source: how many entries the collection holds.
 *
 * `status: "all"`, deliberately. A count that silently excluded drafts would
 * disagree with the number the collection's own list view shows, and the reader
 * has no way to tell which of the two is answering a narrower question.
 */
function countWidget(source: WidgetSource): WidgetDefinition | undefined {
  if (!source.supports.includes("count")) return undefined;
  const id = widgetId(source, "count");
  if (id === undefined) return undefined;
  return {
    id,
    title: source.label,
    description: `How many entries ${source.label} holds`,
    archetype: "metric",
    defaultSize: "sm",
    ...(source.requiredPermission === undefined
      ? {}
      : { requiredPermission: source.requiredPermission }),
    query: { source: source.id, op: "count", status: "all" },
  };
}

/**
 * The list card for a source: the entries touched most recently.
 *
 * Returns `undefined` for a collection this cannot draw HONESTLY, and both
 * conditions are refusals rather than fallbacks:
 *
 * - no field names the entries, so every row would read as an identifier. The
 *   `list` renderer already refuses a widget that selects nothing rather than
 *   guessing a key out of a document it knows nothing about; generating one
 *   that selects the wrong key would defeat that by answering the question
 *   badly instead of declining it.
 * - no `updatedAt`, so "recently" has nothing to sort by. Sorting by id would
 *   produce a card whose title is a claim its rows do not support.
 */
function recentWidget(source: WidgetSource): WidgetDefinition | undefined {
  if (!source.supports.includes("list")) return undefined;
  const names = source.fields.map(field => field.name);
  // `useAsTitle` is not passed: it lives in the static config, and this reads
  // the REGISTRY so that Builder-drawn collections are covered too. The shared
  // rule falls back to the conventional names, which is the same answer the
  // entry list reaches for a collection that nominates nothing.
  const label = entryTitleField(undefined, names);
  if (label === undefined) return undefined;
  if (!names.includes("updatedAt")) return undefined;
  const id = widgetId(source, "recent");
  if (id === undefined) return undefined;

  return {
    id,
    title: `Recent ${source.label}`,
    description: `The ${source.label} entries changed most recently`,
    archetype: "list",
    defaultSize: "md",
    ...(source.requiredPermission === undefined
      ? {}
      : { requiredPermission: source.requiredPermission }),
    query: {
      source: source.id,
      op: "list",
      status: "all",
      // The row label first, then the muted line under it -- the order the
      // `list` renderer reads `select` in.
      select: [label, "updatedAt"],
      sort: "-updatedAt",
      limit: LIST_ROWS,
    },
  };
}

/**
 * Every generated card the given sources support, in source order.
 *
 * Pure, so the derivation can be asserted without a container: the refresh
 * below is the only part that needs one.
 */
export function collectionWidgets(
  sources: readonly WidgetSource[]
): WidgetDefinition[] {
  const widgets: WidgetDefinition[] = [];
  for (const source of sources) {
    if (source.kind !== "collection") continue;
    const count = countWidget(source);
    if (count) widgets.push(count);
    const recent = recentWidget(source);
    if (recent) widgets.push(recent);
  }
  return widgets;
}

/**
 * The generated set, pinned where every other boot-time widget store is.
 *
 * On `globalThis` so it survives the module re-evaluation Next.js and Turbopack
 * perform, matching `__nextly_contributedWidgets` beside it.
 */
const globalForGenerated = globalThis as unknown as {
  __nextly_generatedWidgets?: WidgetDefinition[];
};

/** Replace the generated set. */
export function setGeneratedWidgets(
  widgets: readonly WidgetDefinition[]
): void {
  globalForGenerated.__nextly_generatedWidgets = [...widgets];
}

/** The generated set, or none when nothing has derived one yet. */
export function generatedWidgets(): WidgetDefinition[] {
  return [...(globalForGenerated.__nextly_generatedWidgets ?? [])];
}

/**
 * Re-derive the generated set from the install's current collections.
 *
 * Refreshes the SOURCES first, because the widgets are derived from them: a
 * collection created since the last request has no source yet, so deriving
 * without this produces a set one request out of date.
 */
export async function refreshCollectionWidgets(): Promise<void> {
  await refreshCollectionSources();
  setGeneratedWidgets(collectionWidgets(listSources()));
}
