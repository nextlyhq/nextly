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

import { applyWidgetSettings } from "nextly/config";

import type { DashboardWidget } from "@admin/types/dashboard/widgets";

/**
 * `widget` with `config` applied to its query. Returns the widget it was given when nothing
 * applies, so a card with no settings keeps its identity and memoisation does not see a new
 * object every render.
 */
export function widgetAsAsked(
  widget: DashboardWidget,
  config: Record<string, unknown> | undefined
): DashboardWidget {
  if (!widget.query) return widget;
  // The widget's own source, with the filters it narrows by: a knob such as
  // Collection then sets a key of the query's `where` on a source that reads
  // across collections, where on a collection source it would replace the
  // source itself.
  const query = applyWidgetSettings(widget.query, widget.settings, config, {
    source: {
      id: widget.query.source,
      ...(widget.sourceFilters ? { filters: widget.sourceFilters } : {}),
    },
  });
  return query === widget.query ? widget : { ...widget, query };
}

/**
 * What a card asks with `config`, as one comparable string: its query as its
 * settings apply to it, or, for a card core answers on the server, its settings
 * themselves, since core builds its data from them. One reading, so a quick
 * setting and the settings preview agree on whether a change asks again.
 */
export function questionOf(
  widget: DashboardWidget,
  config: Record<string, unknown> | undefined
): string {
  return widget.serverData === true
    ? JSON.stringify({ settings: config ?? {} })
    : JSON.stringify(widgetAsAsked(widget, config).query ?? null);
}
