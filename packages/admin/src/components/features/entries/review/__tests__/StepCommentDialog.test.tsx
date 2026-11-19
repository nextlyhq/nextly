/**
 * The comment a step asks for is held to the server's own limit on a step's comment (4000
 * characters, its `MAX_STEP_COMMENT_LENGTH`), so the dialog never takes a comment the step would
 * refuse, nor refuses one it would take.
 */
import userEvent from "@testing-library/user-event";
import { useState, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { render, screen, waitFor } from "@admin/__tests__/utils";

import { StepCommentDialog } from "../StepCommentDialog";

describe("StepCommentDialog", () => {
  it("takes a comment up to the server's limit on a step's comment", () => {
    render(
      <StepCommentDialog
        open
        label="Send to legal"
        pending={false}
        asksForChanges={false}
        onSend={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByRole("textbox", { name: "Comment" })).toHaveAttribute(
      "maxLength",
      "4000"
    );
  });

  it.each(["Escape", "Cancel"])(
    "gives focus back to what opened it, closed by %s",
    async way => {
      render(<Opened />);
      const opener = screen.getByRole("button", { name: "Request changes…" });
      await userEvent.click(opener);
      // The dialog takes focus, on the comment it asks for.
      expect(
        await screen.findByRole("textbox", { name: "Comment" })
      ).toHaveFocus();
      if (way === "Escape") await userEvent.keyboard("{Escape}");
      else
        await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await waitFor(() => expect(opener).toHaveFocus());
    }
  );

  it("gives focus to the editor's main action where what opened it is gone", async () => {
    render(<Opened goneOnSend />);
    await userEvent.click(
      screen.getByRole("button", { name: "Request changes…" })
    );
    await userEvent.type(
      await screen.findByRole("textbox", { name: "Comment" }),
      "Shorten the intro."
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Request changes" })
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Submit for review" })
      ).toHaveFocus()
    );
  });
});

/**
 * The dialog opened from state, as a step's taker opens it, by a control
 * that, where `goneOnSend`, a step taken removes, as a header redrawn for the
 * next stage does. The header's main action is always drawn.
 */
function Opened({
  goneOnSend = false,
}: {
  goneOnSend?: boolean;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  return (
    <>
      <button type="button" data-primary="true">
        Submit for review
      </button>
      {goneOnSend && sent ? null : (
        <button type="button" onClick={() => setOpen(true)}>
          Request changes…
        </button>
      )}
      <StepCommentDialog
        open={open}
        label="Request changes"
        pending={false}
        asksForChanges
        onSend={() => {
          setSent(true);
          setOpen(false);
        }}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
