// Why: HooksEditorSheet wraps the existing HooksEditor in a right-side
// off-canvas Sheet so it can be opened from the BuilderToolbar's Hooks
// button. Tests lock the shell — title renders, Sheet opens, Close button
// fires onClose. The HooksEditor itself has its own test coverage; we
// don't re-test its internals here.
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { HooksEditorSheet } from "../HooksEditorSheet";

describe("HooksEditorSheet", () => {
  it("renders the Hooks title and the wrapped editor surface when open", () => {
    render(
      <HooksEditorSheet
        open
        hooks={[]}
        fieldNames={["title", "slug"]}
        onClose={vi.fn()}
        onChange={vi.fn()}
      />
    );
    expect(
      screen.getByRole("heading", { name: /^hooks$/i })
    ).toBeInTheDocument();
  });

  it("invokes onClose when the Close button is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <HooksEditorSheet
        open
        hooks={[]}
        fieldNames={["title", "slug"]}
        onClose={onClose}
        onChange={vi.fn()}
      />
    );
    await user.click(screen.getByRole("button", { name: /^close$/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not render the editor when closed", () => {
    render(
      <HooksEditorSheet
        open={false}
        hooks={[]}
        fieldNames={[]}
        onClose={vi.fn()}
        onChange={vi.fn()}
      />
    );
    expect(
      screen.queryByRole("heading", { name: /^hooks$/i })
    ).not.toBeInTheDocument();
  });
});
