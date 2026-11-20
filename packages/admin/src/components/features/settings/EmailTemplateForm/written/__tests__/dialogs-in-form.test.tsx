/**
 * The written email's dialogs are drawn outside the workbench but sit inside
 * its form in React, so a dialog's own submit must stop there: bubbling on, it
 * would save the whole email and leave the page.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { ChipFallbackDialog } from "../ChipFallbackDialog";
import { LinkDialog } from "../LinkDialog";

/** `dialog` inside a form standing for the workbench's, with its submits. */
function insideWorkbench(dialog: ReactNode) {
  const saveEmail = vi.fn();
  render(
    <form
      onSubmit={event => {
        event.preventDefault();
        saveEmail();
      }}
    >
      {dialog}
    </form>
  );
  return saveEmail;
}

describe("a written email's dialog inside the workbench's form", () => {
  it("saves a fallback without saving the email", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const saveEmail = insideWorkbench(
      <ChipFallbackDialog
        open
        onOpenChange={() => {}}
        name="First name"
        fallback={undefined}
        hasTestValue
        onSave={onSave}
      />
    );
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Fallback"), "there");
    await user.click(
      within(dialog).getByRole("button", { name: "Save fallback" })
    );
    expect(onSave).toHaveBeenCalledWith("there");
    expect(saveEmail).not.toHaveBeenCalled();
  });

  it("saves a link without saving the email", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const saveEmail = insideWorkbench(
      <LinkDialog
        open
        onOpenChange={() => {}}
        link={undefined}
        choices={[]}
        onSave={onSave}
      />
    );
    const dialog = screen.getByRole("dialog");
    await user.type(
      within(dialog).getByRole("textbox", { name: "Address" }),
      "https://shop.example"
    );
    await user.click(within(dialog).getByRole("button", { name: "Save link" }));
    expect(onSave).toHaveBeenCalledWith({ url: "https://shop.example" });
    expect(saveEmail).not.toHaveBeenCalled();
  });
});
