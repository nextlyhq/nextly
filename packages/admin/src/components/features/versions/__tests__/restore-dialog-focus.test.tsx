/**
 * Where focus goes when the restore dialog closes. It is opened from state, by a button outside
 * it, so it has no trigger of its own to go back to: closing it by Escape, by Cancel, or by
 * restoring hands focus back to the control that opened it, as long as that is still on the page.
 */
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { RestoreFieldsDialog } from "../RestoreFieldsDialog";
import type { RestoreRow } from "../restore-plan";

const rows: RestoreRow[] = [
  {
    name: "title",
    label: "Title",
    chosen: true,
    replacesUnsaved: false,
    shared: false,
    value: "First title",
  },
];

/** A page with the button that opens the dialog from state, as the title bar does. */
function Opener() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Restore this version
      </button>
      <RestoreFieldsDialog
        open={open}
        onOpenChange={setOpen}
        versionNo={1}
        rows={rows}
        onConfirm={() => setOpen(false)}
      />
    </>
  );
}

async function openByKeyboard() {
  render(<Opener />);
  const opener = screen.getByRole("button", { name: "Restore this version" });
  opener.focus();
  await userEvent.keyboard("{Enter}");
  expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
  return opener;
}

describe("closing the restore dialog", () => {
  it("by Escape puts focus back on the button that opened it", async () => {
    const opener = await openByKeyboard();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("by Cancel puts focus back on the button that opened it", async () => {
    const opener = await openByKeyboard();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(opener).toHaveFocus();
  });

  it("by restoring puts focus back on the button that opened it", async () => {
    const opener = await openByKeyboard();
    await userEvent.click(
      screen.getByRole("button", { name: "Restore 1 field" })
    );
    expect(opener).toHaveFocus();
  });
});
