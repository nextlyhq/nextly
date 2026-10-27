/**
 * A placed widget as it is asked: its declaration with its reader's settings applied to its
 * query (the `limit` they chose, for one).
 *
 * One rule for both readers of it: the batch sends this query, and the card is drawn from this
 * declaration, so a body slices to the rows that were asked for. Drawing from the bare
 * declaration sliced a card set to ten items back to its declared five and said more exist.
 *
 * @module components/features/widgets/widget-as-asked
 */

import {
  applyWidgetSettings,
  effectiveWidgetSettings,
  type KnobContext,
  type PublishedContentSource,
  type WidgetQuery,
} from "nextly/config";

import type { DashboardWidget } from "@admin/types/dashboard/widgets";

import { collectionSlugOf } from "./frame/list-view-href";

/**
 * Whether a query can be asked as it stands: it names what it reads, and a
 * grouped one names what it groups by. A card of a widget offered per
 * collection whose Collection setting is empty has nothing to ask, and a
 * Breakdown on a collection with nothing to divide by groups by nothing: each
 * is never sent, and the card is drawn as not available. The add panel and the
 * settings sheet ask the same of a widget set to a collection, so a widget is
 * offered on exactly the collections it can be asked of.
 */
export function askableQuery(
  query: { source?: string; op?: string; groupBy?: string } | undefined
): query is WidgetQuery {
  return (
    query !== undefined &&
    query.source !== undefined &&
    !(query.op === "groupBy" && query.groupBy === undefined)
  );
}

/**
 * Which conditional cells a read answers: `"lifecycle"` when the collection it
 * reads has a draft and published lifecycle, as the server published it. A read
 * whose collection is not known answers the cells that need no lifecycle, which
 * every collection can answer.
 */
function cellConditionOf(
  query: { source?: string },
  sources: readonly PublishedContentSource[] | undefined
): "lifecycle" | "no-lifecycle" {
  const collection = collectionSlugOf(query.source);
  const source = sources?.find(entry => entry.collection === collection);
  return source?.lifecycle === true ? "lifecycle" : "no-lifecycle";
}

/**
 * What the knobs consult: each collection as the server published it to this reader, and the
 * fields it offers. The one place a knob reads the reader's collections from.
 */
function readerContext(
  sources: readonly PublishedContentSource[] | undefined
): KnobContext {
  const sourceOf = (collection: string) =>
    sources?.find(source => source.collection === collection);
  return {
    sourceOf,
    fieldsOf: (collection: string) => sourceOf(collection)?.fields,
  };
}

/**
 * The context a widget's own query is asked in: the reader's fields, and the
 * widget's source with the filters it narrows by. A knob such as Collection
 * then sets a key of the query's `where` on a source that reads across
 * collections, where on a collection source it would replace the source
 * itself. A widget with no source yet has none to hand on.
 */
function queryContext(
  widget: DashboardWidget,
  sources: readonly PublishedContentSource[] | undefined
): KnobContext {
  const source = widget.query?.source;
  return {
    ...readerContext(sources),
    ...(source === undefined
      ? {}
      : {
          source: {
            id: source,
            ...(widget.sourceFilters ? { filters: widget.sourceFilters } : {}),
          },
        }),
  };
}

/**
 * A custom card's cells with `config` applied, keeping only those that apply:
 * each cell's condition is read from the source it reads once the settings
 * apply, so a cell declaring its own collection is judged by that collection,
 * and one the Collection setting supplies by the collection the card is set to.
 * Returns the cells it was given when nothing changes.
 */
function cellsAsAsked(
  widget: DashboardWidget,
  config: Record<string, unknown> | undefined,
  sources: readonly PublishedContentSource[] | undefined
): DashboardWidget["cells"] {
  const cells = widget.cells ?? [];
  const ctx = readerContext(sources);
  const asked = cells.flatMap(cell => {
    const query = applyWidgetSettings(cell.query, widget.settings, config, ctx);
    const when = "when" in cell ? cell.when : undefined;
    if (when !== undefined && when !== cellConditionOf(query, sources)) {
      return [];
    }
    return [query === cell.query ? cell : { ...cell, query }];
  });
  const unchanged =
    asked.length === cells.length &&
    asked.every((cell, index) => cell === cells[index]);
  // Each asked cell is the card's own cell, or that cell with its query applied, so the array
  // holds one kind of cell as the card's does; the compiler reads a union of the two kinds.
  return unchanged ? widget.cells : (asked as DashboardWidget["cells"]);
}

