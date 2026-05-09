/**
 *
 * Pins the modal copy + confirm/cancel wiring. The dialog is purely a
 * presentational wrapper around shadcn AlertDialog; the actual unpublish
 * mutation lives in the parent's onConfirm callback.
 */
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { UnpublishConfirmDialog } from "../UnpublishConfirmDialog";

describe("UnpublishConfirmDialog", () => {
  it("renders the title with the provided entryLabel", () => {
    render(
      <UnpublishConfirmDialog
        open
        onOpenChange={vi.fn()}
        entryLabel="Hello world"
        onConfirm={vi.fn()}
      />
    );
    expect(
      screen.getByRole("alertdialog", { name: /Unpublish Hello world\?/ })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/remove the entry from your public site immediately/i)
    ).toBeInTheDocument();
  });

  it("falls back to 'this entry' when entryLabel is empty/null/whitespace", () => {
    const { rerender } = render(
      <UnpublishConfirmDialog
        open
        onOpenChange={vi.fn()}
        entryLabel={null}
        onConfirm={vi.fn()}
      />
    );
    expect(
      screen.getByRole("alertdialog", { name: /Unpublish this entry\?/ })
    ).toBeInTheDocument();

    rerender(
      <UnpublishConfirmDialog
        open
        onOpenChange={vi.fn()}
        entryLabel="   "
        onConfirm={vi.fn()}
      />
    );
    expect(
      screen.getByRole("alertdialog", { name: /Unpublish this entry\?/ })
    ).toBeInTheDocument();
  });

  it("fires onConfirm when the user clicks Unpublish", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <UnpublishConfirmDialog
        open
        onOpenChange={vi.fn()}
        entryLabel="Live post"
        onConfirm={onConfirm}
      />
    );
    await user.click(screen.getByRole("button", { name: /^Unpublish$/ }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("disables both buttons while loading and renders the loading label", () => {
    render(
      <UnpublishConfirmDialog
        open
        onOpenChange={vi.fn()}
        entryLabel="Post"
        onConfirm={vi.fn()}
        isLoading
      />
    );
    const cancel = screen.getByRole("button", { name: /^Cancel$/ });
    const confirm = screen.getByRole("button", { name: /Unpublishing/i });
    expect(cancel).toBeDisabled();
    expect(confirm).toBeDisabled();
  });
});
