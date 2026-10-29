/**
 * The Single editor of a Single removed from code offers no control that would
 * write, for a user holding every permission: no Save or Publish, no
 * Unpublish, no publishing of every language, no page-contributed action, its
 * fields read-only and no claim made on the document. Its history and a
 * preview stay. The notice is the page's document banner; the lock strip adds
 * no reader's sentence of its own.
 *
 * The control is the same editor for the same user on a declared Single.
 */
import { ShortcutProvider } from "@nextlyhq/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanup, createTestQueryClient, screen } from "@admin/__tests__/utils";

const { useDocumentLock, sidebarProps } = vi.hoisted(() => ({
  useDocumentLock: vi.fn(),
  sidebarProps: vi.fn(),
}));

vi.mock("@admin/hooks/queries/useDocumentLock", () => ({ useDocumentLock }));
// Drawn as it is, its props recorded: the publish-all hold is handed down here.
vi.mock(
  "@admin/components/features/entries/EntryForm/EntryFormSidebar",
  async importOriginal => {
    const actual =
      await importOriginal<
        typeof import("@admin/components/features/entries/EntryForm/EntryFormSidebar")
      >();
    return {
      EntryFormSidebar: (
        props: Parameters<typeof actual.EntryFormSidebar>[0]
      ) => {
        sidebarProps(props);
        return actual.EntryFormSidebar(props);
      },
    };
  }
);
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
// Every permission held, so whatever is withheld is withheld for the removal.
vi.mock("@admin/hooks/useCan", () => ({ useCan: () => true }));
vi.mock("@admin/hooks/useCanRequest", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/hooks/useCanRequest")>()),
  useCanRequest: () => true,
}));
vi.mock("@admin/hooks/useUpdateAnswer", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/hooks/useUpdateAnswer")>()),
  useUpdateAnswer: () => "allowed",
}));

import {
  SingleForm,
  type SingleDocumentData,
  type SingleSchema,
} from "../SingleForm";

function Providers({ children }: { children: ReactNode }): ReactElement {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      <ShortcutProvider isApple={false}>{children}</ShortcutProvider>
    </QueryClientProvider>
  );
}

function banner(removed: boolean): SingleSchema {
  return {
    slug: "banner",
    label: "Banner",
    status: true,
    fields: [
      { type: "text", name: "title", label: "Title" },
      { type: "text", name: "headline", label: "Headline" },
    ],
    ...(removed
      ? {
          removedFromCode: true,
          removedFromCodeState: { state: "half-retired" },
        }
      : {}),
  } as unknown as SingleSchema;
}

const document = {
  id: "banner",
  updatedAt: "2026-01-01T00:00:00.000Z",
  title: "Banner",
  headline: "Hello",
  status: "published",
} as unknown as SingleDocumentData;

const releaseAction = {
  action: { id: "add-to-release", label: "Add to release", placement: "menu" },
  binding: { run: vi.fn() },
} as never;

/** Every verb in the menu that writes the document or something about it. */
const WRITES = /save|publish|delete|duplicate|discard|release/i;

async function menuItems(): Promise<string[]> {
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "More actions" }));
  const items = await screen.findAllByRole("menuitem");
  return items.map(item => item.textContent ?? "");
}

function renderEditor(removed: boolean) {
  render(
    <SingleForm
      schema={banner(removed)}
      document={document}
      onSubmit={vi.fn()}
      documentBanner={<p>the page's banner</p>}
      documentActions={[releaseAction]}
    />,
    { wrapper: Providers }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useDocumentLock.mockReturnValue({
    state: { status: "held-by-me" },
    takeOver: vi.fn(),
    requestAccess: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
});

describe("the Single editor of a Single removed from code", () => {
  it("offers nothing that writes", async () => {
    renderEditor(true);

    for (const name of [/^save/i, /^publish/i, /^update/i]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    const items = await menuItems();
    expect(items.filter(item => WRITES.test(item))).toEqual([]);
    expect(items).toContain("History");
  });

  it("holds publishing every language, which the page offers a reader", () => {
    renderEditor(true);

    expect(sidebarProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ publishAllDisabled: true })
    );
  });

  it("shows its fields read-only, makes no claim, and adds no reader's sentence", () => {
    renderEditor(true);

    expect(screen.getByRole("textbox", { name: /headline/i })).toHaveAttribute(
      "readonly"
    );
    expect(useDocumentLock).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false })
    );
    expect(screen.queryByText(/your access lets you view this/i)).toBeNull();
    expect(screen.getByText("the page's banner")).toBeInTheDocument();
  });

  it("offers the writes on a declared Single, for the same user", async () => {
    renderEditor(false);

    const items = await menuItems();
    expect(items).toEqual(
      expect.arrayContaining(["Unpublish", "Add to release"])
    );
    expect(useDocumentLock).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: true })
    );
    expect(sidebarProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ publishAllDisabled: false })
    );
  });
});
