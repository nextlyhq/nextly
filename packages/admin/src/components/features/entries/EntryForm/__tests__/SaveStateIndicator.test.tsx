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
});
