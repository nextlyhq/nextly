/**
 * Every visible widget's data request, in as few round trips as the endpoint
 * allows.
 *
 * `POST /api/dashboard/query` takes `{ queries: WidgetQuery[] }` and answers
 * `{ results }` POSITIONALLY — `results[i]` belongs to `queries[i]` and carries
 * no widget id of its own. Re-keying that back onto widget ids is this hook's
 * whole job, and it is the reason a dashboard of ten cards costs one request
 * rather than ten.
 *
 * It also REFUSES a body above `MAX_QUERIES_PER_REQUEST`, so "one request for
 * everything" stops being correct at the thirty-first widget: a single batch
 * would be rejected whole and every widget on the dashboard would go dark at
 * once, over a limit none of them individually crossed. The requests are
 * therefore partitioned to that size, and the partition is a property of the
 * TRANSPORT rather than of the dashboard — each partition is its own query, its
 * own retry and its own failure, and a widget's slot comes back from whichever
 * one carried it.
 *
 * Refresh follows `useDashboardStats` exactly: `staleTime: 0`, refetch on mount
 * and on window focus, and NO polling interval. The UX evidence is against
 * aggressive auto-refresh; a dashboard that moves on its own is a dashboard
 * nobody can read.
 *
 * @module hooks/queries/useWidgetQueries
 */

import { useQueries } from "@tanstack/react-query";
import { MAX_QUERIES_PER_REQUEST, type WidgetQuery } from "nextly/config";
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
  /**
   * Whether any request is in flight, INCLUDING a background refetch that is
   * keeping its previous answer on screen.
   *
   * Distinct from `isLoading`, which is only ever true before there is anything
   * to show. On window focus this grid refetches while the cards keep their
   * numbers, and a reader has no way to know that is happening unless the card
   * says so — which is what `aria-busy` is for.
   */
  isFetching: boolean;
  error: Error | null;
  refetch: () => Promise<unknown>;
  /**
   * When the data on screen landed, or `null` before all of it has.
   *
   * The OLDEST partition's answer, not the newest. Every card reads one
   * freshness line, so it has to be true of every card: taking the newest would
   * let a partition that answered ten minutes ago sit under a timestamp from a
   * partition that answered a second ago.
   */
  updatedAt: Date | null;
}

/** What a widget is told when the batch came back shorter than it went out. */
const MISSING_SLOT_ERROR = "The server returned no result for this widget.";

/**
 * What every widget in a batch is told when the REQUEST itself failed.
 *
 * A settled-and-failed request must produce slots, not an absence. A widget
 * with no slot is BUSY by the renderer's contract -- which is right while the
 * batch is in flight and wrong once it has failed, and the difference is
 * invisible from the card: every data widget on the dashboard sat spinning
 * forever, with only the grid's live region saying anything had gone wrong.
 *
 * A fixed sentence rather than the transport's own message. The per-slot errors
 * the server sends are written to be read by an admin; a rejected request
 * carries whatever the network, a proxy or a changed envelope produced, and
 * putting that on ten cards at once turns the card into a channel for text
 * nobody wrote for it. What actually failed travels in `error`, where the grid
 * reads it.
 */
const BATCH_FAILED_ERROR = "Dashboard data could not be loaded.";

/**
 * Narrows the response body before anything is keyed from it.
 *
 * The alternative — trusting `results` and indexing it — turns a proxy error
 * page or a changed envelope into a dashboard of cards stuck loading forever,
 * with nothing anywhere saying why. Failing the query instead puts the failure
 * where `error` is read.
 */
function readResults(body: unknown): unknown[] {
  const results = (body as WidgetQueryBatchResponse | null)?.results;
  if (!Array.isArray(results)) {
    throw new Error(
      "Dashboard query response was not shaped as { results: [] }."
    );
  }
  return results;
}

