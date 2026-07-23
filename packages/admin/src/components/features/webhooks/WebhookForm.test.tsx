import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { WebhookFormValues } from "@admin/lib/webhook-validation";

import { WebhookForm } from "./WebhookForm";

function setup(props: Partial<React.ComponentProps<typeof WebhookForm>> = {}) {
  const onSubmit = vi.fn();
  render(
    <WebhookForm
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
});
