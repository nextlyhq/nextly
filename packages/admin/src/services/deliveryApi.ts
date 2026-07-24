/**
 * Webhook delivery API service.
 *
 * Thin typed wrappers over the shared `fetcher` for the delivery log surface:
 * list an endpoint's deliveries (server-paginated), read one delivery with its
 * attempt history, re-arm a past delivery, and trigger a manual drain pass.
 *
 * Reads are session-or-key; redeliver and drain are session-only writes (the
 * fetcher's protected mode sends the cookie). No delivery shape carries a
 * credential — request headers actually sent are never persisted server-side.
 */

import { fetcher } from "../lib/api/fetcher";
import type { ListResponse, MutationResponse } from "../lib/api/response-types";
import type {
  ListDeliveriesParams,
  RunDrainResult,
  WebhookDeliveryDetail,
  WebhookDeliverySummary,
} from "../types/webhooks";

/** Build the delivery list query string, omitting unset filters. */
function toQuery(params: ListDeliveriesParams): string {
  const search = new URLSearchParams();
  if (params.page !== undefined) search.set("page", String(params.page));
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  if (params.status) search.set("status", params.status);
  // A blank event-type filter is "no filter"; only send a non-empty value.
  if (params.eventType) search.set("eventType", params.eventType);
  const query = search.toString();
  return query ? `?${query}` : "";
}

/** A page of an endpoint's deliveries plus the pagination meta. */
export function listDeliveries(
  webhookId: string,
  params: ListDeliveriesParams = {}
): Promise<ListResponse<WebhookDeliverySummary>> {
  return fetcher<ListResponse<WebhookDeliverySummary>>(
    `/webhooks/${webhookId}/deliveries${toQuery(params)}`,
    {},
    true
  );
}

/** Read one delivery (bare doc with attempt history; 404 if not this endpoint's). */
export function getDelivery(
  webhookId: string,
  deliveryId: string
): Promise<WebhookDeliveryDetail> {
  return fetcher<WebhookDeliveryDetail>(
    `/webhooks/${webhookId}/deliveries/${deliveryId}`,
    {},
    true
  );
}

/** Re-arm a past delivery for another attempt; returns the reset delivery. */
export async function redeliver(
  webhookId: string,
  deliveryId: string
): Promise<WebhookDeliveryDetail> {
  const result = await fetcher<MutationResponse<WebhookDeliveryDetail>>(
    `/webhooks/${webhookId}/deliveries/${deliveryId}/redeliver`,
    { method: "POST" },
    true
  );
  return result.item;
}

/** Run one manual drain pass; returns its summary counts. */
export async function runDrain(): Promise<RunDrainResult> {
  const result = await fetcher<MutationResponse<RunDrainResult>>(
    "/webhooks/drain",
    { method: "POST" },
    true
  );
  return result.item;
}

export const deliveryApi = {
  listDeliveries,
  getDelivery,
  redeliver,
  runDrain,
} as const;
