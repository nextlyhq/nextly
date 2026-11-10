/**
 * A plugin's tab on a collection's edit page, as the entry editor hands it the
 * document: the form's own `control`, the lock a side panel section is told,
 * and `setBadge`, on a saved entry and a new one; the tab kept mounted while
 * Content is open, so what it holds survives a switch and its count stays
 * current; the bar's Save storing what it wrote; and the open tab kept in the
 * address.
 *
 * The save is observed where it leaves the editor, the update mutation, so
 * "Save stores what the tab wrote" is the editor's behaviour rather than a
 * recorder's.
 */
import { ShortcutProvider } from "@nextlyhq/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AdminContributionsMeta } from "nextly/config";
import {
  useEffect,
  useState,
  type JSX,
  type ReactElement,
  type ReactNode,
} from "react";
import { useController } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cleanup,
  createTestQueryClient,
  screen,
  waitFor,
} from "@admin/__tests__/utils";

const meta = vi.hoisted(() => ({
  contributions: undefined as AdminContributionsMeta | undefined,
}));
const { update, create } = vi.hoisted(() => ({
  update: vi.fn(),
  create: vi.fn(),
}));

vi.mock("@admin/context/providers/BrandingProvider", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/context/providers/BrandingProvider")
  >()),
  useBranding: () => ({ contributions: meta.contributions }),
}));
vi.mock("@admin/hooks/useDashboardUser", () => ({
  useDashboardUser: () => ({
    user: { id: "11111111-1111-4111-8111-111111111111" },
  }),
}));
vi.mock("@admin/hooks/queries/useDocumentLock", () => ({
  useDocumentLock: () => ({
    state: { status: "held-by-me" },
    takeOver: vi.fn(),
    requestAccess: vi.fn(),
  }),
}));
vi.mock("@admin/hooks/queries/useUpdateEntry", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/hooks/queries/useUpdateEntry")
  >()),
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
vi.mock("@admin/hooks/useCan", () => ({ useCan: () => true }));
vi.mock("@admin/hooks/useCanRequest", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/hooks/useCanRequest")>()),
  useCanRequest: () => true,
}));

import {
  registerComponent,
  unregisterComponent,
  type DocumentTabProps,
} from "@admin/lib/plugins/component-registry";

import { EntryForm } from "../EntryForm";

const SEO = "@acme/seo/admin#SeoTab";

/** What the tab was last handed. */
let handed: DocumentTabProps | undefined;

/**
 * Writes the entry's summary through the form's own control, as a plugin may,
 * keeps a note of its own that only a mounted component remembers, and
 * counts the summary's words in its badge.
 */
function SeoTab(props: DocumentTabProps): JSX.Element {
  handed = props;
  const { field } = useController({ control: props.control, name: "summary" });
  const [note, setNote] = useState("");
  const value = (field.value as string | undefined) ?? "";
  const words = value.trim() === "" ? 0 : value.trim().split(/\s+/).length;
  const { setBadge } = props;
  // A count beside the label, kept current from the tab's own effect.
  useEffect(() => {
    setBadge({ count: words, label: `${words} words`, tone: "attention" });
  }, [words, setBadge]);
  return (
    <>
      <label>
        Search description
        <input value={value} onChange={field.onChange} />
      </label>
      <label>
        Private note
        <input value={note} onChange={event => setNote(event.target.value)} />
      </label>
    </>
  );
}

const seoTab = {
  "collection.edit": {
    tab: [
      {
        plugin: "@acme/seo",
        id: "acme-seo.seo",
        kind: "tab",
        label: "SEO",
        component: SEO,
      },
    ],
  },
} as AdminContributionsMeta;

// No status, so the bar's leading action is Save.
const collection = {
  name: "posts",
  slug: "posts",
  label: "Posts",
  labels: { singular: "Post", plural: "Posts" },
  fields: [
    { name: "title", type: "text", label: "Title" },
    { name: "summary", type: "text", label: "Summary" },
  ],
} as never;
const entry = { id: "e1", title: "Hello", summary: "" } as never;

function Providers({ children }: { children: ReactNode }): ReactElement {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      <ShortcutProvider isApple={false}>{children}</ShortcutProvider>
    </QueryClientProvider>
  );
}

