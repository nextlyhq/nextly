/**
 * A refused publish's recovery writes to the entry's pending change, so the
 * entry editor runs it through the same gate as its own saves: while another
 * author holds the entry the recovery is refused before it saves or takes
 * anything, though its toast may still be on screen from before.
 */
import { ShortcutProvider } from "@nextlyhq/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanup, createTestQueryClient } from "@admin/__tests__/utils";
import type { RefusedForm } from "@admin/hooks/useSharedFieldsRecovery";

const { useDocumentLock, updateOptions } = vi.hoisted(() => ({
  useDocumentLock: vi.fn(),
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
    offer: null,
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
  fields: [{ name: "title", type: "text", label: "Title" }],
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
});
