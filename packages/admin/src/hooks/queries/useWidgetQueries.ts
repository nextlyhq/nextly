/**
 * Every visible widget's data request, in ONE round trip.
 *
 * `POST /api/dashboard/query` takes `{ queries: WidgetQuery[] }` and answers
 * `{ results }` POSITIONALLY — `results[i]` belongs to `queries[i]` and carries
 * no widget id of its own. Re-keying that back onto widget ids is this hook's
 * whole job, and it is the reason a dashboard of ten cards costs one request
 * rather than ten.
 *
 * Refresh follows `useDashboardStats` exactly: `staleTime: 0`, refetch on mount
 * and on window focus, and NO polling interval. The UX evidence is against
 * aggressive auto-refresh; a dashboard that moves on its own is a dashboard
 * nobody can read.
 *
 * @module hooks/queries/useWidgetQueries
 */

import { useQuery } from "@tanstack/react-query";
import type { WidgetQuery } from "nextly/config";
import { useMemo } from "react";

import { protectedApi } from "@admin/lib/api/protectedApi";
import type {
  WidgetQueryBatchResponse,
  WidgetSlot,
} from "@admin/types/dashboard/widgets";

/** One widget's request: the id to key the answer back to, and what to ask. */
export interface WidgetQueryRequest {
  widgetId: string;
  query: WidgetQuery;
}

export interface UseWidgetQueriesResult {
  /** Keyed by `widgetId`. A widget with no answer yet is simply absent. */
  slots: Record<string, WidgetSlot>;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<unknown>;
  /**
   * When this batch landed, or `null` before it has.
   *
   * Exposed because the card's freshness line is a property of the BATCH, not
   * of a widget: every card in one request was answered at the same instant,
   * and a per-card timestamp would be the same value recomputed n times.
   */
  updatedAt: Date | null;
}

/** What a widget is told when the batch came back shorter than it went out. */
const MISSING_SLOT_ERROR = "The server returned no result for this widget.";

/**
 * Narrows the response body before anything is keyed from it.
 *
 * The alternative — trusting `results` and indexing it — turns a proxy error
 * page or a changed envelope into a dashboard of cards stuck loading forever,
 * with nothing anywhere saying why. Failing the query instead puts the failure
 * where `error` is read.
 */
function readResults(body: unknown): WidgetSlot[] {
  const results = (body as WidgetQueryBatchResponse | null)?.results;
  if (!Array.isArray(results)) {
    throw new Error(
      "Dashboard query response was not shaped as { results: [] }."
    );
  }
  return results;
}

/**
 * Batches `queries` into one request and hands each widget back its own slot.
 *
 * `enabled` is `queries.length > 0`: a dashboard with nothing to ask must issue
 * no request, not an empty one. An empty batch would still cost a round trip,
 * an authentication check and a log line on every mount and every window focus,
 * for an answer that is knowable without asking.
 */
export function useWidgetQueries(
  queries: WidgetQueryRequest[]
): UseWidgetQueriesResult {
  const query = useQuery<WidgetSlot[], Error>({
    // The requests themselves are the key. Two dashboards asking for different
    // widgets are different questions and must not share one cache entry;
    // TanStack hashes the array deterministically, so a re-render with an
    // equal-but-new array does not refetch.
    queryKey: ["dashboard", "widget-queries", queries],
    queryFn: async () => {
      const body = await protectedApi.post<unknown>("/dashboard/query", {
        queries: queries.map(entry => entry.query),
      });
      return readResults(body);
    },
    enabled: queries.length > 0,
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
    retry: 2,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const results = query.data;

  const slots = useMemo<Record<string, WidgetSlot>>(() => {
    if (!results) return {};
    const keyed: Record<string, WidgetSlot> = {};
    queries.forEach((entry, index) => {
      // A short response is the server disagreeing with us about how many
      // questions were asked. Saying so per widget is what stops the trailing
      // cards spinning silently forever.
      keyed[entry.widgetId] = results[index] ?? {
        ok: false,
        error: MISSING_SLOT_ERROR,
      };
    });
    return keyed;
  }, [queries, results]);

  return {
    slots,
    isLoading: query.isLoading,
    error: query.error ?? null,
    refetch: query.refetch,
    // `dataUpdatedAt` is 0 until the query has resolved once, which is not an
    // instant in 1970 -- it is the absence of one.
    updatedAt: query.dataUpdatedAt ? new Date(query.dataUpdatedAt) : null,
  };
}
