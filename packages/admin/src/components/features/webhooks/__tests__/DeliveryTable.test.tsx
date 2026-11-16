import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { WebhookEventTypeEntry } from "@admin/types/webhooks";

import { DeliveryTable } from "../DeliveryTable";

const listed: WebhookEventTypeEntry[] = [
  { type: "entry.created", owner: "core" },
  { type: "acme-shop.order.paid", owner: "@acme/shop" },
];

function renderTable(
  eventType?: string,
  // `null` for a list that has not arrived; a default would stand in for
  // `undefined`.
  eventTypes: WebhookEventTypeEntry[] | null = listed,
  eventTypesFailed = false
) {
  const onEventTypeChange = vi.fn();
  render(
    <DeliveryTable
      rows={[]}
      totalItems={0}
      totalPages={1}
      page={0}
      pageSize={20}
      eventType={eventType}
      eventTypes={eventTypes ?? undefined}
      eventTypesFailed={eventTypesFailed}
      onPageChange={vi.fn()}
      onPageSizeChange={vi.fn()}
      onStatusChange={vi.fn()}
      onEventTypeChange={onEventTypeChange}
      onRowClick={vi.fn()}
    />
  );
  return { onEventTypeChange };
}

/** The event filter's options, read once the list is open. */
function openEventFilter(): string[] {
  fireEvent.click(screen.getByLabelText("Filter by event"));
  return screen.getAllByRole("option").map(option => option.textContent ?? "");
}

describe("DeliveryTable's event filter", () => {
  it("filters by a plugin's type, as by core's", () => {
    const { onEventTypeChange } = renderTable();

    expect(openEventFilter()).toEqual([
      "All events",
      "entry.created",
      "acme-shop.order.paid",
    ]);
    fireEvent.click(
      screen.getByRole("option", { name: "acme-shop.order.paid" })
    );
    expect(onEventTypeChange).toHaveBeenCalledWith("acme-shop.order.paid");
  });

  it("keeps the filter in force named, and marked unavailable, when the server no longer lists it", () => {
    renderTable("acme-blog.comment.added");

    expect(openEventFilter()).toContain(
      "acme-blog.comment.added (unavailable)"
    );
  });

  it("names a plugin's type by its label beside its id, as the webhook form does", () => {
    renderTable(undefined, [
      {
        type: "acme-shop.order.paid",
        owner: "@acme/shop",
        label: "Order paid",
      },
    ]);

    expect(openEventFilter()).toContain("Order paid (acme-shop.order.paid)");
  });

  it("says when the event types could not be loaded, rather than look empty", () => {
    renderTable(undefined, null, true);

    expect(
      screen.getByText(/Could not load the event types to filter by/)
    ).toBeInTheDocument();
  });

  it("offers only All events while the types load, and says nothing failed", () => {
    renderTable(undefined, null, false);

    expect(screen.queryByText(/Could not load the event types/)).toBeNull();
    expect(openEventFilter()).toEqual(["All events"]);
  });
});
