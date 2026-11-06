/**
 * What a plugin changes on its collection's document screen: a built-in
 * action it hides or replaces in the "…" menu, and a section it adds to the
 * document panel. Another collection's screen is left as it was.
 *
 * The property separating these from a plausible broken editor: a replaced
 * Delete opens the plugin's component and never the built-in delete, a hidden
 * action is gone from the menu while the rest stay, and what the plugin says
 * it did (deleted, changed) reaches the editor as the built-in's own outcome
 * would.
 */
import { ShortcutProvider } from "@nextlyhq/ui";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  act,
  cleanup,
  createTestQueryClient,
  screen,
  waitFor,
} from "@admin/__tests__/utils";
import {
  registerComponent,
  unregisterComponent,
  type DocumentActionReplacementProps,
  type DocumentPanelSectionProps,
} from "@admin/lib/plugins/component-registry";

const { useDocumentLock, deleteEntry, plugins, brandingStatus, retryBranding } =
  vi.hoisted(() => ({
    retryBranding: vi.fn(),
    brandingStatus: {
      current: {
        isPending: false,
        isUnavailable: false,
        isBrandingUnavailable: false,
      },
    },
    useDocumentLock: vi.fn(),
    deleteEntry: vi.fn(),
    plugins: { current: [] as unknown[] },
  }));

/** The plugin list arrived: nothing pending, nothing failed. */
const SETTLED = {
  isPending: false,
  isUnavailable: false,
  isBrandingUnavailable: false,
};

