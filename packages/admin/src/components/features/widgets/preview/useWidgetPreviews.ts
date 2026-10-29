/**
 * The development preview read, through the admin's authenticated client.
 *
 * Asked only by the preview page, whose code is fetched only once the server
 * has said it runs in development, so a production admin never sends it.
 *
 * @module components/features/widgets/preview/useWidgetPreviews
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { protectedApi } from "@admin/lib/api/protectedApi";
import type { ListResponse } from "@admin/lib/api/response-types";

import type { WidgetPreview } from "./types";

/** The query key this read owns. */
export const WIDGET_PREVIEWS_KEY = ["dashboard", "widget-previews"] as const;

/** Every widget the reader may see, with its preview cases. */
export function useWidgetPreviews(): UseQueryResult<WidgetPreview[]> {
  return useQuery({
    queryKey: WIDGET_PREVIEWS_KEY,
    queryFn: async () =>
      (
        await protectedApi.get<ListResponse<WidgetPreview>>(
          "/dashboard/widget-previews"
        )
      ).items,
    // The cases change only when their author edits a declaration, which a
    // development server reloads for; asked again on focus, as the dashboard is.
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}
