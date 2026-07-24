import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import type { WebhookDeliveryDetail } from "@admin/types/webhooks";

import { DeliveryDetailContent } from "../[deliveryId]";

// The spies are created with `vi.hoisted` because `vi.mock` factories are
// hoisted above the imports and would otherwise reference these before they
// exist; hoisting the spy definitions to the same level lets the factories
// close over them.
const { useDelivery, useRedeliver, redeliverMutate, canFor } = vi.hoisted(
  () => ({
    useDelivery: vi.fn(),
    useRedeliver: vi.fn(),
    redeliverMutate: vi.fn(),
    canFor: vi.fn((_slug: string) => true),
  })
);

vi.mock("@admin/hooks/queries", () => ({
  useDelivery: (webhookId: string, deliveryId: string) =>
    useDelivery(webhookId, deliveryId),
  useRedeliver: () => useRedeliver(),
}));
vi.mock("@admin/hooks/useCan", () => ({
  useCan: (slug: string) => canFor(slug),
}));

const DELIVERY: WebhookDeliveryDetail = {
  id: "dlv_1",
  webhookId: "wh_1",
  eventId: "evt_1",
  eventType: "entry.created",
  resource: { kind: "entry", collection: "posts", id: "p1", locale: null },
  status: "failed",
  attemptCount: 2,
  lastStatusCode: 500,
  lastLatencyMs: 120,
  lastError: "Internal Server Error",
  nextAttemptAt: "2026-07-24T10:00:00.000Z",
  eventCreatedAt: "2026-07-24T09:00:00.000Z",
  createdAt: "2026-07-24T09:00:01.000Z",
  updatedAt: "2026-07-24T09:05:00.000Z",
  lastResponseSnippet: "upstream error body",
  attempts: [
    { at: "2026-07-24T09:00:02.000Z", outcome: "retrying", statusCode: 503 },
    {
      at: "2026-07-24T09:05:00.000Z",
      outcome: "failed",
      statusCode: 500,
      error: "boom",
    },
  ],
};

describe("DeliveryDetailContent", () => {
  beforeEach(() => {
    useDelivery.mockReset();
    useRedeliver.mockReset();
    redeliverMutate.mockReset();
    canFor.mockReset();
    canFor.mockImplementation(() => true);
    useRedeliver.mockReturnValue({ mutate: redeliverMutate, isPending: false });
  });

  it("renders the status, response snippet, and the attempt timeline newest-first", () => {
    useDelivery.mockReturnValue({
      data: DELIVERY,
      isLoading: false,
      isError: false,
    });
    render(<DeliveryDetailContent webhookId="wh_1" deliveryId="dlv_1" />);

    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getAllByText("entry.created").length).toBeGreaterThan(0);
    expect(screen.getByText("upstream error body")).toBeInTheDocument();

    // The two attempt outcomes both render; the failed one (last chronologically)
    // appears before the retrying one because the timeline is reversed.
    const failed = screen.getByText("failed");
    const retrying = screen.getByText("retrying");
    expect(
      failed.compareDocumentPosition(retrying) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("shows the recorded-history length, not the reset attemptCount, after a redelivery", () => {
    // A redelivery resets attemptCount to 0 but keeps the attempt history, so
    // the Attempts stat must reflect the history (2), never the counter (0).
    useDelivery.mockReturnValue({
      data: { ...DELIVERY, attemptCount: 0 },
      isLoading: false,
      isError: false,
    });
    render(<DeliveryDetailContent webhookId="wh_1" deliveryId="dlv_1" />);

    // Both recorded attempts still render in the timeline...
    expect(screen.getByText("retrying")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();
    // ...and the reset counter value is not surfaced as the attempt count.
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("fires a redelivery when the button is clicked", async () => {
    useDelivery.mockReturnValue({
      data: DELIVERY,
      isLoading: false,
      isError: false,
    });
    render(<DeliveryDetailContent webhookId="wh_1" deliveryId="dlv_1" />);

    await userEvent.click(screen.getByRole("button", { name: /redeliver/i }));
    expect(redeliverMutate).toHaveBeenCalledWith(
      { webhookId: "wh_1", deliveryId: "dlv_1" },
      expect.anything()
    );
  });

  it("disables Redeliver while a redelivery is in flight", () => {
    useDelivery.mockReturnValue({
      data: DELIVERY,
      isLoading: false,
      isError: false,
    });
    useRedeliver.mockReturnValue({ mutate: redeliverMutate, isPending: true });
    render(<DeliveryDetailContent webhookId="wh_1" deliveryId="dlv_1" />);

    expect(screen.getByRole("button", { name: /redeliver/i })).toBeDisabled();
  });

  it("hides Redeliver for a user without update-webhooks", () => {
    canFor.mockImplementation(() => false);
    useDelivery.mockReturnValue({
      data: DELIVERY,
      isLoading: false,
      isError: false,
    });
    render(<DeliveryDetailContent webhookId="wh_1" deliveryId="dlv_1" />);

    expect(
      screen.queryByRole("button", { name: /redeliver/i })
    ).not.toBeInTheDocument();
  });

  it("notes that request payload and headers are not stored", () => {
    useDelivery.mockReturnValue({
      data: DELIVERY,
      isLoading: false,
      isError: false,
    });
    render(<DeliveryDetailContent webhookId="wh_1" deliveryId="dlv_1" />);

    expect(
      screen.getByText(/request body and headers are not stored/i)
    ).toBeInTheDocument();
  });
});