vi.mock("@admin/hooks/queries/useDocumentLock", () => ({ useDocumentLock }));
vi.mock("@admin/hooks/queries/useUpdateEntry", () => ({
  useUpdateEntry: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@admin/hooks/queries/useCreateEntry", () => ({
  useCreateEntry: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
// The built-in delete is observed where it leaves the editor.
vi.mock("@admin/hooks/queries/useDeleteEntry", () => ({
  useDeleteEntry: () => ({ mutateAsync: deleteEntry, isPending: false }),
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
vi.mock("@admin/hooks/queries/useReleasesContaining", () => ({
  useReleasesContaining: () => ({
    data: { items: [] },
    isError: false,
    isPending: false,
  }),
}));
vi.mock("@admin/context/providers/BrandingProvider", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/context/providers/BrandingProvider")
  >()),
  useBranding: () => ({ plugins: plugins.current }),
  useBrandingStatus: () => ({
    ...brandingStatus.current,
    retry: retryBranding,
  }),
}));

import { toast } from "@admin/components/ui";
import {
  markModulesSettled,
  resetSettledModules,
} from "@admin/lib/plugins/component-registry-internal";

import { EntryForm } from "../EntryForm";
import { useDocumentLocale } from "../EntryFormContext";
import { useDocumentActions } from "../useDocumentActionHooks";

const REMOVE = "test/layouts#RemoveLayoutDialog";
const USAGE = "test/layouts#UsageSection";

const replacement: { current: DocumentActionReplacementProps | null } = {
  current: null,
};
/** What the replacement reads of the document it is drawn in. */
const drawnIn: {
  locale: ReturnType<typeof useDocumentLocale>;
  actions: boolean;
} = { locale: null, actions: false };
const section: { current: DocumentPanelSectionProps | null } = {
  current: null,
};

function RemoveLayoutDialog(props: DocumentActionReplacementProps) {
  replacement.current = props;
  drawnIn.locale = useDocumentLocale();
  drawnIn.actions = useDocumentActions() !== null;
  return <div role="dialog" aria-label="Remove layout" />;
}

function UsageSection(props: DocumentPanelSectionProps) {
  section.current = props;
  return <p>Used by 2 pages</p>;
}

/** The layouts plugin: Unpublish hidden, Delete replaced, a section added. */
const LAYOUTS_PLUGIN = {
  name: "@acme/layouts",
  documentActions: [
    { slug: "layouts", action: "unpublish", override: "hidden" },
    {
      slug: "layouts",
      action: "delete",
      override: { component: REMOVE, label: "Remove layout…" },
    },
  ],
  panelSections: [{ slug: "layouts", title: "Used by", component: USAGE }],
};

const collectionNamed = (name: string) =>
  ({
    name,
    label: name,
    status: true,
    fields: [
      { name: "title", type: "text", label: "Title" },
      { name: "summary", type: "text", label: "Summary" },
    ],
  }) as never;

const entry = {
  id: "l1",
  title: "Site layout",
  status: "published",
  createdAt: "2026-10-01T09:00:00Z",
  updatedAt: "2026-10-02T09:00:00Z",
} as never;

let queryClient: QueryClient;

function Providers({ children }: { children: ReactNode }): ReactElement {
  return (
    <QueryClientProvider client={queryClient}>
      <ShortcutProvider isApple={false}>{children}</ShortcutProvider>
    </QueryClientProvider>
  );
}

function renderEditor(slug: string, onDelete = vi.fn(), locale?: string) {
  render(
    <EntryForm
      collection={collectionNamed(slug)}
      entry={entry}
      mode="edit"
      {...(locale === undefined ? {} : { locale })}
      onDelete={onDelete}
      // Wired so the menu holds a row no override touches.
      onViewApi={() => {}}
    />,
    { wrapper: Providers }
  );
  return onDelete;
}

/** Opens the "More actions" menu and answers its items, by action id. */
async function openMenu(): Promise<HTMLElement[]> {
  const bar = await screen.findByTestId("document-bar");
  await userEvent
    .setup()
    .click(within(bar).getByRole("button", { name: "More actions" }));
  return screen.findAllByRole("menuitem");
}

const actionIds = (items: HTMLElement[]) =>
  items.map(item => item.getAttribute("data-action") ?? "");

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  queryClient = createTestQueryClient();
  plugins.current = [LAYOUTS_PLUGIN];
  brandingStatus.current = SETTLED;
  replacement.current = null;
  drawnIn.locale = null;
  drawnIn.actions = false;
  section.current = null;
  registerComponent(REMOVE, RemoveLayoutDialog as never);
  registerComponent(USAGE, UsageSection as never);
  useDocumentLock.mockReturnValue({
    state: { status: "held-by-me" },
    takeOver: vi.fn(),
    requestAccess: vi.fn(),
  });
  deleteEntry.mockResolvedValue({ item: { id: "l1" } });
});

afterEach(() => {
  cleanup();
  unregisterComponent(REMOVE);
  unregisterComponent(USAGE);
  resetSettledModules();
});

describe("a plugin's document actions", () => {
  it("leaves another collection's menu as it was", async () => {
    renderEditor("posts");
    const items = await openMenu();
    expect(actionIds(items)).toEqual(
      expect.arrayContaining(["unpublish", "delete"])
    );
    const del = items.find(item => item.dataset.action === "delete");
    expect(del).toHaveTextContent("Delete");
  });

  it("hides the action it hides, and keeps the others", async () => {
    renderEditor("layouts");
    const ids = actionIds(await openMenu());
    expect(ids).not.toContain("unpublish");
    expect(ids).toContain("view-api");
    expect(ids).toContain("delete");
  });

  it("opens its own component in place of the built-in Delete", async () => {
    renderEditor("layouts");
    const items = await openMenu();
    const del = items.find(item => item.dataset.action === "delete");
    expect(del).toHaveTextContent("Remove layout…");
    await userEvent.setup().click(del!);

    expect(
      await screen.findByRole("dialog", { name: "Remove layout" })
    ).toBeInTheDocument();
    expect(replacement.current).toMatchObject({
      action: "delete",
      collectionSlug: "layouts",
      entryId: "l1",
    });
    expect(deleteEntry).not.toHaveBeenCalled();
  });

  it("is drawn inside the document, so it knows the language being edited", async () => {
    // A replaced Unpublish of a translation has to know which translation:
    // drawn outside the editor's providers, the SDK's own hooks answer null.
    renderEditor("layouts", vi.fn(), "es");
    const del = (await openMenu()).find(
      item => item.dataset.action === "delete"
    );
    await userEvent.setup().click(del!);
    await screen.findByRole("dialog", { name: "Remove layout" });

    expect(drawnIn.locale).toMatchObject({ code: "es" });
    expect(drawnIn.actions).toBe(true);
  });

  it("answers every caller of a replacement that is already open, once it closes", async () => {
    // Two surfaces running Delete before the component closes share the one
    // component on screen, so they share its answer.
    let runs: Promise<unknown>[] = [];
    function Runner() {
      const actions = useDocumentActions();
      runner.run = actions?.run;
      return null;
    }
    const runner: { run?: (id: string) => Promise<unknown> } = {};
    registerComponent("test/layouts#Runner", Runner as never);
    plugins.current = [
      {
        ...LAYOUTS_PLUGIN,
        panelSections: [
          ...LAYOUTS_PLUGIN.panelSections,
          {
            slug: "layouts",
            title: "Runner",
            component: "test/layouts#Runner",
          },
        ],
      },
    ];
    renderEditor("layouts");
    await screen.findByText("Used by 2 pages");
    await act(async () => {
      runs = [runner.run!("delete"), runner.run!("delete")];
      await Promise.resolve();
    });
    await screen.findByRole("dialog", { name: "Remove layout" });

    act(() => replacement.current!.close("deleted"));

    await expect(Promise.all(runs)).resolves.toEqual([
      { ok: true },
      { ok: true },
    ]);
    unregisterComponent("test/layouts#Runner");
  });

  it("leaves the document when the component says it deleted it", async () => {
    const onDelete = renderEditor("layouts");
    const del = (await openMenu()).find(
      item => item.dataset.action === "delete"
    );
    await userEvent.setup().click(del!);
    await screen.findByRole("dialog", { name: "Remove layout" });

    act(() => replacement.current!.close("deleted"));

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "Remove layout" })).toBeNull();
    expect(deleteEntry).not.toHaveBeenCalled();
  });

  it("stays on the document when the author backs out", async () => {
    const onDelete = renderEditor("layouts");
    const del = (await openMenu()).find(
      item => item.dataset.action === "delete"
    );
    await userEvent.setup().click(del!);
    await screen.findByRole("dialog", { name: "Remove layout" });

    act(() => replacement.current!.close());

    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Remove layout" })).toBeNull();
  });
});

