/**
 * Pins the confirm copy + confirm/cancel wiring. The dialog is a presentational
 * wrapper around shadcn AlertDialog; the actual discard mutation lives in the
 * parent's onConfirm callback. Discarding deletes saved-but-unpublished edits,
 * so — unlike "Discard changes" — it is gated behind this confirm.
 */
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { DiscardDraftConfirmDialog } from "../DiscardDraftConfirmDialog";

describe("DiscardDraftConfirmDialog", () => {
  it("renders the title with the provided entryLabel", () => {
    render(
      <DiscardDraftConfirmDialog
        open
        onOpenChange={vi.fn()}
        entryLabel="Hello world"
        onConfirm={vi.fn()}
      />
    );
    expect(
      screen.getByRole("alertdialog", {
        name: /Discard draft for Hello world\?/,
      })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/permanently deletes the unpublished changes/i)
    ).toBeInTheDocument();
  });

  it("falls back to 'this entry' when entryLabel is empty/null/whitespace", () => {
    const { rerender } = render(
      <DiscardDraftConfirmDialog
        open
        onOpenChange={vi.fn()}
        entryLabel={null}
        onConfirm={vi.fn()}
      />
    );
    expect(
      screen.getByRole("alertdialog", {
        name: /Discard draft for this entry\?/,
      })
    ).toBeInTheDocument();

    rerender(
      <DiscardDraftConfirmDialog
        open
        onOpenChange={vi.fn()}
        entryLabel="   "
        onConfirm={vi.fn()}
      />
    );
    expect(
      screen.getByRole("alertdialog", {
        name: /Discard draft for this entry\?/,
      })
    ).toBeInTheDocument();
  });

  it("fires onConfirm when the user clicks Discard draft", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <DiscardDraftConfirmDialog
        open
        onOpenChange={vi.fn()}
        entryLabel="Live post"
        onConfirm={onConfirm}
      />
    );
    await user.click(screen.getByRole("button", { name: /^Discard draft$/ }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("disables both buttons while loading and renders the loading label", () => {
    render(
      <DiscardDraftConfirmDialog
        open
        onOpenChange={vi.fn()}
        entryLabel="Post"
        onConfirm={vi.fn()}
        isLoading
      />
    );
    expect(screen.getByRole("button", { name: /^Cancel$/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Discarding/i })).toBeDisabled();
  });
});
