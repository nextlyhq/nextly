/**
 * The header's save indicator, state by state.
 *
 * Each case is a way the indicator could tell an author something untrue: a
 * "Saved" over edits that live only in a recovery point, a failure with no way
 * to try again from the keyboard, or a chip that moves the controls beside it
 * every time it changes.
 */
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import {
  SaveStateIndicator,
  saveIndicatorView,
  type RecoveryPointState,
} from "../SaveStateIndicator";
import type { DocumentSaveState } from "../useDocumentActionBindings";

const NOW = new Date();
const noRecovery: RecoveryPointState = {
  enabled: true,
  storedAt: null,
  pendingOfferAt: null,
};

function indicator() {
  return screen.getByTestId("save-state-indicator");
}

describe("SaveStateIndicator", () => {
  it("says a save is in flight", () => {
    render(
      <SaveStateIndicator
        saveState={{ kind: "saving" }}
        recovery={noRecovery}
      />
    );
    expect(screen.getByText("Saving...")).toBeInTheDocument();
  });

  it("says the work is not stored, with the recovery point's line", () => {
    render(
      <SaveStateIndicator
        saveState={{ kind: "unsaved" }}
        recovery={noRecovery}
      />
    );
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(
      saveIndicatorView({ kind: "unsaved" }, { ...noRecovery, storedAt: NOW })
    ).toMatchObject({
      detail: "Recovery point stored just now. Newer changes not in it yet.",
    });
    expect(saveIndicatorView({ kind: "unsaved" }, noRecovery)).toMatchObject({
      detail: "A recovery point will be stored shortly",
    });
  });

  it("says Saved once a save lands", () => {
    render(
      <SaveStateIndicator
        saveState={{ kind: "saved", at: NOW }}
        recovery={noRecovery}
      />
    );
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("never says Saved over edits that live only in a newer recovery point", () => {
    render(
      <SaveStateIndicator
        saveState={{ kind: "saved", at: NOW }}
        recovery={{ ...noRecovery, pendingOfferAt: NOW }}
      />
    );
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    expect(
      saveIndicatorView(
        { kind: "saved", at: null },
        { ...noRecovery, pendingOfferAt: NOW }
      )
    ).toMatchObject({
      tone: "unsaved",
      detail: "Recovery point stored just now",
    });
  });

  it("names what failed and offers a real Retry that runs the save again", async () => {
    const user = userEvent.setup();
    const retry = vi.fn(() => Promise.resolve({ ok: true as const }));
    const failed: DocumentSaveState = {
      kind: "failed",
      message: "Site colours wasn't saved: offline",
      retry,
    };
    render(<SaveStateIndicator saveState={failed} recovery={noRecovery} />);

    expect(screen.getByText("Not saved")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Retry" });
    // What failed is the button's description, so it is read with it.
    expect(button).toHaveAccessibleDescription(
      "Site colours wasn't saved: offline"
    );

    // Reachable from the keyboard: a real button takes focus and Enter.
    await user.tab();
    expect(button).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("offers no Retry for a failure nothing here can try again, and still says what failed", async () => {
    const user = userEvent.setup();
    const failed: DocumentSaveState = {
      kind: "failed",
      message:
        "Site colours wasn't saved: offline Make that change again where you made it, and this page can then be saved.",
    };
    render(<SaveStateIndicator saveState={failed} recovery={noRecovery} />);

    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    const details = screen.getByRole("button", { name: "Details" });
    expect(details).toHaveAccessibleDescription(failed.message);
    await user.tab();
    expect(details).toHaveFocus();
  });

  it("says nothing for an opened document nothing has been stored in yet", () => {
    render(
      <SaveStateIndicator
        saveState={{ kind: "saved", at: null }}
        recovery={noRecovery}
      />
    );
    // The reserved space is still there; only its content is empty.
    expect(indicator()).toHaveAttribute("data-tone", "none");
    expect(indicator().textContent).toBe("");
  });

  it("reserves the same width in every state, so changing state shifts nothing", () => {
    const states: DocumentSaveState[] = [
      { kind: "saving" },
      { kind: "unsaved" },
      { kind: "saved", at: NOW },
      { kind: "saved", at: null },
      {
        kind: "failed",
        message: "offline",
        retry: () => Promise.resolve({ ok: true }),
      },
    ];
    const widths = states.map(saveState => {
      const { unmount } = render(
        <SaveStateIndicator saveState={saveState} recovery={noRecovery} />
      );
      const reserved = indicator()
        .className.split(" ")
        .filter(name => name.includes("min-w-"))
        .sort()
        .join(" ");
      unmount();
      return reserved;
    });
    expect(widths[0]).not.toBe("");
    expect(new Set(widths).size).toBe(1);
  });
  it("in a narrow bar keeps each state's icon and button but says its words only to a screen reader", () => {
    const states: DocumentSaveState[] = [
      { kind: "saving" },
      { kind: "unsaved" },
      { kind: "saved", at: NOW },
      {
        kind: "failed",
        message: "offline",
        retry: () => Promise.resolve({ ok: true }),
      },
    ];
    for (const saveState of states) {
      const { unmount } = render(
        <div data-state-compact="">
          <SaveStateIndicator saveState={saveState} recovery={noRecovery} />
        </div>
      );
      const label = screen.getByText(
        saveIndicatorView(saveState, noRecovery)?.label ?? ""
      );
      // Read where the bar's right part is under 32rem, and nowhere else.
      expect(label.className).toContain(
        "in-data-[state-compact]:@max-lg/toolbar:sr-only"
      );
      // The reserved width gives way to the icon alone, which never shrinks
      // under the verbs.
      expect(indicator().className).toContain(
        "in-data-[state-compact]:@max-lg/toolbar:min-w-fit"
      );
      unmount();
    }
    // The failed state's control stays a real button.
    render(
      <SaveStateIndicator
        saveState={{
          kind: "failed",
          message: "offline",
          retry: () => Promise.resolve({ ok: true }),
        }}
        recovery={noRecovery}
      />
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});

describe("changes from the last visit, offered in the chip", () => {
  /*
   * A view whose own bar shows the save state makes the recovery offer in the
   * chip, with the document's Save beside it: an untouched document with
   * changes waiting says so in those words, never "Unsaved changes" over a
   * Save that does nothing.
   */
  const offer = {
    savedAt: NOW,
    restore: vi.fn(),
    dismiss: vi.fn(),
    discard: vi.fn(),
  };
  const waiting = { ...noRecovery, pendingOfferAt: NOW };

  it("keeps the bar's short status, and says what the changes are in its popover", async () => {
    render(
      <SaveStateIndicator
        saveState={{ kind: "saved", at: null }}
        recovery={waiting}
        offer={offer}
        save={{ run: vi.fn() }}
      />
    );
    expect(indicator().dataset.tone).toBe("offered");
    expect(
      saveIndicatorView({ kind: "saved", at: null }, waiting, null, true)
    ).toEqual({ tone: "offered", label: "Unsaved changes" });
    // The offer's own control, not the restore offer made after an edit.
    await userEvent.click(
      screen.getByRole("button", { name: "Unsaved changes: Save or Discard" })
    );
    expect(
      await screen.findByText("Changes from your last visit aren't saved yet.")
    ).toBeInTheDocument();
  });

  it("offers Save, which runs the document's Save, and Discard, which stops offering for good", async () => {
    const run = vi.fn();
    const dismiss = vi.fn();
    const discard = vi.fn();
    render(
      <SaveStateIndicator
        saveState={{ kind: "saved", at: null }}
        recovery={waiting}
        offer={{ ...offer, dismiss, discard }}
        save={{ run }}
      />
    );
    const chip = screen.getByRole("button", {
      name: "Unsaved changes: Save or Discard",
    });

    await userEvent.click(chip);
    await userEvent.click(await screen.findByRole("button", { name: "Save" }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(discard).not.toHaveBeenCalled();

    await userEvent.click(chip);
    await userEvent.click(
      await screen.findByRole("button", { name: "Discard" })
    );
    // Discard lasts: not the session-only Not now.
    expect(discard).toHaveBeenCalledTimes(1);
    expect(dismiss).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("holds its Save, with the reason, where the document's Save is held", async () => {
    const run = vi.fn();
    render(
      <SaveStateIndicator
        saveState={{ kind: "saved", at: null }}
        recovery={waiting}
        offer={offer}
        save={{
          run,
          disabledReason: "This document is being edited elsewhere",
        }}
      />
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: "Unsaved changes: Save or Discard",
      })
    );
    const save = await screen.findByRole("button", { name: "Save" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(save.getAttribute("title")).toBe(
      "This document is being edited elsewhere"
    );
  });

  it("says Unsaved changes, with the restore offer, once something else has changed", () => {
    render(
      <SaveStateIndicator
        saveState={{ kind: "unsaved" }}
        recovery={waiting}
        offer={offer}
        save={{ run: vi.fn() }}
      />
    );
    expect(
      screen.getByRole("button", { name: "Unsaved changes: restore options" })
    ).toBeInTheDocument();
  });

  it("puts the restore offer off with Not now, for this session only", async () => {
    const dismiss = vi.fn();
    const discard = vi.fn();
    render(
      <SaveStateIndicator
        saveState={{ kind: "unsaved" }}
        recovery={waiting}
        offer={{ ...offer, dismiss, discard }}
      />
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Unsaved changes: restore options" })
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Not now" })
    );
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(discard).not.toHaveBeenCalled();
  });

  it("keeps the restore offer's words where no Save is given with the offer", () => {
    // Only a chip handed the document's Save can keep the changes, so only
    // it says so.
    render(
      <SaveStateIndicator
        saveState={{ kind: "saved", at: null }}
        recovery={waiting}
        offer={offer}
      />
    );
    expect(
      screen.getByRole("button", { name: "Unsaved changes: restore options" })
    ).toBeInTheDocument();
  });
});
