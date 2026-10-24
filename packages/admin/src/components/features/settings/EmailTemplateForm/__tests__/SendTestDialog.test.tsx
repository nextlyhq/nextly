/**
 * The send-test dialog sends to the signed-in user's own address, and offers
 * no other.
 *
 * The server picks the recipient, so the dialog has no field for one: it only
 * says where the test will arrive and who will deliver it, and sends the
 * template's id, its sample data and what is on screen, unsaved edits
 * included. When the provider is the log, which delivers nothing, it says so.
 * These assert what a person sees and what the send is handed.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mutate = vi.hoisted(() => vi.fn());
const userRead = vi.hoisted(() => ({
  current: {
    user: { id: "u1", name: "Ana", email: "ana@example.com", avatar: null },
    isLoading: false,
    error: null,
  } as unknown,
}));

const target = vi.hoisted(() => ({
  current: {
    data: {
      to: "ana@example.com",
      delivery: { provider: "Resend", type: "resend", delivers: true },
    },
  } as unknown,
}));

vi.mock("@admin/hooks/queries/useEmailTemplates", () => ({
  useSendTestEmailTemplate: () => ({ mutate, isPending: false }),
  useSendTestTarget: () => target.current,
}));
vi.mock("@admin/hooks/useDashboardUser", () => ({
  useDashboardUser: () => userRead.current,
}));

import { SendTestDialog } from "../SendTestDialog";

const SAMPLE = { name: "Ana" };
const DRAFT = { subject: "Unsaved subject", htmlContent: "<p>Unsaved</p>" };
const draftOf = vi.fn(() => DRAFT);

function renderDialog(templateId = "t1") {
  return render(
    <SendTestDialog
      open
      onOpenChange={() => {}}
      templateId={templateId}
      templateName="Welcome"
      sampleData={SAMPLE}
      draftOf={draftOf}
    />
  );
}

beforeEach(() => {
  mutate.mockReset();
  draftOf.mockClear();
  target.current = {
    data: {
      to: "ana@example.com",
      delivery: { provider: "Resend", type: "resend", delivers: true },
    },
  };
  userRead.current = {
    user: { id: "u1", name: "Ana", email: "ana@example.com", avatar: null },
    isLoading: false,
    error: null,
  };
});
afterEach(cleanup);

describe("the send-test dialog", () => {
  it("says the test goes to the signed-in user's own address", () => {
    renderDialog();

    expect(screen.getByTestId("send-test-recipient").textContent).toContain(
      "ana@example.com"
    );
  });

  it("has no field for a recipient", () => {
    renderDialog();

    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("sends the template's id, sample data and what is on screen, and no address", () => {
    renderDialog();
    // Read when the test is sent, not when the dialog opens: an edit made
    // with the dialog open is on screen too.
    expect(draftOf).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /send test/i }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]?.[0]).toEqual({
      templateId: "t1",
      variables: SAMPLE,
      draft: DRAFT,
    });
  });

  it("names the provider that will deliver it", () => {
    renderDialog();

    expect(screen.getByTestId("send-test-provider").textContent).toContain(
      "Resend"
    );
    expect(screen.queryByTestId("send-test-log")).toBeNull();
  });

  it("warns that the log provider delivers nothing", () => {
    target.current = {
      data: {
        to: "ana@example.com",
        delivery: {
          provider: "Log (no delivery)",
          type: "log",
          delivers: false,
        },
      },
    };
    renderDialog();

    const warning = screen.getByTestId("send-test-log");
    expect(warning.textContent).toContain("Nothing will be delivered");
    expect(warning.textContent).toContain("Log (no delivery)");
    expect(screen.queryByTestId("send-test-provider")).toBeNull();
  });

  it("still names the user's own address while it is loading", () => {
    userRead.current = { user: null, isLoading: true, error: null };
    target.current = { data: undefined };
    renderDialog();

    expect(screen.getByTestId("send-test-recipient").textContent).toContain(
      "your account's email address"
    );
  });

  it("does not send a template that is not saved yet", () => {
    renderDialog("");

    const send = screen.getByRole("button", { name: /send test/i });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(send);
    expect(mutate).not.toHaveBeenCalled();
  });
});
