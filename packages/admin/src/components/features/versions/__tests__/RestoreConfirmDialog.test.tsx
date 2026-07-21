/**
 * The confirm before a restore. Its job is to be accurate about two things an
 * editor would otherwise assume wrongly: that restoring loses the current
 * content, and that it reproduces the old version exactly.
 */
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { RestoreConfirmDialog } from "../RestoreConfirmDialog";

describe("RestoreConfirmDialog", () => {
  it("names the version being restored", () => {
    render(
      <RestoreConfirmDialog
        open
        onOpenChange={vi.fn()}
        versionNo={7}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByText(/Restore version 7\?/)).toBeInTheDocument();
  });

  it("says the current content is kept", () => {
    // Without this an editor reasonably reads "restore" as discarding what is
    // there now, which would make a recoverable action feel destructive.
    render(
      <RestoreConfirmDialog
        open
        onOpenChange={vi.fn()}
        versionNo={7}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByText(/Nothing is lost/)).toBeInTheDocument();
    expect(
      screen.getByText(/undo this by\s+restoring again/)
    ).toBeInTheDocument();
  });

  it("says what a restore does not bring back", () => {
    // A version omits values that were never captured, and the write merges,
    // so "restore" is not a byte-for-byte rollback.
    render(
      <RestoreConfirmDialog
        open
        onOpenChange={vi.fn()}
        versionNo={7}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByText(/passwords/)).toBeInTheDocument();
  });

  it("says when the document is live", () => {
    render(
      <RestoreConfirmDialog
        open
        onOpenChange={vi.fn()}
        versionNo={7}
        isPublished
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByText(/the document is published/)).toBeInTheDocument();
  });

  it("confirms without closing itself, so the write stays visible", async () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <RestoreConfirmDialog
        open
        onOpenChange={onOpenChange}
        versionNo={7}
        onConfirm={onConfirm}
      />
    );

    await userEvent.click(
      screen.getByRole("button", { name: /Restore version 7/ })
    );

    expect(onConfirm).toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("blocks a second confirm while one is in flight", () => {
    render(
      <RestoreConfirmDialog
        open
        onOpenChange={vi.fn()}
        versionNo={7}
        onConfirm={vi.fn()}
        isRestoring
      />
    );

    expect(screen.getByRole("button", { name: /Restoring/ })).toBeDisabled();
  });
});