describe("a plugin's replacement over time", () => {
  /** The editor with the layouts plugin, drawn again on demand. */
  function renderLive(
    rows: { updatedAt: string } = entry as never,
    onDelete: () => void = () => {}
  ) {
    const element = (current: object) => (
      <EntryForm
        collection={collectionNamed("layouts")}
        entry={current as never}
        mode="edit"
        onViewApi={() => {}}
        onDelete={onDelete}
      />
    );
    const view = render(element(rows), { wrapper: Providers });
    return (next: object = rows) => view.rerender(element(next));
  }

  async function openRemove(): Promise<void> {
    const del = (await openMenu()).find(
      item => item.dataset.action === "delete"
    );
    await userEvent.setup().click(del!);
    await screen.findByRole("dialog", { name: "Remove layout" });
  }

  it("keeps the replacement told what holds the document, and whether it may write now", async () => {
    const drawAgain = renderLive();
    await openRemove();
    expect(replacement.current?.documentLock).toEqual({
      readOnly: false,
      actionsDisabled: false,
    });
    expect(replacement.current?.mayWrite()).toBe(true);
    // The dialog is open when a colleague takes the document over.
    const opened = replacement.current!;
    useDocumentLock.mockReturnValue({
      state: {
        status: "held-by-other",
        holder: { userId: "u2", name: "Ada", email: "ada@example.com" },
      },
      takeOver: vi.fn(),
      requestAccess: vi.fn(),
    });
    drawAgain();
    await waitFor(() =>
      expect(replacement.current?.documentLock.actionsDisabled).toBe(true)
    );
    // Asked at the moment of writing, even by the copy of the props the
    // component held from before the change.
    expect(opened.mayWrite()).toBe(false);
  });

  it("closes a replacement whose component is not registered, says so, and answers the run as cancelled", async () => {
    const error = vi.spyOn(toast, "error");
    // Its module has loaded, and registered nothing under this name: the
    // component is missing, not on its way.
    markModulesSettled(["test/layouts"]);
    plugins.current = [
      {
        ...LAYOUTS_PLUGIN,
        documentActions: [
          {
            slug: "layouts",
            action: "delete",
            override: { component: "test/layouts#Missing" },
          },
        ],
      },
    ];
    renderLive();
    const del = (await openMenu()).find(
      item => item.dataset.action === "delete"
    );
    await userEvent.setup().click(del!);
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        "This action couldn't open. Reload the page and try again."
      )
    );
    // Not wedged: the action can be chosen again.
    const again = (await openMenu()).find(
      item => item.dataset.action === "delete"
    );
    expect(again).not.toHaveAttribute("aria-disabled", "true");
    expect(deleteEntry).not.toHaveBeenCalled();
  });

  it("closes a replacement that throws while drawing, and says so", async () => {
    const error = vi.spyOn(toast, "error");
    vi.spyOn(console, "error").mockImplementation(() => {});
    function Throws(): never {
      throw new Error("plugin broke");
    }
    registerComponent("test/layouts#Throws", Throws as never);
    plugins.current = [
      {
        ...LAYOUTS_PLUGIN,
        documentActions: [
          {
            slug: "layouts",
            action: "delete",
            override: { component: "test/layouts#Throws" },
          },
        ],
      },
    ];
    renderLive();
    const del = (await openMenu()).find(
      item => item.dataset.action === "delete"
    );
    await userEvent.setup().click(del!);
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        "This action couldn't open. Reload the page and try again."
      )
    );
    unregisterComponent("test/layouts#Throws");
  });

  it("keeps the author's unsaved edits over a plugin's own change, and takes in the next version from someone else", async () => {
    const drawAgain = renderLive();
    const summary = await screen.findByRole("textbox", { name: "Summary" });
    await userEvent.setup().type(summary, "Not saved yet");
    await screen.findByText("Used by 2 pages");

    // The plugin's change, completed: reported, then its newer copy read back.
    act(() => section.current!.documentChanged("changed"));
    drawAgain({
      ...(entry as object),
      summary: "From the plugin",
      updatedAt: "2026-10-03T09:00:00Z",
    });
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Summary" })).toHaveValue(
        "Not saved yet"
      )
    );

    // Then someone else's newer version. It is not the plugin's, so it
    // replaces the form as any other newer version does. A form that kept
    // expecting the plugin's change after taking it in would keep the
    // unsaved text over this one too, and fail here.
    drawAgain({
      ...(entry as object),
      summary: "Theirs",
      updatedAt: "2026-10-04T09:00:00Z",
    });
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Summary" })).toHaveValue(
        "Theirs"
      )
    );
  });

  it("keeps expecting the plugin's change while its read back fails, so the copy a later read brings keeps the unsaved edits", async () => {
    // The refetch after the plugin's change fails: nothing in this test
    // answers it, and no read of the entry succeeds. Time passes, then a later
    // read brings the plugin's newer copy. Released when the refetch settled,
    // that copy would be taken for someone else's and reset the form.
    const drawAgain = renderLive();
    const summary = await screen.findByRole("textbox", { name: "Summary" });
    await userEvent.setup().type(summary, "Not saved yet");
    await screen.findByText("Used by 2 pages");

    act(() => section.current!.documentChanged("changed"));
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20));
    });
    drawAgain({
      ...(entry as object),
      summary: "From the plugin",
      updatedAt: "2026-10-03T09:00:00Z",
    });

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Summary" })).toHaveValue(
        "Not saved yet"
      )
    );
  });

  it("keeps expecting the plugin's change past a read that started before it, until the newer copy arrives", async () => {
    // A read already on its way when the plugin wrote lands first, with the
    // version from before the change. It is not the plugin's copy, so the
    // expectation stays, and the newer copy that follows keeps the edits. A
    // form that ended the expectation on any read would reset them here.
    const drawAgain = renderLive();
    const summary = await screen.findByRole("textbox", { name: "Summary" });
    await userEvent.setup().type(summary, "Not saved yet");
    await screen.findByText("Used by 2 pages");

    act(() => section.current!.documentChanged("changed"));
    // The stale read: a fresh copy of the version already on screen.
    drawAgain({ ...(entry as object) });
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20));
    });
    // Then the plugin's own newer copy.
    drawAgain({
      ...(entry as object),
      summary: "From the plugin",
      updatedAt: "2026-10-03T09:00:00Z",
    });

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Summary" })).toHaveValue(
        "Not saved yet"
      )
    );
  });

  it("closes an open replacement when the editor moves to another entry, and acts on neither", async () => {
    const onDelete = vi.fn();
    const drawAgain = renderLive(entry as never, onDelete);
    await openRemove();
    const forFirst = replacement.current!;
    expect(forFirst.entryId).toBe("l1");

    // The route moves to another entry while the dialog is open.
    drawAgain({ ...(entry as object), id: "l2", title: "Other layout" });

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Remove layout" })).toBeNull()
    );
    // What the first entry's dialog reports afterwards changes nothing.
    act(() => forFirst.close("deleted"));
    expect(onDelete).not.toHaveBeenCalled();
    expect(deleteEntry).not.toHaveBeenCalled();
  });

  it("ignores a close from a replacement that already closed, once another has opened", async () => {
    const onDelete = vi.fn();
    renderLive(entry as never, onDelete);
    await openRemove();
    const first = replacement.current!;
    act(() => first.close());
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Remove layout" })).toBeNull()
    );

    await openRemove();
    // The first one's close, late: it must not close the second or apply
    // its result.
    act(() => first.close("deleted"));

    expect(
      screen.getByRole("dialog", { name: "Remove layout" })
    ).toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("takes in someone else's newer version when no plugin changed the document", async () => {
    // The control for the case above: with no plugin change reported, the
    // first newer version already replaces the unsaved text. A fix that kept
    // unsaved edits over every newer version would fail here.
    const drawAgain = renderLive();
    const summary = await screen.findByRole("textbox", { name: "Summary" });
    await userEvent.setup().type(summary, "Not saved yet");

    drawAgain({
      ...(entry as object),
      summary: "Theirs",
      updatedAt: "2026-10-04T09:00:00Z",
    });

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Summary" })).toHaveValue(
        "Theirs"
      )
    );
  });

  it("holds a section's writes on a collection removed from code, as the editor holds its own", async () => {
    // The server refuses every write to such a collection and the editor
    // offers none; a plugin's section must be told the same.
    render(
      <EntryForm
        collection={
          {
            ...(collectionNamed("layouts") as object),
            removedFromCode: true,
          } as never
        }
        entry={entry}
        mode="edit"
      />,
      { wrapper: Providers }
    );
    await screen.findByText("Used by 2 pages");
    expect(section.current?.documentLock.actionsDisabled).toBe(true);
    expect(section.current?.mayWrite()).toBe(false);
  });
});

