/**
 * The entry editor offers Delete only with the delete permission, and the
 * quick-edit and quick-create modals a relationship field opens offer Save
 * only with the update or create permission. A modal opened without it shows
 * the entry read-only, with nothing to save and a submit that sends nothing.
 *
 * The property that separates these from a plausible broken editor is that
 * the answer comes from the permission, not from whether the editor was given
 * a handler: the editor always has a delete handler and a modal always has a
 * submit.
 */
import { ShortcutProvider } from "@nextlyhq/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  act,
  cleanup,
  createTestQueryClient,
  screen,
} from "@admin/__tests__/utils";

const { useDocumentLock, update, create, canFor } = vi.hoisted(() => ({
  useDocumentLock: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  canFor: vi.fn((_slug: string) => false),
}));

vi.mock("@admin/hooks/queries/useDocumentLock", () => ({ useDocumentLock }));
// A save is observed where it leaves the editor: the mutations.
vi.mock("@admin/hooks/queries/useUpdateEntry", () => ({
  useUpdateEntry: () => ({ mutateAsync: update, isPending: false }),
}));
vi.mock("@admin/hooks/queries/useCreateEntry", () => ({
  useCreateEntry: () => ({ mutateAsync: create, isPending: false }),
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
vi.mock("@admin/hooks/useCan", () => ({
  useCan: (slug: string) => canFor(slug),
}));
// A request judged in other languages, held as `<request>:<slug>`.
vi.mock("@admin/hooks/useCanRequest", () => ({
  useCanRequest: (slug: string, request: string) =>
    canFor(`${request}:${slug}`),
}));

import { EntryForm } from "../EntryForm";

/** A caller holding exactly these permission slugs. */
const holding = (...slugs: string[]): void => {
  canFor.mockImplementation(slug => slugs.includes(slug));
};

function Providers({ children }: { children: ReactNode }): ReactElement {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      <ShortcutProvider isApple={false}>{children}</ShortcutProvider>
    </QueryClientProvider>
  );
}

const categories = {
  name: "categories",
  label: "Categories",
  fields: [{ name: "title", type: "text", label: "Title" }],
} as never;

const entry = { id: "c1", title: "News" } as never;

/** The `data-action` of every item in the editor's "More actions" menu. */
async function menuActions(): Promise<string[]> {
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "More actions" }));
  const items = await screen.findAllByRole("menuitem");
  return items.map(item => item.getAttribute("data-action") ?? "");
}

beforeEach(() => {
  vi.clearAllMocks();
  holding();
  useDocumentLock.mockReturnValue({
    state: { status: "held-by-me" },
    takeOver: vi.fn(),
    requestAccess: vi.fn(),
  });
  update.mockResolvedValue({ item: { id: "c1", title: "Saved" } });
  create.mockResolvedValue({ item: { id: "c2", title: "Made" } });
});

afterEach(() => {
  cleanup();
});

describe("the editor's Delete", () => {
  it("is not offered without the delete permission", async () => {
    holding("read-categories", "update-categories");
    render(<EntryForm collection={categories} entry={entry} mode="edit" />, {
      wrapper: Providers,
    });

    expect(await menuActions()).not.toContain("delete");
  });

  it("is offered with the delete permission", async () => {
    holding("read-categories", "update-categories", "delete-categories");
    render(<EntryForm collection={categories} entry={entry} mode="edit" />, {
      wrapper: Providers,
    });

    expect(await menuActions()).toContain("delete");
  });
});

describe("a quick-edit modal's Save", () => {
  it("is not offered without the update permission, and a submit sends nothing", async () => {
    holding("read-categories");
    render(
      <EntryForm collection={categories} entry={entry} mode="edit" embedded />,
      { wrapper: Providers }
    );

    expect(
      screen.queryByRole("button", { name: /save changes/i })
    ).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /title/i })).toHaveAttribute(
      "readonly"
    );

    const form = document.querySelector("form");
    if (form === null) throw new Error("no entry form");
    fireEvent.submit(form);
    await act(async () => {
      await Promise.resolve();
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("is not offered to a role that may update only in another language than the default", () => {
    // The modal sends no language, so the server writes the default one.
    holding("read-categories", "update-categories");
    render(
      <EntryForm collection={categories} entry={entry} mode="edit" embedded />,
      { wrapper: Providers }
    );

    expect(
      screen.queryByRole("button", { name: /save changes/i })
    ).not.toBeInTheDocument();
  });

  it("is offered with the update permission in the default language", () => {
    holding(
      "read-categories",
      "update-categories",
      "updateInDefaultLanguage:categories"
    );
    render(
      <EntryForm collection={categories} entry={entry} mode="edit" embedded />,
      { wrapper: Providers }
    );

    expect(
      screen.getByRole("button", { name: /save changes/i })
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /title/i })).not.toHaveAttribute(
      "readonly"
    );
  });
});

describe("a quick-create modal's Save", () => {
  it("is not offered without the create permission", () => {
    holding("read-categories", "update-categories");
    render(<EntryForm collection={categories} mode="create" embedded />, {
      wrapper: Providers,
    });

    expect(
      screen.queryByRole("button", { name: /^create$/i })
    ).not.toBeInTheDocument();
  });

  it("is offered with the create permission", () => {
    holding("read-categories", "create-categories");
    render(<EntryForm collection={categories} mode="create" embedded />, {
      wrapper: Providers,
    });

    expect(
      screen.getByRole("button", { name: /^create$/i })
    ).toBeInTheDocument();
  });
});
