/**
 * A refused publish's recovery writes to the entry's pending change, so the
 * entry editor runs it through the same gate as its own saves: while another
 * author holds the entry the recovery is refused before it saves or takes
 * anything, though its toast may still be on screen from before. While it
 * runs, the entry's fields are read-only, so nothing typed can race it.
 */
import { ShortcutProvider } from "@nextlyhq/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanup, createTestQueryClient } from "@admin/__tests__/utils";
import type { RefusedForm } from "@admin/hooks/useSharedFieldsRecovery";

const { useDocumentLock, updateOptions, autosaveOffer, update } = vi.hoisted(
  () => ({
    useDocumentLock: vi.fn(),
    // The entry's update, where a save leaves the editor.
    update: vi.fn(),
    // A recovery point the editor offers back, when a test sets one.
    autosaveOffer: {
      current: null as { savedAt: Date; snapshot: unknown } | null,
    },
    updateOptions: {
      current: undefined as { refusedForm?: RefusedForm } | undefined,
    },
  })
);

vi.mock("@admin/hooks/queries/useDocumentLock", () => ({ useDocumentLock }));
// The form the editor hands its update mutation, which the recovery uses.
vi.mock("@admin/hooks/queries/useUpdateEntry", () => ({
  useUpdateEntry: (options: { refusedForm?: RefusedForm }) => {
    updateOptions.current = options;
    return { mutateAsync: update, isPending: false };
  },
}));
vi.mock("@admin/hooks/useAutosaveRecovery", () => ({
  // As the hook does: an offer is withdrawn once a save lands, which the
  // editor reports through `savedCount` (see the hook's own tests).
  useAutosaveRecovery: ({ savedCount = 0 }: { savedCount?: number }) => ({
    offer: savedCount > 0 ? null : autosaveOffer.current,
    isResolved: true,
    dismiss: () => {},
    restore: () => {},
  }),
}));
vi.mock("@admin/hooks/useDocumentAutosave", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/hooks/useDocumentAutosave")
  >()),
  useDocumentAutosave: () => ({ status: "idle", lastSavedAt: null }),
}));
vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({
    enabled: false,
    locales: [],
    defaultLocale: "en",
    fallback: true,
    getLocale: () => undefined,
  }),
}));
vi.mock("@admin/hooks/useCan", () => ({ useCan: () => true }));

import { EntryForm } from "../EntryForm";

function Providers({ children }: { children: ReactNode }): ReactElement {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      <ShortcutProvider isApple={false}>{children}</ShortcutProvider>
    </QueryClientProvider>
  );
}

const collection = {
  name: "pages",
  label: "Pages",
  status: true,
  fields: [
    { name: "title", type: "text", label: "Title" },
    { name: "summary", type: "text", label: "Summary" },
  ],
} as never;
const entry = { id: "e1", title: "Hello", status: "published" } as never;

