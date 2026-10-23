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
  resolveWidgetSettings,
  type PublishedContentSource,
  type WidgetQuery,
} from "nextly/config";

import type { DashboardWidget } from "@admin/types/dashboard/widgets";

/**
 * Whether a query names what it reads. A card of a widget offered per
 * collection whose Collection setting is empty has nothing to ask: it is never
 * sent, and the card is drawn as not available.
 */
export function sourcedQuery(
  query: { source?: string } | undefined
): query is WidgetQuery {
  return query !== undefined && query.source !== undefined;
}

/**
 * Which of a card's conditional cells apply to it: `"lifecycle"` when the collection it is set to
 * has a draft and published lifecycle, as the server published it. A collection whose source is
 * not known asks the cells that need no lifecycle, which every collection can answer.
 */
function cellConditionFor(
  widget: DashboardWidget,
  config: Record<string, unknown> | undefined,
  sources: readonly PublishedContentSource[] | undefined
): "lifecycle" | "no-lifecycle" {
  const name = widget.settings?.find(
    setting => setting.type === "collection"
  )?.name;
  const collection =
    name === undefined
      ? undefined
      : resolveWidgetSettings(widget.settings, config)[name];
  const source = sources?.find(entry => entry.collection === collection);
  return source?.lifecycle === true ? "lifecycle" : "no-lifecycle";
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
  const ctx = {
    fieldsOf: (collection: string) =>
      sources?.find(source => source.collection === collection)?.fields,
  };
  // A custom card's cells are its reads, each asked with the same settings,
  // and only those that apply to the collection the card is set to.
  if (widget.archetype === "custom" && widget.cells?.length) {
    const applies = cellConditionFor(widget, config, sources);
    const cells = widget.cells.filter(
      cell =>
        !("when" in cell) || cell.when === undefined || cell.when === applies
    );
    const asked = cells.map(cell => {
      const query = applyWidgetSettings(
        cell.query,
        widget.settings,
        config,
        ctx
      );
      return query === cell.query ? cell : { ...cell, query };
    });
    return asked.length === widget.cells.length &&
      asked.every((cell, index) => cell === widget.cells?.[index])
      ? widget
      : { ...widget, cells: asked };
  }
  if (!widget.query) return widget;
  const query = applyWidgetSettings(widget.query, widget.settings, config, ctx);
  return query === widget.query ? widget : { ...widget, query };
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
