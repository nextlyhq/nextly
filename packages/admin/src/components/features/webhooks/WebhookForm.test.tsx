import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { describe, expect, it, vi } from "vitest";

import type { WebhookFormValues } from "@admin/lib/webhook-validation";
import type { WebhookEventTypeEntry } from "@admin/types/webhooks";

import { WebhookForm } from "./WebhookForm";

/** What the server lists: two of core's types and one a plugin declares. */
const listed: WebhookEventTypeEntry[] = [
  { type: "entry.created", owner: "core" },
  { type: "form.submission.created", owner: "core" },
  {
    type: "acme-shop.order.paid",
    owner: "@acme/shop",
    label: "Order paid",
  },
];

function setup(props: Partial<React.ComponentProps<typeof WebhookForm>> = {}) {
  const onSubmit = vi.fn();
  render(
    <WebhookForm
      eventTypes={listed}
      onSubmit={onSubmit}
      isPending={false}
      submitLabel="Create endpoint"
      pendingLabel="Creating…"
      {...props}
    />
  );
  return { onSubmit, user: userEvent.setup() };
}

const seeded: WebhookFormValues = {
  name: "Orders",
  url: "https://example.com/hooks",
  allEvents: false,
  eventTypes: ["entry.created"],
  headers: [],
  clearExistingHeaders: false,
  enabled: true,
};

describe("WebhookForm", () => {
  it("lists the specific event types and hides them when All events is on", async () => {
    const { user } = setup();
    expect(screen.getByText("entry.created")).toBeInTheDocument();

    const allEventsLabel = screen.getByText(/All events/i).closest("label");
    const toggle = within(allEventsLabel as HTMLElement).getByRole("switch");
    await user.click(toggle);

    expect(screen.queryByText("entry.created")).not.toBeInTheDocument();
  });

  it("blocks submit and surfaces a validation error when required fields are empty", async () => {
    const { onSubmit, user } = setup();
    await user.click(screen.getByRole("button", { name: /create endpoint/i }));
    expect(await screen.findByText("Name is required.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits the seeded values", async () => {
    const { onSubmit, user } = setup({
      defaultValues: seeded,
      submitLabel: "Save changes",
      pendingLabel: "Saving…",
    });
    await user.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [values] = onSubmit.mock.calls[0];
    expect(values.name).toBe("Orders");
    expect(values.eventTypes).toEqual(["entry.created"]);
  });

  it("offers a plugin's declared type, named by its label", () => {
    setup();
    expect(screen.getByText("acme-shop.order.paid")).toBeInTheDocument();
    expect(screen.getByText("Order paid")).toBeInTheDocument();
  });

  it("keeps a chosen type the server no longer lists, named and marked unavailable, and submits it", async () => {
    // A disabled plugin's type: the endpoint still subscribes to it.
    const { onSubmit, user } = setup({
      defaultValues: { ...seeded, eventTypes: ["acme-blog.comment.added"] },
      submitLabel: "Save changes",
      pendingLabel: "Saving…",
    });

    const row = screen.getByText("acme-blog.comment.added").closest("label");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("(unavailable)")).toBeVisible();
    expect(within(row as HTMLElement).getByRole("checkbox")).toBeChecked();
    // A listed type is not marked.
    const listedRow = screen.getByText("entry.created").closest("label");
    expect(
      within(listedRow as HTMLElement).queryByText("(unavailable)")
    ).toBeNull();

    await user.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].eventTypes).toEqual([
      "acme-blog.comment.added",
    ]);
  });

  it("refuses to change the events while an unavailable type is still ticked, naming it", async () => {
    const { onSubmit, user } = setup({
      defaultValues: { ...seeded, eventTypes: ["acme-blog.comment.added"] },
      submitLabel: "Save changes",
      pendingLabel: "Saving…",
    });

    const listedRow = screen.getByText("entry.created").closest("label");
    await user.click(within(listedRow as HTMLElement).getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    expect(
      await screen.findByText(
        /acme-blog\.comment\.added can no longer be subscribed to\. Untick it/
      )
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("changes the events once the unavailable type is unticked", async () => {
    const { onSubmit, user } = setup({
      defaultValues: { ...seeded, eventTypes: ["acme-blog.comment.added"] },
      submitLabel: "Save changes",
      pendingLabel: "Saving…",
    });

    const unavailableRow = screen
      .getByText("acme-blog.comment.added")
      .closest("label");
    await user.click(
      within(unavailableRow as HTMLElement).getByRole("checkbox")
    );
    const listedRow = screen.getByText("entry.created").closest("label");
    await user.click(within(listedRow as HTMLElement).getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].eventTypes).toEqual(["entry.created"]);
  });

  it("offers no types, and says so, while they load", () => {
    setup({ eventTypes: undefined, defaultValues: seeded });
    expect(screen.getByText("Loading event types…")).toBeInTheDocument();
    // Not shown as unavailable only because the list has not arrived.
    expect(screen.queryByText("(unavailable)")).toBeNull();
  });

  it("says when the types could not be loaded", () => {
    setup({ eventTypes: undefined, eventTypesFailed: true });
    expect(
      screen.getByText(/Could not load the event types/)
    ).toBeInTheDocument();
  });
});
