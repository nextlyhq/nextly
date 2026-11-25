/**
 * The entry editor of a collection removed from code offers no control that
 * would write, for a user holding every permission: no Save or Publish, no
 * Unpublish, Delete, Duplicate or discard, no page-contributed action,
 * its fields read-only and no claim made on the document. Reading stays: the
 * menu keeps "View API response". The notice is
 * the page's document banner, drawn under the header; the lock strip adds no
 * reader's sentence of its own.
 *
 * The control is the same editor for the same user on a declared collection,
 * which offers the writes, so a gate that never sees the removal fails here.
 */
import { ShortcutProvider } from "@nextlyhq/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanup, createTestQueryClient, screen } from "@admin/__tests__/utils";

const { useDocumentLock, menuProps, siteLocales } = vi.hoisted(() => ({
  useDocumentLock: vi.fn(),
  menuProps: vi.fn(),
  // The site's languages; none unless a case configures them.
  siteLocales: { list: [] as { code: string; label: string }[] },
}));

vi.mock("@admin/hooks/queries/useDocumentLock", () => ({ useDocumentLock }));
// The Languages menu, as what the editor hands it.
vi.mock(
  "@admin/components/features/languages-menu/DocumentLanguagesButton",
  () => ({
    DocumentLanguagesButton: (props: { hold: unknown }) => {
      menuProps(props);
      return null;
    },
  })
);
vi.mock("@admin/hooks/queries/useUpdateEntry", () => ({
  useUpdateEntry: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@admin/hooks/queries/useCreateEntry", () => ({
  useCreateEntry: () => ({ mutateAsync: vi.fn(), isPending: false }),
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
    locales: siteLocales.list,
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

import { EntryForm } from "../EntryForm";

function Providers({ children }: { children: ReactNode }): ReactElement {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      <ShortcutProvider isApple={false}>{children}</ShortcutProvider>
    </QueryClientProvider>
  );
}

function pages(removed: boolean, localized: boolean) {
  return {
    name: "pages",
    label: "Pages",
    status: true,
    localized,
    fields: [{ name: "title", type: "text", label: "Title" }],
    ...(removed
      ? {
          removedFromCode: true,
          removedFromCodeState: { state: "not-dropped" },
        }
      : {}),
  } as never;
}

const published = { id: "p1", title: "About", status: "published" } as never;

/** The text of every item in the editor's "More actions" menu. */
/**
 * Everything the document bar offers: its own buttons, then the items of its
 * "More actions" menu where it draws one. Which of them sit in the bar and
 * which in the menu follows the editor's width, and the bar draws no menu with
 * nothing in it, so both are read.
 */
async function menuItems(): Promise<string[]> {
  const bar = await screen.findByTestId("document-bar");
  const buttons = within(bar)
    .queryAllByRole("button")
    .map(
      button =>
        button.getAttribute("aria-label") ??
        button.getAttribute("title") ??
        button.textContent ??
        ""
    );
  const trigger = within(bar).queryByRole("button", { name: "More actions" });
  if (trigger === null) return buttons;
  await userEvent.setup().click(trigger);
  const items = await screen.findAllByRole("menuitem");
  return [...buttons, ...items.map(item => item.textContent ?? "")];
}

/** Every verb in the menu that writes the document or something about it. */
const WRITES = /save|publish|delete|duplicate|discard|release/i;

const releaseAction = {
  action: { id: "add-to-release", label: "Add to release", placement: "menu" },
  binding: { run: vi.fn() },
} as never;

function renderEditor(removed: boolean, localized = false) {
  render(
    <EntryForm
      collection={pages(removed, localized)}
      entry={published}
      mode="edit"
      documentBanner={<p>the page's banner</p>}
      documentActions={[releaseAction]}
    />,
    { wrapper: Providers }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  siteLocales.list = [];
  useDocumentLock.mockReturnValue({
    state: { status: "held-by-me" },
    takeOver: vi.fn(),
    requestAccess: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
});

describe("the entry editor of a collection removed from code", () => {
  it("offers nothing that writes, only reading", async () => {
    renderEditor(true);

    for (const name of [/^save/i, /^publish/i, /^update/i]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    const items = await menuItems();
    expect(items.filter(item => WRITES.test(item))).toEqual([]);
    // Reading stays: its history, and a preview, which writes no entry.
    expect(items).toEqual(
      expect.arrayContaining(["History", "Share preview link…"])
    );
  });

  it("still lets its reader open the other languages", () => {
    siteLocales.list = [
      { code: "en", label: "English" },
      { code: "de", label: "German" },
    ];
    renderEditor(true, true);

    expect(menuProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        editorPath: "/admin/collections/pages/p1",
        hold: {
          viewingPastVersion: false,
          recovering: false,
          changeAwaiting: false,
          documentHeld: false,
        },
      })
    );
  });

  it("shows its fields read-only, makes no claim, and adds no reader's sentence", () => {
    renderEditor(true);

    expect(screen.getByRole("textbox", { name: /title/i })).toHaveAttribute(
      "readonly"
    );
    expect(useDocumentLock).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false })
    );
    expect(screen.queryByText(/your access lets you view this/i)).toBeNull();
    expect(screen.getByText("the page's banner")).toBeInTheDocument();
  });

  it("offers the writes on a declared collection, for the same user", async () => {
    renderEditor(false);

    expect(
      screen.getAllByRole("button", { name: /^save/i }).length
    ).toBeGreaterThan(0);
    const items = await menuItems();
    expect(items).toEqual(
      expect.arrayContaining(["Unpublish", "Delete", "Add to release"])
    );
    expect(useDocumentLock).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: true })
    );
  });
});