/**
 * `widget` with `config` applied to its query. Returns the widget it was given when nothing
 * applies, so a card with no settings keeps its identity and memoisation does not see a new
 * object every render.
 *
 * `sources` are the collections the server published to this reader, each with the fields it
 * may use: a stored Filter, Sort or Group by naming a field no longer among them is asked with
 * its default instead. Without them a stored value is asked as it is, for the server to judge.
 */
export function widgetAsAsked(
  widget: DashboardWidget,
  config: Record<string, unknown> | undefined,
  sources?: readonly PublishedContentSource[]
): DashboardWidget {
  // A custom card's cells are its reads, each asked with the same settings,
  // and only those that apply to the collection each reads.
  if (widget.archetype === "custom" && widget.cells?.length) {
    const cells = cellsAsAsked(widget, config, sources);
    return cells === widget.cells ? widget : { ...widget, cells };
  }
  if (!widget.query) return widget;
  const query = applyWidgetSettings(
    widget.query,
    widget.settings,
    config,
    queryContext(widget, sources)
  );
  return query === widget.query ? widget : { ...widget, query };
}

/**
 * Whether a card of `widget` with `config` can be asked anything, as `widgetAsAsked` builds it:
 * its query can be asked, or, for a card drawn from cells, at least one of them can. A widget
 * that asks nothing of the dashboard's batch, a card core answers on the server, always can.
 * What the add panel and the Collection picker ask of a widget set to each collection, so it
 * is offered only where its card would draw.
 */
export function askableWith(
  widget: DashboardWidget,
  config: Record<string, unknown> | undefined,
  sources?: readonly PublishedContentSource[]
): boolean {
  const asked = widgetAsAsked(widget, config, sources);
  // Judged by what the widget DECLARES: a cells card whose conditional cells
  // all fall away on this collection asks nothing, and would be offered empty.
  if (widget.archetype === "custom" && widget.cells?.length) {
    return (asked.cells ?? []).some(cell => askableQuery(cell.query));
  }
  return asked.query === undefined || askableQuery(asked.query);
}

/**
 * The settings a card's component is handed: as its query was asked with them, so a component
 * building a link from its Filter names the filter its answer was read under, never a stored one
 * the query set aside for a field this reader may not use. One reading with `widgetAsAsked`.
 */
export function settingsAsAsked(
  widget: DashboardWidget,
  config: Record<string, unknown> | undefined,
  sources?: readonly PublishedContentSource[]
): Record<string, unknown> {
  return effectiveWidgetSettings(
    widget.settings,
    config,
    widget.archetype === "custom" && widget.cells?.length
      ? readerContext(sources)
      : queryContext(widget, sources)
  );
}

/**
 * The name of a collection as the server published it to this reader: its label, or its slug
 * where none is known.
 */
export function collectionLabel(
  collection: string,
  sources: readonly { collection: string; label: string }[] | undefined
): string {
  return (
    sources?.find(source => source.collection === collection)?.label ??
    collection
  );
}

/**
 * The title a card is drawn under, and the subtitle beneath it. A card whose Collection setting
 * names a collection is titled by its SUBJECT, that collection ("Posts"), with its widget's name
 * as the subtitle ("Count"), so two of a widget's cards for different collections are told apart
 * by sight and by the region's name alike, and read subject first. A card set to none is titled
 * as its widget, with no subtitle.
 */
export function titleAsAsked(
  widget: DashboardWidget,
  config: Record<string, unknown> | undefined,
  sources?: readonly PublishedContentSource[]
): { title: string; subtitle?: string } {
  const name = widget.settings?.find(
    setting => setting.type === "collection"
  )?.name;
  const collection =
    name === undefined
      ? undefined
      : effectiveWidgetSettings(widget.settings, config)[name];
  return typeof collection === "string"
    ? { title: collectionLabel(collection, sources), subtitle: widget.title }
    : { title: widget.title };
}

/**
 * What a card asks with `config`, as one comparable string: its query and its
 * cells' queries as its settings apply to them, or, for a card core answers on
 * the server, its settings themselves, since core builds its data from them.
 * One reading, so a quick setting and the settings preview agree on whether a
 * change asks again.
 */
export function questionOf(
  widget: DashboardWidget,
  config: Record<string, unknown> | undefined,
  sources?: readonly PublishedContentSource[]
): string {
  if (widget.serverData === true) {
    return JSON.stringify({ settings: config ?? {} });
  }
  const asked = widgetAsAsked(widget, config, sources);
  return JSON.stringify({
    query: asked.query ?? null,
    cells: asked.cells?.map(cell => [cell.key, cell.query]) ?? null,
  });
}