/**
 * The requests split into batches the endpoint will accept.
 *
 * Chunked in ORDER, so a widget's position inside its partition is what the
 * positional response is keyed back through, and a dashboard that grows past
 * the limit does not reshuffle which request its existing widgets travel in.
 *
 * An empty input produces NO partitions, which is what keeps a dashboard with
 * nothing to ask from issuing a request: an empty batch would still cost a
 * round trip, an authentication check and a log line on every mount and every
 * window focus, for an answer that is knowable without asking.
 */
function partitionRequests(
  queries: WidgetQueryRequest[]
): WidgetQueryRequest[][] {
  const partitions: WidgetQueryRequest[][] = [];
  for (
    let start = 0;
    start < queries.length;
    start += MAX_QUERIES_PER_REQUEST
  ) {
    partitions.push(queries.slice(start, start + MAX_QUERIES_PER_REQUEST));
  }
  return partitions;
}

/**
 * Batches `queries` into as few requests as the endpoint allows and hands each
 * widget back its own slot.
 */
export function useWidgetQueries(
  queries: WidgetQueryRequest[]
): UseWidgetQueriesResult {
  const partitions = useMemo(() => partitionRequests(queries), [queries]);

  const results = useQueries({
    queries: partitions.map(partition => ({
      // The partition's own requests are its key. Two dashboards asking for
      // different widgets are different questions and must not share one cache
      // entry; TanStack hashes the array deterministically, so a re-render with
      // an equal-but-new array does not refetch.
      queryKey: ["dashboard", "widget-queries", partition],
      queryFn: async () => {
        const body = await protectedApi.post<unknown>("/dashboard/query", {
          queries: partition.map(entry => entry.query),
        });
        return readResults(body);
      },
      staleTime: 0,
      gcTime: 5 * 60 * 1000,
      retry: 2,
      refetchOnMount: "always" as const,
      refetchOnWindowFocus: true,
    })),
  });

  // Not memoized, and deliberately: `useQueries` builds a fresh result array on
  // every render, so a memo keyed on it would recompute every render anyway
  // while reading as though it did not. The walk is one pass over the widgets.
  const slots: Record<string, WidgetSlot> = {};
  partitions.forEach((partition, index) => {
    const answer = results[index];
    if (!answer) return;

    if (answer.data) {
      partition.forEach((entry, position) => {
        // A short response is the server disagreeing with us about how many
        // questions were asked. Saying so per widget is what stops the trailing
        // cards spinning silently forever.
        slots[entry.widgetId] = (answer.data[position] as WidgetSlot) ?? {
          ok: false,
          error: MISSING_SLOT_ERROR,
        };
      });
      return;
    }

    // Answered by failing. Every widget in THIS partition gets its own failed
    // slot, because a card cannot tell an absent slot from a pending one and
    // renders both as busy — and only this partition's widgets are affected,
    // which is the point of splitting them. Data already held wins over this
    // branch, so a refetch that fails on window focus keeps the numbers the
    // reader was looking at.
    if (answer.isError) {
      partition.forEach(entry => {
        slots[entry.widgetId] = { ok: false, error: BATCH_FAILED_ERROR };
      });
    }
  });

  const settledAt = results.map(answer => answer.dataUpdatedAt);

  return {
    slots,
    isLoading: results.some(answer => answer.isLoading),
    isFetching: results.some(answer => answer.isFetching),
    // The FIRST failure, which is enough for the grid: what a reader needs per
    // widget is already in that widget's slot, and this says only that
    // something in the batch did not answer.
    error: results.find(answer => answer.error)?.error ?? null,
    refetch: () => Promise.all(results.map(answer => answer.refetch())),
    // `dataUpdatedAt` is 0 until a partition has resolved once, which is not an
    // instant in 1970 -- it is the absence of one. A single unresolved
    // partition makes the whole line absent rather than wrong.
    updatedAt:
      settledAt.length > 0 && settledAt.every(at => at > 0)
        ? new Date(Math.min(...settledAt))
        : null,
  };
}
