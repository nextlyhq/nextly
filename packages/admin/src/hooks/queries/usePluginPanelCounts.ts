/**
 * The numbers a standalone plugin's panel shows beside its items, read while
 * the panel is drawn: one request for the whole panel, naming only the plugin
 * (`GET /api/admin-meta/plugin-panel-numbers`). The server counts what the
 * plugin's published panel declares, as the reader, so nothing the browser
 * sends chooses a collection or a filter.
 *
 * Never in the panel's way. The items are drawn before any number arrives,
 * a number that cannot be read is simply not drawn, and nothing here shows a
 * spinner or an error. Kept for 30 seconds, so moving between the panel's
 * own pages does not ask again; asked again when the window regains focus
 * after that.
 *
 * @module hooks/queries/usePluginPanelCounts
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { protectedApi } from "@admin/lib/api/protectedApi";
import {
  declaresNumbers,
  panelNumbersByPlace,
  type PanelItemNumber,
} from "@admin/lib/plugins/panel-counts";
import type { PluginMetadata } from "@admin/types/branding";

/** How long a panel's numbers are kept before they are asked again. */
const PANEL_COUNTS_STALE_MS = 30_000;

/** No numbers: before the answer, after a failure, or with none declared. */
const NONE: ReadonlyMap<number, PanelItemNumber> = new Map();

/**
 * Each item's number, by its place among `plugin`'s published menu
 * (`panelPlaceOf`), for its panel. Empty until the server answers, and for
 * good when it fails.
 */
export function usePluginPanelCounts(
  plugin: PluginMetadata
): ReadonlyMap<number, PanelItemNumber> {
  const { data } = useQuery({
    queryKey: ["plugin-panel-numbers", plugin.name],
    queryFn: ({ signal }) =>
      protectedApi.get<unknown>(
        `/admin-meta/plugin-panel-numbers?plugin=${encodeURIComponent(plugin.name)}`,
        { signal }
      ),
    enabled: declaresNumbers(plugin.menu),
    staleTime: PANEL_COUNTS_STALE_MS,
    // A number is a convenience: one that fails is left out rather than asked
    // for again and again while the panel is open.
    retry: false,
    // The admin turns focus refetching off by default; a panel left open
    // asks again when the reader comes back, once its answer is stale, so a
    // number they have since dealt with does not linger.
    refetchOnWindowFocus: true,
  });
  const menu = plugin.menu;
  return useMemo(
    () =>
      data === undefined || menu === undefined
        ? NONE
        : panelNumbersByPlace(menu, data),
    [data, menu]
  );
}
