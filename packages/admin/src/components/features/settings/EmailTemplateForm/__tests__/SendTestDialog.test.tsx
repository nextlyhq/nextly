/**
 * The send-test dialog sends to the signed-in user's own address, and offers
 * no other.
 *
 * The server picks the recipient, so the dialog has no field for one: it only
 * says where the test will arrive, and sends the template's id and its sample
 * data. These assert what a person sees and what the send is handed.
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

vi.mock("@admin/hooks/queries/useEmailTemplates", () => ({
  useSendTestEmailTemplate: () => ({ mutate, isPending: false }),
}));
vi.mock("@admin/hooks/useDashboardUser", () => ({
  useDashboardUser: () => userRead.current,
}));

import { SendTestDialog } from "../SendTestDialog";

const SAMPLE = { name: "Ana" };

function renderDialog(templateId = "t1") {
  return render(
    <SendTestDialog
      open
      onOpenChange={() => {}}
      templateId={templateId}
      templateName="Welcome"
      sampleData={SAMPLE}
    />
  );
}

beforeEach(() => {
  mutate.mockReset();
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

  it("sends the template's id and sample data, and no address", () => {
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: /send test/i }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]?.[0]).toEqual({
      templateId: "t1",
      variables: SAMPLE,
    });
  });

  it("still names the user's own address while it is loading", () => {
    userRead.current = { user: null, isLoading: true, error: null };
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
