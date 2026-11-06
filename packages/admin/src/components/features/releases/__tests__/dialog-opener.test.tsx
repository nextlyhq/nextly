/**
 * A dialog opened from state, with no trigger of its own, hands focus back to
 * the button that opened it when it closes: by Escape, or by a button inside
 * it. Without that, focus falls to the top of the page.
 *
 * @module components/features/releases/__tests__/dialog-opener.test
 */
import userEvent from "@testing-library/user-event";
import { useState, type JSX } from "react";
import { describe, expect, it } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@admin/components/ui";

import { useReturnFocusOnClose } from "../dialog-opener";

/** A button that opens a dialog by setting state, as the releases screens do. */
function OpenedFromState(): JSX.Element {
  const [open, setOpen] = useState(false);
  const returnFocus = useReturnFocusOnClose(open);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open it</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent onCloseAutoFocus={returnFocus}>
          <DialogTitle>The dialog</DialogTitle>
          <DialogDescription>Opened from state.</DialogDescription>
          <Button onClick={() => setOpen(false)}>Done</Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

describe("useReturnFocusOnClose", () => {
  it("gives focus back to the opener when the dialog closes by Escape", async () => {
    const user = userEvent.setup();
    render(<OpenedFromState />);
    const opener = screen.getByRole("button", { name: "Open it" });
    await user.click(opener);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
  });

  it("gives focus back to the opener when a button inside closes it", async () => {
    const user = userEvent.setup();
    render(<OpenedFromState />);
    const opener = screen.getByRole("button", { name: "Open it" });
    await user.click(opener);
    await user.click(await screen.findByRole("button", { name: "Done" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
  });
});
