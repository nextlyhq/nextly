// The guard's optional Save choice, and the prompt it keeps without one.
//
// A caller that can save from the prompt passes `onSave`; the entry and Single
// editors pass none. So two contracts live here: the three-choice prompt a
// caller asked for, and the editors' two-choice prompt, unchanged word for
// word, when nobody asked.
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, waitFor, within } from "@admin/__tests__/utils";

import { UnsavedChangesGuard } from "../UnsavedChangesGuard";

const START = "/admin/collections/posts/1";
const ELSEWHERE = "/admin/somewhere-else";

/** Navigates the way the admin's own router does: by pushing history. */
function GoTo({ path, label }: { path: string; label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.history.pushState(null, "", path)}
    >
      {label}
    </button>
  );
}

/** The prompt's buttons, by name, in document order. */
function choices(dialog: HTMLElement): string[] {
  return within(dialog)
    .getAllByRole("button")
    .map(button => button.textContent ?? "");
}

/** A save the test settles by hand. */
function heldSave() {
  let settle!: (saved: boolean) => void;
  const onSave = vi.fn(
    () =>
      new Promise<boolean>(resolve => {
        settle = resolve;
      })
  );
  return { onSave, settle: (saved: boolean) => settle(saved) };
}

beforeEach(() => {
  window.history.pushState(null, "", START);
});

