// The guard that stops a dirty editor being navigated away from.
//
// It had never been mounted — present since the initial commit, exported
// through a barrel nothing imported — so nothing here is a regression test for
// behaviour that once worked. These pin the contract now that it is live, and
// the ones that matter most are the NEGATIVE cases: a guard that fires on a
// clean form is worse than no guard, because it gets removed.
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import {
  UnsavedChangesGuard,
  useLeaveWithoutWarning,
} from "../UnsavedChangesGuard";

/** Navigates the way the admin's own router does — by pushing history. */
function GoElsewhere() {
  return (
    <button
      type="button"
      onClick={() =>
        window.history.pushState(null, "", "/admin/somewhere-else")
      }
    >
      go
    </button>
  );
}

/** A control that has already asked the question itself. */
function DeliberateLeave() {
  const leaveWithoutWarning = useLeaveWithoutWarning();
  return (
    <button
      type="button"
      onClick={() => {
        leaveWithoutWarning();
        window.history.pushState(null, "", "/admin/somewhere-else");
      }}
    >
      discard and go
    </button>
  );
}

const START = "/admin/collections/posts/1";

describe("UnsavedChangesGuard", () => {
  beforeEach(() => {
    window.history.pushState(null, "", START);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("lets a clean editor leave without a word", async () => {
    // The case that decides whether this guard survives contact with users.
    render(
      <UnsavedChangesGuard isDirty={false}>
        <GoElsewhere />
      </UnsavedChangesGuard>
    );
    await userEvent.click(screen.getByRole("button", { name: "go" }));
    expect(window.location.pathname).toBe("/admin/somewhere-else");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("stops a dirty editor and asks", async () => {
    render(
      <UnsavedChangesGuard isDirty>
        <GoElsewhere />
      </UnsavedChangesGuard>
    );
    await userEvent.click(screen.getByRole("button", { name: "go" }));
    // Blocked: the URL must not have moved, or the work is already gone and
    // the dialog is asking about something that already happened.
    expect(window.location.pathname).toBe(START);
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
  });

  it("keeps the editor in place when the author chooses to stay", async () => {
    render(
      <UnsavedChangesGuard isDirty>
        <GoElsewhere />
      </UnsavedChangesGuard>
    );
    await userEvent.click(screen.getByRole("button", { name: "go" }));
    await userEvent.click(
      await screen.findByRole("button", { name: /keep editing/i })
    );
    expect(window.location.pathname).toBe(START);
  });

  it("says so when the author refuses to leave", async () => {
    // The counterpart to `onDiscard`. A caller that recorded an intent
    // alongside the navigation — "switch language AND fill it from this one" —
    // has to learn the navigation did not happen, or the intent outlives the
    // refusal and fires when that destination is reached by some other route.
    const onCancel = vi.fn();
    render(
      <UnsavedChangesGuard isDirty onCancel={onCancel}>
        <GoElsewhere />
      </UnsavedChangesGuard>
    );
    await userEvent.click(screen.getByRole("button", { name: "go" }));
    await userEvent.click(
      await screen.findByRole("button", { name: /keep editing/i })
    );
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe(START);
  });

  it("says so when the author dismisses the question rather than answering it", async () => {
    // Escape is a refusal too. Wiring only the button would leave the intent
    // alive for anyone who closes the dialog the other way — which is the more
    // common gesture, not the rarer one.
    const onCancel = vi.fn();
    render(
      <UnsavedChangesGuard isDirty onCancel={onCancel}>
        <GoElsewhere />
      </UnsavedChangesGuard>
    );
    await userEvent.click(screen.getByRole("button", { name: "go" }));
    await screen.findByRole("button", { name: /keep editing/i });
    await userEvent.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("does not report a refusal when the author confirmed", async () => {
    // The separating case: `onCancel` must not fire on the path that DID
    // navigate, or the intent is dropped exactly when it should be honoured.
    const onCancel = vi.fn();
    render(
      <UnsavedChangesGuard isDirty onCancel={onCancel}>
        <GoElsewhere />
      </UnsavedChangesGuard>
    );
    await userEvent.click(screen.getByRole("button", { name: "go" }));
    await userEvent.click(
      await screen.findByRole("button", { name: /discard/i })
    );
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("completes the navigation the author confirmed", async () => {
    const onDiscard = vi.fn();
    render(
      <UnsavedChangesGuard isDirty onDiscard={onDiscard}>
        <GoElsewhere />
      </UnsavedChangesGuard>
    );
    await userEvent.click(screen.getByRole("button", { name: "go" }));
    await userEvent.click(
      await screen.findByRole("button", { name: /discard/i })
    );
    expect(window.location.pathname).toBe("/admin/somewhere-else");
    expect(onDiscard).toHaveBeenCalled();
  });

  it("does not ask again when the action already did", async () => {
    // "Discard changes" IS the answer to this dialog's question. Asking it
    // again reads as a warning rather than as the confirmation just given.
    render(
      <UnsavedChangesGuard isDirty>
        <DeliberateLeave />
      </UnsavedChangesGuard>
    );
    await userEvent.click(
      screen.getByRole("button", { name: "discard and go" })
    );
    expect(window.location.pathname).toBe("/admin/somewhere-else");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("treats a change of QUERY as leaving, because here it is", async () => {
    // The editor addresses its content language as `?locale=`, and switching
    // language refetches the document and discards unsaved edits exactly as
    // leaving the page would. Comparing paths alone read that as "same place,
    // let it through", and the work went without anything asking.
    function SwitchLanguage() {
      return (
        <button
          type="button"
          onClick={() =>
            window.history.pushState(null, "", `${START}?locale=de`)
          }
        >
          switch
        </button>
      );
    }
    render(
      <UnsavedChangesGuard isDirty>
        <SwitchLanguage />
      </UnsavedChangesGuard>
    );
    await userEvent.click(screen.getByRole("button", { name: "switch" }));
    expect(window.location.search).toBe("");
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
  });

  it("lets a hash through, because it moves within the page rather than off it", async () => {
    function JumpToSection() {
      return (
        <button
          type="button"
          onClick={() => window.history.pushState(null, "", `${START}#fields`)}
        >
          jump
        </button>
      );
    }
    render(
      <UnsavedChangesGuard isDirty>
        <JumpToSection />
      </UnsavedChangesGuard>
    );
    await userEvent.click(screen.getByRole("button", { name: "jump" }));
    expect(window.location.hash).toBe("#fields");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("withholds nothing while disabled, so a submit in flight can navigate", async () => {
    render(
      <UnsavedChangesGuard isDirty disabled>
        <GoElsewhere />
      </UnsavedChangesGuard>
    );
    await userEvent.click(screen.getByRole("button", { name: "go" }));
    expect(window.location.pathname).toBe("/admin/somewhere-else");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("useLeaveWithoutWarning outside a guard", () => {
  it("is a no-op rather than a crash", async () => {
    // An embedded editor renders in a modal, with no guard above it.
    render(<DeliberateLeave />);
    await userEvent.click(
      screen.getByRole("button", { name: "discard and go" })
    );
    expect(window.location.pathname).toBe("/admin/somewhere-else");
  });
});
