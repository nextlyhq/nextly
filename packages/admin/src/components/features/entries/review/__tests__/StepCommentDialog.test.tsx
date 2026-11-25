/**
 * The comment a step asks for is held to the server's own limit on a step's comment (4000
 * characters, its `MAX_STEP_COMMENT_LENGTH`), so the dialog never takes a comment the step would
 * refuse, nor refuses one it would take.
 */
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

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

  it("opens empty again once its parent closes it after the step is sent", async () => {
    // A list closes the dialog when its move is answered, without a cancel: the next step opened
    // must not offer the last one's comment, ready to send.
    const user = userEvent.setup();
    const dialog = (open: boolean) => (
      <StepCommentDialog
        open={open}
        label="Submit for review"
        pending={false}
        asksForChanges={false}
        onSend={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    const { rerender } = render(dialog(true));
    await user.type(
      screen.getByRole("textbox", { name: "Comment" }),
      "Ready for legal"
    );
    rerender(dialog(false));
    rerender(dialog(true));
    expect(screen.getByRole("textbox", { name: "Comment" })).toHaveValue("");
    expect(
      screen.getByRole("button", { name: "Submit for review" })
    ).toBeDisabled();
  });
});