function lockedBy(status: "held-by-me" | "held-by-other") {
  useDocumentLock.mockReturnValue({
    state:
      status === "held-by-me"
        ? { status }
        : {
            status,
            holder: { ownerId: "u2", ownerLabel: "Bob", expiresInSeconds: 90 },
          },
    takeOver: vi.fn(),
    requestAccess: vi.fn(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  updateOptions.current = undefined;
  autosaveOffer.current = null;
});

afterEach(() => {
  cleanup();
});

describe("the entry editor's recovery from a refused publish", () => {
  it("is refused, writing nothing, while another author holds the entry", async () => {
    lockedBy("held-by-other");
    render(<EntryForm collection={collection} entry={entry} mode="edit" />, {
      wrapper: Providers,
    });
    const work = vi.fn(async () => undefined);

    await expect(
      updateOptions.current?.refusedForm?.run(work)
    ).rejects.toThrow();
    expect(work).not.toHaveBeenCalled();
  });

  it("runs while the entry is this author's", async () => {
    lockedBy("held-by-me");
    render(<EntryForm collection={collection} entry={entry} mode="edit" />, {
      wrapper: Providers,
    });
    const work = vi.fn(async () => "ran");

    await expect(updateOptions.current?.refusedForm?.run(work)).resolves.toBe(
      "ran"
    );
  });

  it.each([
    // Once it succeeds the form is the reloaded entry, with nothing to save.
    ["succeeds", (finish: Finish) => finish.resolve(), false],
    // A recovery that fails leaves the edit, and its Save, as they were.
    ["fails", (finish: Finish) => finish.reject(new Error("offline")), true],
  ])(
    "holds the fields read-only while the recovery runs, and gives them back once it %s",
    async (_outcome, settle, saveOfferedAfter) => {
      lockedBy("held-by-me");
      render(<EntryForm collection={collection} entry={entry} mode="edit" />, {
        wrapper: Providers,
      });
      const summary = screen.getByRole("textbox", { name: "Summary" });
      expect(summary).not.toHaveAttribute("readonly");
      // An edit, so the entry has a write on offer to hold.
      fireEvent.change(summary, { target: { value: "Edited" } });
      expect(writeControls().some(control => !control.disabled)).toBe(true);

      // Made before the recovery starts, which runs its work a task later.
      const finish = {} as Finish;
      const held = new Promise<void>((resolve, reject) => {
        finish.resolve = resolve;
        finish.reject = reject;
      });
      // Its rejection reaches the recovery once it runs the work; marked as
      // handled here, since it may be rejected before then.
      held.catch(() => undefined);
      let running: Promise<unknown> | undefined;
      act(() => {
        running = updateOptions.current?.refusedForm
          ?.run(() => held)
          .catch(() => undefined);
      });

      // Read-only, not disabled, so a field keeps focus: the title too.
      expect(summary).toHaveAttribute("readonly");
      expect(summary).not.toBeDisabled();
      const title = screen.getByRole("textbox", { name: "Title" });
      expect(title).toHaveAttribute("readonly");
      expect(title).not.toBeDisabled();
      expect(summary.closest("form")).toHaveAttribute("aria-busy", "true");
      // And so is every write the document offers.
      for (const control of writeControls()) {
        expect(control, control.textContent ?? "").toBeDisabled();
      }

      await act(async () => {
        settle(finish);
        await running;
      });

      expect(summary).not.toHaveAttribute("readonly");
      expect(summary.closest("form")).not.toHaveAttribute("aria-busy");
      expect(title).not.toHaveAttribute("readonly");
      expect(writeControls().some(control => !control.disabled)).toBe(
        saveOfferedAfter
      );
    }
  );

  it("withholds an autosave recovery point while the recovery runs", async () => {
    // Restoring one writes into the form the recovery holds.
    autosaveOffer.current = { savedAt: new Date(), snapshot: {} };
    lockedBy("held-by-me");
    render(<EntryForm collection={collection} entry={entry} mode="edit" />, {
      wrapper: Providers,
    });
    expect(screen.getByRole("button", { name: "Restore" })).toBeTruthy();

    // Made before the recovery starts, which runs its work a task later.
    let done: () => void = () => {};
    const held = new Promise<void>(resolve => {
      done = resolve;
    });
    let running: Promise<unknown> | undefined;
    act(() => {
      running = updateOptions.current?.refusedForm?.run(() => held);
    });
    expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();

    await act(async () => {
      done();
      await running;
    });
    expect(screen.getByRole("button", { name: "Restore" })).toBeTruthy();
  });

  it("refuses a save once a colleague has taken the entry over", async () => {
    // A colleague writes only by taking the entry over, which holds this
    // editor's writes: a later save can't overwrite their version.
    lockedBy("held-by-me");
    const { container, rerender } = render(
      <EntryForm collection={collection} entry={entry} mode="edit" />,
      { wrapper: Providers }
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Summary" }), {
      target: { value: "Edited" },
    });

    useDocumentLock.mockReturnValue({
      state: {
        status: "taken-over",
        holder: { ownerId: "u2", ownerLabel: "Bob", expiresInSeconds: 90 },
      },
      takeOver: vi.fn(),
      requestAccess: vi.fn(),
    });
    rerender(<EntryForm collection={collection} entry={entry} mode="edit" />);
    // Native submission, which no disabled button stands in front of.
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    // Settled, not polled: the submit is asynchronous, so it is given time to
    // happen and then found not to have.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    expect(update).not.toHaveBeenCalled();
  });

  it("saves the same way while this author holds the entry", async () => {
    // The control for the test above: the same submit does reach the update.
    lockedBy("held-by-me");
    const { container } = render(
      <EntryForm collection={collection} entry={entry} mode="edit" />,
      { wrapper: Providers }
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Summary" }), {
      target: { value: "Edited" },
    });

    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    await vi.waitFor(() => expect(update).toHaveBeenCalled());
  });

  it("withdraws an autosave recovery point the recovery's save made stale, so Restore can't bring the old values back", async () => {
    autosaveOffer.current = { savedAt: new Date(), snapshot: {} };
    lockedBy("held-by-me");
    render(<EntryForm collection={collection} entry={entry} mode="edit" />, {
      wrapper: Providers,
    });
    expect(screen.getByRole("button", { name: "Restore" })).toBeTruthy();

    await act(async () => {
      await updateOptions.current?.refusedForm?.run(async () => {
        updateOptions.current?.refusedForm?.saved();
      });
    });

    expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
  });

  it("keeps the entry's claim and its editor through the recovery", async () => {
    lockedBy("held-by-me");
    const { container } = render(
      <EntryForm collection={collection} entry={entry} mode="edit" />,
      { wrapper: Providers }
    );
    const formBefore = container.querySelector("form");
    const claims = () =>
      useDocumentLock.mock.calls.map(
        ([options]) => (options as { enabled?: boolean }).enabled !== false
      );

    await act(async () => {
      await updateOptions.current?.refusedForm?.run(async () => {
        updateOptions.current?.refusedForm?.saved();
      });
    });

    // The same form element, never remounted, and the claim asked for on
    // every render: no moment when a colleague could take the entry.
    expect(container.querySelector("form")).toBe(formBefore);
    expect(claims().every(Boolean)).toBe(true);
  });
});

/** The document's Save and Publish controls, wherever they are drawn. */
function writeControls(): HTMLButtonElement[] {
  return screen.getAllByRole("button", {
    name: /save|publish/i,
  }) as HTMLButtonElement[];
}

interface Finish {
  resolve: () => void;
  reject: (error: Error) => void;
}
