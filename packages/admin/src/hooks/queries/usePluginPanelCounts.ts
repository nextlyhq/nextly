/**
 * The numbers a standalone plugin's panel shows beside its items, read while
 * the panel is drawn: one batch for the whole panel (`panelCountQueries`), so
 * a panel of six counts costs one request.
 *
 * Never in the panel's way. The items are drawn before any number arrives,
 * a number that cannot be read is simply not drawn, and nothing here shows a
 * spinner or an error. Kept for 30 seconds, so moving between the panel's
 * own pages does not ask again; asked again when the window regains focus
 * after that, as the dashboard's cards are.
 *
 * @module hooks/queries/usePluginPanelCounts
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import {
  panelCountQueries,
  panelItemNumbers,
  type PanelItemNumber,
} from "@admin/lib/plugins/panel-counts";
import type { PluginMenuItemMeta } from "@admin/types/branding";

import { fetchWidgetBatch } from "./widget-query-stream";

/** How long a panel's numbers are kept before they are asked again. */
const PANEL_COUNTS_STALE_MS = 30_000;

/** No numbers: before the batch answers, after it fails, or with none asked. */
const NONE: ReadonlyMap<string, PanelItemNumber> = new Map();

/**
 * Each item's number, by its address, for the items `pluginName`'s panel
 * lists for the reader. Empty until the batch answers, and for good when it
 * fails.
 */
export function usePluginPanelCounts(
  pluginName: string,
  items: readonly PluginMenuItemMeta[]
): ReadonlyMap<string, PanelItemNumber> {
  const queries = useMemo(() => panelCountQueries(items), [items]);
  const { data } = useQuery({
    queryKey: ["plugin-panel-counts", pluginName, queries],
    queryFn: ({ signal }) =>
      fetchWidgetBatch(queries, { signal, onSlots: () => undefined }),
    enabled: queries.length > 0,
    staleTime: PANEL_COUNTS_STALE_MS,
    // A number is a convenience: one that fails is left out rather than asked
    // for again and again while the panel is open.
    retry: false,
  });
  return useMemo(
    () => (data === undefined ? NONE : panelItemNumbers(items, queries, data)),
    [data, items, queries]
  );
}