const renderEditor = (mode: "edit" | "create" = "edit") =>
  render(
    <EntryForm
      collection={collection}
      {...(mode === "edit" ? { entry } : {})}
      mode={mode}
    />,
    { wrapper: Providers }
  );

beforeEach(() => {
  vi.clearAllMocks();
  meta.contributions = seoTab;
  window.history.replaceState(null, "", "/admin/collections/posts/e1");
  registerComponent(SEO, SeoTab as never);
  handed = undefined;
  update.mockResolvedValue({ item: { id: "e1", title: "Hello" } });
  create.mockResolvedValue({ item: { id: "e2", title: "New" } });
});
afterEach(() => {
  cleanup();
  unregisterComponent(SEO);
  window.history.replaceState(null, "", "/");
});

describe("a plugin's tab on a collection's edit page", () => {
  it("is handed the document's form, its lock and setBadge, besides the place's context", () => {
    renderEditor();
    expect(handed).toMatchObject({
      context: { collection: "posts", entryId: "e1" },
      documentLock: { readOnly: false, actionsDisabled: false },
    });
    expect(typeof handed?.setBadge).toBe("function");
  });

  it("is drawn on a new entry, with no id yet, and handed the same form", () => {
    renderEditor("create");
    expect(screen.getByRole("tab", { name: /^SEO/ })).toBeInTheDocument();
    expect(handed?.context).toMatchObject({
      collection: "posts",
      entryId: null,
    });
    expect(handed?.control).toBeDefined();
  });

  it("keeps what the tab holds across a switch, and Save from the tab stores what it wrote", async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.type(screen.getByRole("textbox", { name: "Title" }), "!");

    await user.click(screen.getByRole("tab", { name: /^SEO/ }));
    await user.type(
      screen.getByRole("textbox", { name: "Search description" }),
      "Typed in the tab"
    );
    await user.type(
      screen.getByRole("textbox", { name: "Private note" }),
      "kept"
    );

    // The field column shows what the tab wrote through the form.
    await user.click(screen.getByRole("tab", { name: "Content" }));
    expect(screen.getByRole("textbox", { name: "Summary" })).toHaveValue(
      "Typed in the tab"
    );

    // The tab was hidden, not unmounted: its own state is still there.
    await user.click(screen.getByRole("tab", { name: /^SEO/ }));
    expect(screen.getByRole("textbox", { name: "Private note" })).toHaveValue(
      "kept"
    );

    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Hello!", summary: "Typed in the tab" })
    );
  });

  it("keeps its count beside the label current while Content is open", async () => {
    const user = userEvent.setup();
    renderEditor();
    const seo = () => screen.getByRole("tab", { name: /^SEO/ });
    expect(seo()).toHaveAccessibleName("SEO (0 words)");

    // Typed in the field column, with the tab closed.
    await user.type(
      screen.getByRole("textbox", { name: "Summary" }),
      "three short words"
    );
    expect(seo()).toHaveAccessibleName("SEO (3 words)");
    expect(seo().querySelector("[data-tab-badge]")).toHaveTextContent("3");
  });

  it("keeps the open tab in the address, replacing the history entry, and opens the tab an address names", async () => {
    const user = userEvent.setup();
    const before = window.history.length;
    renderEditor();
    await user.click(screen.getByRole("tab", { name: /^SEO/ }));
    expect(new URL(window.location.href).searchParams.get("tab")).toBe(
      "acme-seo.seo"
    );
    expect(window.history.length).toBe(before);

    await user.click(screen.getByRole("tab", { name: "Content" }));
    expect(new URL(window.location.href).searchParams.has("tab")).toBe(false);

    cleanup();
    window.history.replaceState(
      null,
      "",
      "/admin/collections/posts/e1?tab=acme-seo.seo"
    );
    renderEditor();
    expect(screen.getByRole("tab", { name: /^SEO/ })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  it("opens Content when the address names a tab this page does not have", () => {
    window.history.replaceState(
      null,
      "",
      "/admin/collections/posts/e1?tab=acme-other.gone"
    );
    renderEditor();
    expect(screen.getByRole("tab", { name: "Content" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(screen.getByRole("textbox", { name: "Summary" })).toBeVisible();
  });
});
