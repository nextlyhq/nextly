/**
 * One delivery's screen names the delivery, and the endpoint it went to, in the
 * browser tab.
 *
 * The delivery is named as the page heads it: its event and when the event
 * happened. The endpoint's name is not something this page loads, so it is
 * read only from what the endpoint's own pages have already loaded, and never
 * asked for: the webhook API is a spy that must stay unused.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WebhookDeliveryDetail } from "@admin/types/webhooks";

const { useDelivery, getWebhook, listWebhooks } = vi.hoisted(() => ({
  useDelivery: vi.fn(),
  getWebhook: vi.fn(),
  listWebhooks: vi.fn(),
}));

vi.mock("@admin/hooks/queries", () => ({
  useDelivery: (webhookId: string, deliveryId: string) =>
    useDelivery(webhookId, deliveryId),
  useRedeliver: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@admin/hooks/useCan", () => ({ useCan: () => true }));
vi.mock("@admin/services/webhookApi", () => ({
  webhookApi: { getWebhook, listWebhooks },
}));
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useAppName: () => "Golden Shop",
  useBranding: () => ({}),
}));

import { formatDeliveryTimestamp } from "@admin/components/features/webhooks/deliveryStatus";
import { DocumentTitleProvider } from "@admin/context/providers/DocumentTitleProvider";
import { webhookKeys } from "@admin/hooks/queries/useWebhooks";
import { resolveRoute } from "@admin/lib/routing";

import { DeliveryDetailContent } from "../[deliveryId]";

const PATH = "/admin/settings/webhooks/wh_1/deliveries/dlv_1";

const DELIVERY: WebhookDeliveryDetail = {
  id: "dlv_1",
  webhookId: "wh_1",
  eventId: "evt_1",
  eventType: "entry.created",
  resource: { kind: "entry", collection: "posts", id: "p1", locale: null },
  status: "delivered",
  attemptCount: 1,
  lastStatusCode: 200,
  lastLatencyMs: 80,
  lastError: null,
  nextAttemptAt: null,
  eventCreatedAt: "2026-07-24T09:00:00.000Z",
  createdAt: "2026-07-24T09:00:01.000Z",
  updatedAt: "2026-07-24T09:00:02.000Z",
  lastResponseSnippet: null,
  attempts: [],
};

/** When the event happened, as the page itself writes it. */
const WHEN = formatDeliveryTimestamp(DELIVERY.eventCreatedAt);

function screenWith(client: QueryClient) {
  return (
    <QueryClientProvider client={client}>
      <DocumentTitleProvider route={resolveRoute(PATH, "")} pathname={PATH}>
        <DeliveryDetailContent webhookId="wh_1" deliveryId="dlv_1" />
      </DocumentTitleProvider>
    </QueryClientProvider>
  );
}

function freshClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
}

beforeEach(() => {
  document.title = "Host title";
  useDelivery.mockReset();
  getWebhook.mockReset();
  listWebhooks.mockReset();
});

describe("a delivery's tab title", () => {
  it("names the delivery's event and time, then its endpoint, once loaded", () => {
    const client = freshClient();
    // The endpoint as its deliveries list left it.
    client.setQueryData(webhookKeys.detail("wh_1"), {
      id: "wh_1",
      name: "Order sync",
    });

    useDelivery.mockReturnValue({ data: undefined, isLoading: true });
    const view = render(screenWith(client));
    expect(document.title).toBe("Webhooks · Golden Shop");

    useDelivery.mockReturnValue({ data: DELIVERY, isLoading: false });
    view.rerender(screenWith(client));
    expect(document.title).toBe(
      `entry.created · ${WHEN} · Order sync · Webhooks · Golden Shop`
    );
    expect(getWebhook).not.toHaveBeenCalled();
    expect(listWebhooks).not.toHaveBeenCalled();
  });

  it("finds the endpoint in the endpoints list when that is what was loaded", () => {
    const client = freshClient();
    client.setQueryData(webhookKeys.lists(), [
      { id: "wh_9", name: "Other" },
      { id: "wh_1", name: "Order sync" },
    ]);
    useDelivery.mockReturnValue({ data: DELIVERY, isLoading: false });

    render(screenWith(client));

    expect(document.title).toBe(
      `entry.created · ${WHEN} · Order sync · Webhooks · Golden Shop`
    );
    expect(getWebhook).not.toHaveBeenCalled();
    expect(listWebhooks).not.toHaveBeenCalled();
  });

  it("names the delivery alone when nothing has loaded its endpoint, and asks for nothing", () => {
    useDelivery.mockReturnValue({ data: DELIVERY, isLoading: false });

    render(screenWith(freshClient()));

    expect(document.title).toBe(
      `entry.created · ${WHEN} · Webhooks · Golden Shop`
    );
    expect(getWebhook).not.toHaveBeenCalled();
    expect(listWebhooks).not.toHaveBeenCalled();
  });
});
