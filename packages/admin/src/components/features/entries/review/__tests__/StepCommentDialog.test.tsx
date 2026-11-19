/**
 * The comment a step asks for is held to the server's own limit on a step's comment (4000
 * characters, its `MAX_STEP_COMMENT_LENGTH`), so the dialog never takes a comment the step would
 * refuse, nor refuses one it would take.
 */
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
});
