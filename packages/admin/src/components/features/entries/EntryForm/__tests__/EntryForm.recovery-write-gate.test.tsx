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

const { useDocumentLock, updateOptions, autosaveOffer } = vi.hoisted(() => ({
  useDocumentLock: vi.fn(),
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
    return { mutateAsync: vi.fn(), isPending: false };
  },
}));
vi.mock("@admin/hooks/useAutosaveRecovery", () => ({
  useAutosaveRecovery: () => ({
    offer: autosaveOffer.current,
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
      expect(writeControls().some(control => !control.disabled)).toBe(true);
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
