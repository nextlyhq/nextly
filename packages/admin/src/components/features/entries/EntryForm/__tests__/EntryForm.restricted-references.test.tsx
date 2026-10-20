/**
 * An entry's save sends a link the editor cannot see as the reference it is.
 *
 * The form holds such a link as a placeholder, at the top level and inside a
 * group; the save is observed where it leaves the editor, the update mutation.
 */
import { ShortcutProvider, TooltipProvider } from "@nextlyhq/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestQueryClient, screen, waitFor } from "@admin/__tests__/utils";
import { RESTRICTED_REFERENCE } from "@admin/lib/form/stored-references";

const { useDocumentLock, update } = vi.hoisted(() => ({
  useDocumentLock: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@admin/hooks/queries/useDocumentLock", () => ({ useDocumentLock }));
vi.mock("@admin/hooks/queries/useUpdateEntry", () => ({
  useUpdateEntry: () => ({ mutateAsync: update, isPending: false }),
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

import { EntryForm } from "../EntryForm";

const collection = {
  name: "posts",
  label: "Posts",
  fields: [
    { name: "title", type: "text", label: "Title" },
    {
      name: "tags",
      type: "relationship",
      label: "Tags",
      relationTo: "tags",
      hasMany: true,
    },
    {
      name: "hero",
      type: "group",
      label: "Hero",
      fields: [
        { name: "image", type: "upload", label: "Image", relationTo: "media" },
      ],
    },
  ],
} as never;

const entry = {
  id: "e1",
  title: "Hello",
  tags: [
    { id: "t1", title: "Tag one" },
    { id: "t2", [RESTRICTED_REFERENCE]: true },
  ],
  hero: { image: { id: "m1", [RESTRICTED_REFERENCE]: true } },
} as never;

function Providers({ children }: { children: ReactNode }): ReactElement {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      <ShortcutProvider isApple={false}>
        <TooltipProvider>{children}</TooltipProvider>
      </ShortcutProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useDocumentLock.mockReturnValue({
    state: { status: "held-by-me" },
    takeOver: vi.fn(),
    requestAccess: vi.fn(),
  });
  update.mockResolvedValue({ item: { id: "e1", title: "Saved" } });
});

describe("EntryForm — links the editor cannot see", () => {
  it("are saved as their references, and stay placeholders in the form", async () => {
    render(<EntryForm collection={collection} entry={entry} mode="edit" />, {
      wrapper: Providers,
    });
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Hello again" },
    });
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "s",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
    );

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Hello again",
        tags: [{ id: "t1", title: "Tag one" }, "t2"],
        hero: { image: "m1" },
      })
    );
    expect(
      screen.getByRole("group", { name: "Restricted or missing item t2" })
    ).toBeTruthy();
  });
});
