/**
 * A refused publish's recovery writes to the entry's pending change, so the
 * entry editor runs it through the same gate as its own saves, and stores the
 * form with its own Save: while another author holds the entry the recovery is
 * refused before it saves or takes anything, though its toast may still be on
 * screen from before. While it runs, the entry's fields are read-only, so
 * nothing typed can race it.
 */
import { ShortcutProvider } from "@nextlyhq/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanup, createTestQueryClient } from "@admin/__tests__/utils";
import type { RefusedForm } from "@admin/hooks/useSharedFieldsRecovery";

const {
  useDocumentLock,
  updateOptions,
  autosaveOffer,
  savedCount,
  update,
  answer,
} = vi.hoisted(() => ({
  useDocumentLock: vi.fn(),
  // How many saves the editor last reported, which its preview follows.
  savedCount: { current: 0 },
  // The server's answer on changing the entry in the language on screen.
  answer: { current: "allowed" as "allowed" | "switching" },
  // The entry's update, where a save leaves the editor.
  update: vi.fn(),
  // A recovery point the editor offers back, when a test sets one.
  autosaveOffer: {
    current: null as { savedAt: Date; snapshot: unknown } | null,
  },
  updateOptions: {
    current: undefined as { refusedForm?: RefusedForm } | undefined,
  },
}));

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
  useAutosaveRecovery: ({ savedCount: saves = 0 }: { savedCount?: number }) => {
    savedCount.current = saves;
    return {
      offer: saves > 0 ? null : autosaveOffer.current,
      isResolved: true,
      dismiss: () => {},
      restore: () => {},
    };
  },
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
vi.mock("@admin/hooks/useUpdateAnswer", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/hooks/useUpdateAnswer")>()),
  useUpdateAnswer: () => answer.current,
}));

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
  // A published entry's Save keeps its change pending rather than live.
  draftsEnabled: true,
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
  update.mockResolvedValue({ item: entry });
  answer.current = "allowed";
  updateOptions.current = undefined;
  autosaveOffer.current = null;
  savedCount.current = 0;
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
      updateOptions.current?.refusedForm?.recover(work)
    ).rejects.toThrow();
    expect(work).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("runs while the entry is this author's", async () => {
    lockedBy("held-by-me");
    render(<EntryForm collection={collection} entry={entry} mode="edit" />, {
      wrapper: Providers,
    });
    const work = vi.fn(async () => undefined);

    await act(async () => {
      await updateOptions.current?.refusedForm?.recover(work);
    });
    // Its own Save first, then the take.
    expect(update).toHaveBeenCalledTimes(1);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["succeeds", (finish: Finish) => finish.resolve()],
    ["fails", (finish: Finish) => finish.reject(new Error("offline"))],
  ])(
    "holds the fields read-only while the recovery runs, and gives them back once it %s",
    async (_outcome, settle) => {
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
      let taking = false;
      act(() => {
        running = updateOptions.current?.refusedForm
          ?.recover(() => {
            taking = true;
            return held;
          })
          .catch(() => undefined);
      });
      // Its Save has stored the edit, and the take is under way.
      await act(async () => {
        await vi.waitFor(() => expect(taking).toBe(true));
      });
      expect(update).toHaveBeenCalledTimes(1);

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
    }
  );

  it("withholds an autosave recovery point while the recovery runs", async () => {
    // Restoring one writes into the form the recovery holds.
    autosaveOffer.current = { savedAt: new Date(), snapshot: {} };
    // Its Save fails, so nothing is stored that would withdraw the offer for
    // good: only the hold keeps it away.
    let failSave: () => void = () => {};
    update.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          failSave = () => reject(new Error("offline"));
        })
    );
    lockedBy("held-by-me");
    render(<EntryForm collection={collection} entry={entry} mode="edit" />, {
      wrapper: Providers,
    });
    expect(screen.getByRole("button", { name: "Restore" })).toBeTruthy();

    let running: Promise<unknown> | undefined;
    act(() => {
      running = updateOptions.current?.refusedForm
        ?.recover(async () => undefined)
        .catch(() => undefined);
    });
    await act(async () => {
      await vi.waitFor(() => expect(update).toHaveBeenCalled());
    });
    expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();

    await act(async () => {
      failSave();
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
      await updateOptions.current?.refusedForm?.recover(async () => undefined);
    });

    // Its Save stored the change, as any save does, which withdraws it.
    expect(update).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
  });

  it("counts the take as one of the editor's saves, so an open preview moves past the values it replaced", async () => {
    lockedBy("held-by-me");
    render(<EntryForm collection={collection} entry={entry} mode="edit" />, {
      wrapper: Providers,
    });
    const take = vi.fn(async () => undefined);

    await act(async () => {
      await updateOptions.current?.refusedForm?.recover(take);
    });

    // The Save counts once, before the take replaced what it stored; the
    // take once more, once the form starts afresh from what it wrote.
    expect(take).toHaveBeenCalledTimes(1);
    expect(savedCount.current).toBe(2);
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
      await updateOptions.current?.refusedForm?.recover(async () => undefined);
    });

    // The same form element, never remounted, and the claim asked for on
    // every render: no moment when a colleague could take the entry.
    expect(container.querySelector("form")).toBe(formBefore);
    expect(claims().every(Boolean)).toBe(true);
  });

  it("never opens a field between its Save resolving and the take, through the real host", async () => {
    // The Save's write answers when the test says; everything else, the
    // host's Save, the gate and the hold, is the editor's own.
    let storeSave: () => void = () => {};
    update.mockImplementation(
      () =>
        new Promise(resolve => {
          storeSave = () => resolve({ item: entry });
        })
    );
    lockedBy("held-by-me");
    render(<EntryForm collection={collection} entry={entry} mode="edit" />, {
      wrapper: Providers,
    });
    const summary = screen.getByRole("textbox", { name: "Summary" });
    fireEvent.change(summary, { target: { value: "Edited" } });

    let taking = false;
    let heldAtTake: boolean | undefined;
    let running: Promise<unknown> | undefined;
    act(() => {
      running = updateOptions.current?.refusedForm?.recover(async () => {
        taking = true;
        heldAtTake = summary.hasAttribute("readonly");
      });
    });
    await act(async () => {
      await vi.waitFor(() => expect(update).toHaveBeenCalled());
    });

    // The Save resolves; from here to the take, task by task as the browser
    // would run them, the field is never open to typing.
    const openAt: number[] = [];
    storeSave();
    for (let task = 0; task < 20 && !taking; task++) {
      if (!summary.hasAttribute("readonly")) openAt.push(task);
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
      });
    }
    await act(async () => {
      await running;
    });

    expect(taking).toBe(true);
    expect(openAt).toEqual([]);
    expect(heldAtTake).toBe(true);
  });

  it.each([
    [
      "a published entry with drafts: its change kept pending",
      { draftsEnabled: true },
      { status: "published" },
      { stores: true, status: undefined },
    ],
    [
      "an entry not yet published: saved as a draft",
      { draftsEnabled: true },
      { status: "draft" },
      { stores: true, status: "draft" },
    ],
    [
      "a published entry without drafts, whose every Save publishes",
      { draftsEnabled: false },
      { status: "published" },
      { stores: false, status: undefined },
    ],
  ])(
    "never publishes with its Save: %s",
    async (_case, collectionChange, entryChange, expected) => {
      lockedBy("held-by-me");
      const thisCollection = { ...(collection as object), ...collectionChange };
      const thisEntry = { ...(entry as object), ...entryChange };
      render(
        <EntryForm
          collection={thisCollection as never}
          entry={thisEntry as never}
          mode="edit"
        />,
        { wrapper: Providers }
      );
      fireEvent.change(screen.getByRole("textbox", { name: "Summary" }), {
        target: { value: "Edited" },
      });
      const take = vi.fn(async () => undefined);

      await act(async () => {
        await updateOptions.current?.refusedForm
          ?.recover(take)
          .catch(() => undefined);
      });

      if (expected.stores) {
        expect(update).toHaveBeenCalledTimes(1);
        const [payload] = update.mock.calls[0] as [Record<string, unknown>];
        expect(payload.status).toBe(expected.status);
        expect(take).toHaveBeenCalledTimes(1);
      } else {
        // Nothing stored, nothing taken: there is no Save of it to use.
        expect(update).not.toHaveBeenCalled();
        expect(take).not.toHaveBeenCalled();
      }
    }
  );

  it("stores and takes nothing while a language switch's answer is on its way, when no Save is offered", async () => {
    lockedBy("held-by-me");
    const { rerender } = render(
      <EntryForm collection={collection} entry={entry} mode="edit" />,
      { wrapper: Providers }
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Summary" }), {
      target: { value: "Edited" },
    });
    expect(updateOptions.current?.refusedForm?.mayWrite()).toBe(true);

    // The author switches language; until the new one is answered, nothing
    // that saves is offered.
    answer.current = "switching";
    rerender(<EntryForm collection={collection} entry={entry} mode="edit" />);
    const take = vi.fn(async () => undefined);

    // Asked before the take as well: no.
    expect(updateOptions.current?.refusedForm?.mayWrite()).toBe(false);
    await act(async () => {
      await expect(
        updateOptions.current?.refusedForm?.recover(take)
      ).rejects.toThrow();
    });
    expect(update).not.toHaveBeenCalled();
    expect(take).not.toHaveBeenCalled();
  });

  it("refuses in the quick-edit modal, which has no Save of its own to store the form with, and points to the document", async () => {
    lockedBy("held-by-me");
    render(
      <EntryForm collection={collection} entry={entry} mode="edit" embedded />,
      { wrapper: Providers }
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Summary" }), {
      target: { value: "Edited" },
    });
    const take = vi.fn(async () => undefined);

    await act(async () => {
      await expect(
        updateOptions.current?.refusedForm?.recover(take)
      ).rejects.toThrow(
        "Open the document to take the live values: they can't be taken from this quick edit."
      );
    });
    // Never a write of its own in place of the Save it lacks.
    expect(update).not.toHaveBeenCalled();
    expect(take).not.toHaveBeenCalled();
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