describe("before a plugin's components have loaded", () => {
  // On a cold load the plugin list arrives first and its admin module is
  // imported after the first render; nothing else draws the editor again.
  const COLD_USAGE = "test/cold#UsageSection";
  const COLD_REMOVE = "test/cold#RemoveDialog";
  const LOADING = "Loading this collection's plugin actions…";

  const COLD_PLUGIN = {
    name: "@acme/cold",
    documentActions: [
      {
        slug: "layouts",
        action: "delete",
        override: { component: COLD_REMOVE, label: "Remove layout…" },
      },
    ],
    panelSections: [
      { slug: "layouts", title: "Used by", component: COLD_USAGE },
    ],
  };

  afterEach(() => {
    unregisterComponent(COLD_USAGE);
    unregisterComponent(COLD_REMOVE);
  });

  it("draws a panel section as loading, then draws it once its component registers", async () => {
    plugins.current = [COLD_PLUGIN];
    renderEditor("layouts");
    const panel = await screen.findByRole("complementary", {
      name: "Document panel",
    });
    const region = within(panel).getByRole("region", { name: "Used by" });
    // The panel's own loading look, not a blank section.
    expect(region.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(within(region).queryByText("Used by 2 pages")).toBeNull();

    // The plugin's module loads and registers its component.
    act(() => {
      registerComponent(COLD_USAGE, UsageSection as never);
    });

    expect(await within(region).findByText("Used by 2 pages")).toBeVisible();
    expect(region.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it("holds a replaced action while its component loads, rather than opening it and failing", async () => {
    const error = vi.spyOn(toast, "error");
    plugins.current = [COLD_PLUGIN];
    renderEditor("layouts");
    const items = await openMenu();
    const del = items.find(item => item.dataset.action === "delete");
    expect(del).toHaveAttribute("aria-disabled", "true");
    expect(del).toHaveTextContent(LOADING);
    expect(error).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Remove layout" })).toBeNull();
    await userEvent.setup().keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryAllByRole("menuitem")).toHaveLength(0)
    );

    // Registered: the plugin's row is offered, and opens its dialog.
    act(() => {
      registerComponent(COLD_REMOVE, RemoveLayoutDialog as never);
    });
    const ready = (await openMenu()).find(
      item => item.dataset.action === "delete"
    );
    expect(ready).not.toHaveAttribute("aria-disabled", "true");
    await userEvent.setup().click(ready!);
    expect(
      await screen.findByRole("dialog", { name: "Remove layout" })
    ).toBeInTheDocument();
    expect(error).not.toHaveBeenCalled();
  });
});

describe("before the admin knows what plugins change", () => {
  // Until the plugin list has arrived, no collection's document can say
  // whether a plugin hides or replaces its Delete or Unpublish, so neither may
  // run its built-in write in the meantime.
  const PENDING = "Loading this collection's plugin actions…";
  /** What a held row says once the list failed, naming the row's action. */
  const failed = (action: string) =>
    `Couldn't load this collection's plugin actions, so ${action} is paused.`;

  /** The editor, with a way to draw it again once the status has moved. */
  function renderHeld() {
    // A new element each time: React skips drawing the same one again.
    const element = () => (
      <EntryForm
        collection={collectionNamed("layouts")}
        entry={entry}
        mode="edit"
        onViewApi={() => {}}
      />
    );
    const view = render(element(), { wrapper: Providers });
    return () => view.rerender(element());
  }

  /** The menu has gone, so the next one opened is read afresh. */
  const menuClosed = () =>
    waitFor(() => expect(screen.queryAllByRole("menuitem")).toHaveLength(0));

  const row = (items: HTMLElement[], id: string) =>
    items.find(item => item.dataset.action === id);

  it("holds Delete and Unpublish while the plugin list loads, and says so", async () => {
    plugins.current = [];
    brandingStatus.current = { ...SETTLED, isPending: true };
    renderHeld();
    const items = await openMenu();
    for (const id of ["delete", "unpublish"]) {
      expect(row(items, id), id).toHaveAttribute("aria-disabled", "true");
      expect(row(items, id)).toHaveTextContent(PENDING);
    }
    // Nothing to retry while it is still on its way.
    expect(screen.queryByRole("menuitem", { name: "Retry" })).toBeNull();
    // What no plugin may override stays usable.
    expect(row(items, "view-api")).not.toHaveAttribute("aria-disabled", "true");
    expect(deleteEntry).not.toHaveBeenCalled();
  });

  it("says the plugin list failed, and offers Retry beside the held rows", async () => {
    plugins.current = [];
    brandingStatus.current = { ...SETTLED, isUnavailable: true };
    renderHeld();
    const items = await openMenu();
    for (const [id, label] of [
      ["delete", "Delete"],
      ["unpublish", "Unpublish"],
    ] as const) {
      expect(row(items, id), id).toHaveAttribute("aria-disabled", "true");
      expect(row(items, id)).toHaveTextContent(failed(label));
    }
    // One Retry directly under each held row.
    const retries = screen.getAllByRole("menuitem", { name: "Retry" });
    expect(retries).toHaveLength(2);
    for (const id of ["delete", "unpublish"]) {
      const next = row(items, id)?.nextElementSibling;
      expect(next, id).toHaveAttribute("data-retry-for", id);
      expect(next).toHaveTextContent("Retry");
    }
    for (const retry of retries) {
      expect(retry).not.toHaveAttribute("aria-disabled", "true");
    }
  });

  it("asks for the plugin list again on Retry, loads while it does, and then applies the plugin's override", async () => {
    plugins.current = [];
    brandingStatus.current = { ...SETTLED, isUnavailable: true };
    const drawAgain = renderHeld();
    await openMenu();
    await userEvent
      .setup()
      .click(screen.getAllByRole("menuitem", { name: "Retry" })[0]!);
    expect(retryBranding).toHaveBeenCalledTimes(1);
    await menuClosed();

    // Asking again: the list reads as pending again, as on first load, so
    // the rows say it is loading, not that it failed.
    brandingStatus.current = { ...SETTLED, isPending: true };
    drawAgain();
    let items = await openMenu();
    expect(row(items, "delete")).toHaveTextContent(PENDING);
    expect(screen.queryByRole("menuitem", { name: "Retry" })).toBeNull();
    await userEvent.setup().keyboard("{Escape}");
    await menuClosed();

    // The list arrived: the plugin's own override is what the menu offers.
    plugins.current = [LAYOUTS_PLUGIN];
    brandingStatus.current = SETTLED;
    drawAgain();
    items = await openMenu();
    expect(row(items, "delete")).toHaveTextContent("Remove layout…");
    expect(row(items, "delete")).not.toHaveAttribute("aria-disabled", "true");
    expect(row(items, "unpublish")).toBeUndefined();
  });

  it("reaches Retry from the keyboard", async () => {
    plugins.current = [];
    brandingStatus.current = { ...SETTLED, isUnavailable: true };
    renderHeld();
    const user = userEvent.setup();
    const bar = await screen.findByTestId("document-bar");
    within(bar).getByRole("button", { name: "More actions" }).focus();
    await user.keyboard("{Enter}");
    await screen.findAllByRole("menuitem");
    // Arrow keys walk the menu's usable rows; the held ones are skipped.
    for (let step = 0; step < 6; step += 1) {
      if (document.activeElement?.textContent === "Retry") break;
      await user.keyboard("{ArrowDown}");
    }
    expect(document.activeElement).toHaveTextContent("Retry");
    await user.keyboard("{Enter}");
    expect(retryBranding).toHaveBeenCalledTimes(1);
  });
});

describe("a plugin's document panel section", () => {
  it("is drawn after Details on its collection only", async () => {
    renderEditor("layouts");
    const panel = await screen.findByRole("complementary", {
      name: "Document panel",
    });
    const titles = within(panel)
      .getAllByRole("region")
      .map(region => region.getAttribute("data-panel-section"));
    expect(titles.at(-1)).toBe("Used by");
    expect(titles.at(-2)).toBe("Details");
    expect(within(panel).getByText("Used by 2 pages")).toBeVisible();
    expect(section.current).toMatchObject({
      collectionSlug: "layouts",
      entryId: "l1",
      documentLock: { readOnly: false, actionsDisabled: false },
    });
  });

  it("is not drawn on another collection's document", async () => {
    renderEditor("posts");
    const panel = await screen.findByRole("complementary", {
      name: "Document panel",
    });
    expect(within(panel).queryByRole("region", { name: "Used by" })).toBeNull();
  });

  it("tells the section a colleague's claim holds the document", async () => {
    useDocumentLock.mockReturnValue({
      state: {
        status: "held-by-other",
        holder: { userId: "u2", name: "Ada", email: "ada@example.com" },
      },
      takeOver: vi.fn(),
      requestAccess: vi.fn(),
    });
    renderEditor("layouts");
    await screen.findByText("Used by 2 pages");
    expect(section.current?.documentLock).toEqual({
      readOnly: true,
      actionsDisabled: true,
    });
  });

  it("leaves the document when the section says it deleted it", async () => {
    const onDelete = renderEditor("layouts");
    await screen.findByText("Used by 2 pages");

    act(() => section.current!.documentChanged("deleted"));

    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("reads the document again when the section says it changed it", async () => {
    const onDelete = renderEditor("layouts");
    await screen.findByText("Used by 2 pages");
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    act(() => section.current!.documentChanged("changed"));

    expect(onDelete).not.toHaveBeenCalled();
    // What an update refreshes: the entry, its collection's lists and the
    // dashboard, so a title the plugin changed is not shown stale anywhere.
    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([
        ["entries", "detail", "layouts", "l1"],
        ["entries", "list", "layouts"],
        ["dashboard"],
      ])
    );
  });

  it("refreshes what a deletion refreshes when the section deleted it", async () => {
    renderEditor("layouts");
    await screen.findByText("Used by 2 pages");
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const remove = vi.spyOn(queryClient, "removeQueries");

    act(() => section.current!.documentChanged("deleted"));

    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([
        ["entries", "list", "layouts"],
        ["entries", "count"],
        ["dashboard"],
      ])
    );
    expect(remove).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["entries", "detail", "layouts", "l1"],
      })
    );
  });
});