describe("the prompt with a Save choice", () => {
  async function ask(onSave: () => Promise<boolean>, onDiscard = vi.fn()) {
    const user = userEvent.setup();
    render(
      <UnsavedChangesGuard isDirty onSave={onSave} onDiscard={onDiscard}>
        <GoTo path={ELSEWHERE} label="go" />
        <GoTo path="/admin/second" label="second" />
      </UnsavedChangesGuard>
    );
    await user.click(screen.getByRole("button", { name: "go" }));
    const dialog = await screen.findByRole("alertdialog");
    return { user, dialog, onDiscard };
  }

  it("keeps the editors' title and first sentence, and drops the closing question", async () => {
    const { dialog } = await ask(() => Promise.resolve(true));

    expect(
      within(dialog).getByRole("heading", { name: "Unsaved Changes" })
    ).toBeInTheDocument();
    // Exactly the first sentence: a question asking whether to discard reads
    // wrong above a choice that also offers to save.
    expect(screen.getByText(/You have unsaved changes/)).toHaveTextContent(
      /^You have unsaved changes that will be lost if you leave this page\.$/
    );
  });

  it("offers Discard Changes, Keep Editing and Save Changes, in that order", async () => {
    const { dialog } = await ask(() => Promise.resolve(true));
    expect(choices(dialog)).toEqual([
      "Discard Changes",
      "Keep Editing",
      "Save Changes",
    ]);
  });

  it("starts focus on Keep Editing, the choice that loses nothing", async () => {
    const { dialog } = await ask(() => Promise.resolve(true));
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Keep Editing" })
      ).toHaveFocus()
    );
  });

  it("draws Discard as an outline in the destructive colour, set apart, and Save as the primary", async () => {
    // jsdom draws nothing; what is asserted is the cause, the classes.
    const { dialog } = await ask(() => Promise.resolve(true));
    const discard = within(dialog).getByRole("button", {
      name: "Discard Changes",
    });
    expect(discard).toHaveClass("border-destructive", "text-destructive");
    expect(discard).not.toHaveClass("bg-destructive-solid");
    // Pushed to the left edge, away from the two that keep the work.
    expect(discard).toHaveClass("sm:mr-auto");
    expect(
      within(dialog).getByRole("button", { name: "Save Changes" })
    ).toHaveClass("bg-primary");
  });

  it("stacks Save, Discard, then Keep Editing on a phone, with Keep Editing at the bottom", async () => {
    const { dialog } = await ask(() => Promise.resolve(true));
    // The phone order is set by `order-*` below the `sm` breakpoint; read it
    // back from the classes and sort by it.
    const phoneOrder = within(dialog)
      .getAllByRole("button")
      .map(button => ({
        name: button.textContent ?? "",
        order: Number(/(?:^|\s)order-(\d+)/.exec(button.className)?.[1]),
      }))
      .sort((a, b) => a.order - b.order)
      .map(button => button.name);
    expect(phoneOrder).toEqual([
      "Save Changes",
      "Discard Changes",
      "Keep Editing",
    ]);
  });

  it("Save Changes saves, then completes the navigation", async () => {
    const save = heldSave();
    const { user, dialog, onDiscard } = await ask(save.onSave);

    await user.click(
      within(dialog).getByRole("button", { name: "Save Changes" })
    );
    expect(save.onSave).toHaveBeenCalledTimes(1);
    // Not before the save has answered: leaving first would lose the work if
    // the save then failed.
    expect(window.location.pathname).toBe(START);

    save.settle(true);
    await waitFor(() => expect(window.location.pathname).toBe(ELSEWHERE));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    // A save is not a discard, and a caller cleaning up on discard must not
    // be told it was.
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it("holds the prompt open, its choices waiting, while the save runs", async () => {
    const save = heldSave();
    const { user, dialog } = await ask(save.onSave);

    await user.click(
      within(dialog).getByRole("button", { name: "Save Changes" })
    );
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /^Sav/ })).toBeDisabled();
    expect(
      within(dialog).getByRole("button", { name: "Discard Changes" })
    ).toBeDisabled();
    save.settle(false);
  });

  it("stays put when the save fails, and closes the prompt so the page can say why", async () => {
    const save = heldSave();
    const { user, dialog, onDiscard } = await ask(save.onSave);

    await user.click(
      within(dialog).getByRole("button", { name: "Save Changes" })
    );
    save.settle(false);

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(window.location.pathname).toBe(START);
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it("asks again on the next attempt after a failed save", async () => {
    // The failed attempt's navigation must be dropped, not left pending: a
    // pending one makes the guard ignore every attempt after it.
    const save = heldSave();
    const { user, dialog } = await ask(save.onSave);
    await user.click(
      within(dialog).getByRole("button", { name: "Save Changes" })
    );
    save.settle(false);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

    // Past the guard's 500ms window between two prompts.
    await new Promise(resolve => setTimeout(resolve, 600));
    await user.click(screen.getByRole("button", { name: "second" }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(window.location.pathname).toBe(START);
  });

  it("asks again at once when a save fails moments after the prompt opened", async () => {
    // 🔴 No wait between the two. The guard spaces its prompts apart, and a
    // retry inside that window used to be held without a prompt: the
    // navigation waited on a question nobody was asked, and every attempt
    // after it was ignored.
    const save = heldSave();
    const { user, dialog } = await ask(save.onSave);
    await user.click(
      within(dialog).getByRole("button", { name: "Save Changes" })
    );
    save.settle(false);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

    await user.click(screen.getByRole("button", { name: "second" }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(window.location.pathname).toBe(START);
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Discard Changes",
      })
    );
    expect(window.location.pathname).toBe("/admin/second");
  });

  it("Discard Changes still leaves without saving", async () => {
    const onSave = vi.fn(() => Promise.resolve(true));
    const { user, dialog, onDiscard } = await ask(onSave);

    await user.click(
      within(dialog).getByRole("button", { name: "Discard Changes" })
    );

    expect(window.location.pathname).toBe(ELSEWHERE);
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("Keep Editing stays, and saves nothing", async () => {
    const onSave = vi.fn(() => Promise.resolve(true));
    const { user, dialog } = await ask(onSave);

    await user.click(
      within(dialog).getByRole("button", { name: "Keep Editing" })
    );

    expect(window.location.pathname).toBe(START);
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("the prompt without a Save choice", () => {
  it("is the editors' prompt, word for word, with their two choices", async () => {
    const user = userEvent.setup();
    render(
      <UnsavedChangesGuard isDirty>
        <GoTo path={ELSEWHERE} label="go" />
      </UnsavedChangesGuard>
    );
    await user.click(screen.getByRole("button", { name: "go" }));
    const dialog = await screen.findByRole("alertdialog");

    expect(screen.getByText(/You have unsaved changes/)).toHaveTextContent(
      "You have unsaved changes that will be lost if you leave this page. Are you sure you want to discard your changes?"
    );
    expect(choices(dialog)).toEqual(["Keep Editing", "Discard Changes"]);
    expect(
      within(dialog).getByRole("button", { name: "Discard Changes" })
    ).toHaveClass("bg-destructive-solid");
  });
});
