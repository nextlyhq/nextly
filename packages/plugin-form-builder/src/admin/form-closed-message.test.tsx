// @vitest-environment jsdom

/**
 * The control an author writes the closed-form message in.
 *
 * The message was readable by every public path before it was writable by
 * anyone: the custom Edit view replaces the generic collection editor, and it
 * rendered no control for the field. An author using the advertised builder
 * could only ever get the schema default.
 *
 * These run against the real provider and the real view, because the defect was
 * that the value never crossed between them — a mocked context would have
 * carried it perfectly and proved nothing.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { FormBuilderView } from "./FormBuilderView";

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});

afterEach(cleanup);

const MESSAGE = /message for visitors/i;

function view(initialData: Record<string, unknown> = {}, onSave = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <FormBuilderView
        entryId="form-1"
        initialData={{
          name: "Contact",
          slug: "contact",
          // A form with no fields cannot be saved at all, so the save path
          // would never be reached.
          fields: [{ id: "f1", name: "email", label: "Email", type: "email" }],
          ...initialData,
        }}
        onSave={onSave}
      />
    </QueryClientProvider>
  );
  return onSave;
}

async function chooseStatus(label: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: /status/i }));
  await user.click(await screen.findByRole("option", { name: label }));
}

describe("the closed-form message control", () => {
  it("is offered once the author closes the form", async () => {
    view({ status: "published" });
    expect(screen.queryByLabelText(MESSAGE)).not.toBeInTheDocument();

    await chooseStatus("Closed");

    expect(screen.getByLabelText(MESSAGE)).toBeInTheDocument();
  });

  it("stays out of the way while the form is still open", () => {
    // The control: "appears when closed" must not be satisfied by one that is
    // always there. Most forms are never closed.
    view({ status: "draft" });
    expect(screen.queryByLabelText(MESSAGE)).not.toBeInTheDocument();
  });

  it("shows what the author wrote last time", () => {
    view({ status: "closed", closedMessage: "Applications closed 31 March." });
    expect(screen.getByLabelText(MESSAGE)).toHaveValue(
      "Applications closed 31 March."
    );
  });

  it("sends what the author typed to the save", async () => {
    const user = userEvent.setup();
    const onSave = view({ status: "closed" });

    await user.type(screen.getByLabelText(MESSAGE), "We have enough entries.");
    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ closedMessage: "We have enough entries." })
    );
  });
});
