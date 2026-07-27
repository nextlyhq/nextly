"use client";

/**
 * Webhook delivery query hooks.
 *
 * TanStack Query hooks for the delivery log: a server-paginated list, one
 * delivery's detail, a redelivery action, and a manual drain. The list and
 * detail keys nest under a per-endpoint delivery namespace so redeliver/drain
 * can invalidate an endpoint's deliveries without touching the endpoint list.
 *
 * `keepPreviousData` keeps the current page visible while the next one loads,
 * so paging and filtering don't flash an empty table.
 */

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import type { ListResponse } from "@admin/lib/api/response-types";
import { deliveryApi } from "@admin/services/deliveryApi";
import type {
  ListDeliveriesParams,
  RunDrainResult,
  WebhookDeliveryDetail,
  WebhookDeliverySummary,
} from "@admin/types/webhooks";

export const deliveryKeys = {
  all: () => ["webhook-deliveries"] as const,
  endpoint: (webhookId: string) => [...deliveryKeys.all(), webhookId] as const,
  list: (webhookId: string, params: ListDeliveriesParams) =>
    [...deliveryKeys.endpoint(webhookId), "list", params] as const,
  detail: (webhookId: string, deliveryId: string) =>
    [...deliveryKeys.endpoint(webhookId), "detail", deliveryId] as const,
};

/**
 * A page of an endpoint's deliveries. `enabled` lets the caller hold the fetch
 * until it knows the user may read (the read gate is the same as the endpoint
 * list).
 */
export function useDeliveries(
  webhookId: string,
  params: ListDeliveriesParams,
  options?: { enabled?: boolean }
) {
  return useQuery<ListResponse<WebhookDeliverySummary>, Error>({
    queryKey: deliveryKeys.list(webhookId, params),
    queryFn: () => deliveryApi.listDeliveries(webhookId, params),
    enabled: Boolean(webhookId) && (options?.enabled ?? true),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

/** One delivery with its attempt history, for the detail page. */
export function useDelivery(webhookId: string, deliveryId: string) {
  return useQuery<WebhookDeliveryDetail, Error>({
    queryKey: deliveryKeys.detail(webhookId, deliveryId),
    queryFn: () => deliveryApi.getDelivery(webhookId, deliveryId),
    enabled: Boolean(webhookId) && Boolean(deliveryId),
  });
}

/**
 * Re-arm a past delivery. Invalidates the endpoint's delivery keys so the list
 * and the open detail both refetch the reset state (status pending, attempt
 * count 0).
 */
export function useRedeliver() {
  const queryClient = useQueryClient();
  return useMutation<
    WebhookDeliveryDetail,
    Error,
    { webhookId: string; deliveryId: string }
  >({
    mutationFn: ({ webhookId, deliveryId }) =>
      deliveryApi.redeliver(webhookId, deliveryId),
    onSuccess: (_data, { webhookId }) => {
      void queryClient.invalidateQueries({
        queryKey: deliveryKeys.endpoint(webhookId),
      });
    },
  });
}

/**
 * Run a manual drain pass. A drain can advance deliveries for any endpoint, so
 * it invalidates every endpoint's delivery keys.
 */
export function useRunDrain() {
  const queryClient = useQueryClient();
  return useMutation<RunDrainResult, Error, void>({
    mutationFn: () => deliveryApi.runDrain(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.all() });
    },
  });
}
