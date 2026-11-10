/**
 * The conflict a save refused because the document changed since opens: who
 * changed it and when, the edits kept, and the author's choices.
 *
 * Loading the current version keeps the edits recoverable; saving anyway is
 * confirmed by a second step that says whose changes it replaces; a link
 * compares the versions where history is on.
 */
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { VersionConflictDialog } from "../VersionConflictDialog";

const CHANGED = {
  currentVersion: "4",
  changedBy: { kind: "person", name: "Ana Ruiz" },
  changedAt: "2026-11-05T10:42:00.000Z",
};

function open(
  props: Partial<Parameters<typeof VersionConflictDialog>[0]> = {}
) {
  const handlers = {
    onLoadCurrent: vi.fn(() => Promise.resolve()),
    onSaveAnyway: vi.fn(() => Promise.resolve()),
  };
  render(
    <VersionConflictDialog
      conflict={{ stale: CHANGED }}
      keepsRecoveryPoints
      compareHref={null}
      {...handlers}
      {...props}
    />
  );
  return handlers;
}

describe("the conflict of a save made from an older version", () => {
  it("names who changed the document and when, and says the edits are kept", () => {
    open();
    const dialog = screen.getByRole("alertdialog", {
      name: /changed since you started editing/i,
    });
    expect(dialog).toHaveTextContent(/Ana Ruiz changed it/);
    expect(dialog).toHaveTextContent(/2026/);
    expect(dialog).toHaveTextContent(/your edits are still here/i);
  });

  it("names nobody when the refusal names nobody", () => {
    open({ conflict: { stale: { currentVersion: "4" } } });
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).not.toHaveTextContent(/Ana/);
    expect(dialog).toHaveTextContent(/changed since you started editing/i);
  });

  it("loads the current version, keeping the edits as a recovery point", async () => {
    const { onLoadCurrent } = open();
    expect(
      screen.getByText(/kept as a recovery point you can restore/i)
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Load current version" })
    );
    expect(onLoadCurrent).toHaveBeenCalledOnce();
  });

  it("says the edits are discarded where the document keeps no recovery points", () => {
    open({ keepsRecoveryPoints: false });
    expect(screen.getByText(/your edits are discarded/i)).toBeInTheDocument();
  });

  it("saves anyway only after a step that says whose changes it replaces", async () => {
    const { onSaveAnyway } = open();
    await userEvent.click(screen.getByRole("button", { name: "Save anyway" }));
    expect(onSaveAnyway).not.toHaveBeenCalled();
    const confirm = screen.getByRole("alertdialog", {
      name: /replace Ana Ruiz's changes/i,
    });
    expect(confirm).toHaveTextContent(/replaces the changes Ana Ruiz made/i);

    await userEvent.click(
      screen.getByRole("button", { name: "Replace their changes" })
    );
    expect(onSaveAnyway).toHaveBeenCalledOnce();
  });

  it("goes back to the choices from the confirmation", async () => {
    const { onSaveAnyway } = open();
    await userEvent.click(screen.getByRole("button", { name: "Save anyway" }));
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(
      screen.getByRole("button", { name: "Load current version" })
    ).toBeInTheDocument();
    expect(onSaveAnyway).not.toHaveBeenCalled();
  });

  it("links the comparison where there is one, and not otherwise", () => {
    open({
      compareHref: "/admin/collections/posts/e1/versions?from=previous&to=13",
    });
    expect(
      screen.getByRole("link", { name: /see what ana ruiz changed/i })
    ).toHaveAttribute(
      "href",
      "/admin/collections/posts/e1/versions?from=previous&to=13"
    );
    // In a tab of its own, so the unsaved edits stay where they are.
    expect(screen.getByRole("link")).toHaveAttribute("target", "_blank");
  });

  it("offers no comparison without one", () => {
    open();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("says why a choice did not go through, keeping the choices", () => {
    open({
      conflict: {
        stale: CHANGED,
        failure: "Your edits could not be kept, so nothing was replaced.",
      },
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      /could not be kept, so nothing was replaced/
    );
    expect(
      screen.getByRole("button", { name: "Load current version" })
    ).toBeEnabled();
  });

  it("is closed without a conflict", () => {
    open({ conflict: null });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
