/**
 * Reviewing an owner's update: every change needs a choice before anything is
 * applied, the choices go to the server together with the review token, and a
 * review the email has moved past is reloaded rather than applied.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  EmailTemplateComparison,
  OwnerUpdateUndo,
} from "@admin/services/emailTemplateApi";

import { OwnerUpdateReview } from "../OwnerUpdateReview";

const api = vi.hoisted(() => ({
  compareTemplate: vi.fn(),
  applyOwnerUpdate: vi.fn(),
}));

vi.mock("@admin/services/emailTemplateApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/emailTemplateApi")>();
  return { ...actual, ...api };
});

afterEach(() => {
  cleanup();
  api.compareTemplate.mockReset();
  api.applyOwnerUpdate.mockReset();
});

const version = {
  subject: "Welcome",
  htmlContent: "<p>Hi</p>",
  plainTextContent: null,
  preheader: null,
};

const comparison: EmailTemplateComparison = {
  base: version,
  theirs: { ...version, subject: "Welcome aboard" },
  mine: { ...version, subject: "Welcome!" },
  changes: [
    {
      id: "subject:0",
      field: "subject",
      conflict: true,
      base: ["Welcome"],
      theirs: ["Welcome aboard"],
      mine: ["Welcome!"],
    },
    {
      id: "htmlContent:0",
      field: "htmlContent",
      conflict: false,
      base: ["<p>Hi</p>"],
      theirs: ["<p>Hello</p>"],
      mine: ["<p>Hi</p>"],
    },
  ],
  review: "review-token",
};

const undo: OwnerUpdateUndo = {
  version,
  base: version,
  applied: "a",
  appliedBase: "b",
};

function mount(onApplied = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <OwnerUpdateReview
        open
        onOpenChange={() => {}}
        templateId="t1"
        name="Welcome"
        owner="Nextly"
        onApplied={onApplied}
      />
    </QueryClientProvider>
  );
  return { onApplied, client };
}

function card(index: number) {
  return screen.getAllByTestId("review-change")[index];
}

describe("reviewing an owner's update", () => {
  it("applies only once every change has a choice, with the review token", async () => {
    api.compareTemplate.mockResolvedValue(comparison);
    api.applyOwnerUpdate.mockResolvedValue({
      item: { id: "t1" },
      undo,
    });
    const { onApplied } = mount();

    await screen.findByText("Change 1 of 2 · Subject");
    const apply = screen.getByRole("button", { name: "Apply" });
    expect((apply as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("0 of 2 chosen")).toBeDefined();

    // Where both edited the same lines, the result can be written by hand.
    fireEvent.click(
      within(card(0)).getByRole("button", { name: "Edit the result" })
    );
    fireEvent.change(within(card(0)).getByLabelText("The result"), {
      target: { value: "Welcome aboard!" },
    });
    expect((apply as HTMLButtonElement).disabled).toBe(true);

    // A change the site didn't touch offers only the two sides.
    expect(
      within(card(1)).queryByRole("button", { name: "Edit the result" })
    ).toBeNull();
    fireEvent.click(
      within(card(1)).getByRole("button", { name: "Use theirs" })
    );
    expect(screen.getByText("2 of 2 chosen")).toBeDefined();
    expect((apply as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(apply);
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith(undo));
    expect(api.applyOwnerUpdate).toHaveBeenCalledWith(
      "t1",
      {
        "subject:0": { use: "edited", text: "Welcome aboard!" },
        "htmlContent:0": { use: "theirs" },
      },
      "review-token"
    );
  });

  it("reloads the comparison when the email moved since it was made", async () => {
    api.compareTemplate.mockResolvedValue(comparison);
    api.applyOwnerUpdate.mockRejectedValue(
      Object.assign(new Error("changed"), { code: "CONFLICT", status: 409 })
    );
    const { onApplied } = mount();

    await screen.findByText("Change 1 of 2 · Subject");
    fireEvent.click(
      within(card(0)).getByRole("button", { name: "Keep yours" })
    );
    fireEvent.click(
      within(card(1)).getByRole("button", { name: "Keep yours" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(api.compareTemplate).toHaveBeenCalledTimes(2));
    expect(onApplied).not.toHaveBeenCalled();
    // The choices were made on the old comparison, so they're cleared.
    await screen.findByText("0 of 2 chosen");
  });

  it("clears the choices when the comparison it shows is a new one", async () => {
    api.compareTemplate.mockResolvedValueOnce(comparison);
    const { client } = mount();
    await screen.findByText("Change 1 of 2 · Subject");
    fireEvent.click(
      within(card(0)).getByRole("button", { name: "Keep yours" })
    );
    fireEvent.click(
      within(card(1)).getByRole("button", { name: "Keep yours" })
    );
    expect(screen.getByText("2 of 2 chosen")).toBeDefined();

    // The owner changed it again: the same change ids, different text and
    // a new token. Choices made about the old text must not ride along.
    api.compareTemplate.mockResolvedValueOnce({
      ...comparison,
      review: "a-newer-review",
    });
    await client.refetchQueries();
    await screen.findByText("0 of 2 chosen");
  });

  it("shows both versions whole side by side", async () => {
    api.compareTemplate.mockResolvedValue(comparison);
    mount();
    await screen.findByText("Change 1 of 2 · Subject");
    fireEvent.click(screen.getByRole("button", { name: "Side by side" }));
    expect(screen.getByLabelText("Your version").textContent).toContain(
      "Welcome!"
    );
    expect(screen.getByLabelText("Nextly's version").textContent).toContain(
      "Welcome aboard"
    );
  });
});
