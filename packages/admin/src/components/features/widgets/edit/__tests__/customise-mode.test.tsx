/**
 * Customise mode as a whole: its bar, what it keeps from the server until Save,
 * where focus goes, what it says, the cards it puts out of reach, and what
 * happens when the reader tries to leave with unsaved changes.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { protectedApi } from "@admin/lib/api/protectedApi";
import { registerCoreComponent } from "@admin/lib/plugins/component-registry-internal";
import type { AdminBranding } from "@admin/types/branding";
import type {
  DashboardLayoutResponse,
  WidgetPlacement,
  WidgetLayoutFacts,
} from "@admin/types/dashboard/widgets";

import {
  TopBarPlacesProvider,
  TopBarPlaceTarget,
} from "@admin/components/layout/header/TopBarPlaces";

import { GreetingActionProvider } from "../../../dashboard/GreetingAction";
import { WelcomeHeader } from "../../../dashboard/WelcomeHeader";
import { WidgetGrid } from "../../WidgetGrid";
import { preloadWidgetSettingsSheet } from "../settings-sheet-code";
import {
  stubDashboardWidth,
  unstubDashboardWidth,
} from "../../__tests__/dashboard-width";

import { galleryFromLayout, isGalleryPath } from "./gallery-read";

let mockBranding: AdminBranding | undefined;
let layoutResponse: DashboardLayoutResponse | undefined;

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => mockBranding,
  useAppName: () => "Acme Site",
  useBrandingStatus: () => ({
    isPending: false,
    isUnavailable: false,
    isBrandingUnavailable: false,
  }),
}));
vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: () => ({ hasPermission: () => true }),
}));
vi.mock("@admin/hooks/useDashboardUser", () => ({
  useDashboardUser: () => ({
    user: { id: "u1", name: "Dev User", email: "dev@example.com" },
    isLoading: false,
    error: null,
  }),
}));
vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));
// The batch answered as the `protectedApi.post` mock above describes it; see `batch-over-post`.
vi.mock("@admin/hooks/queries/widget-query-stream", async () =>
  (
    await import("@admin/hooks/queries/__tests__/batch-over-post")
  ).streamOverPost()
);

const api = vi.mocked(protectedApi);

/** A card body with a link and a button of its own: what customising fences off. */
function LinkedBody() {
  return (
    <div>
      <a href="/admin/collections/posts">View posts</a>
      <button type="button">Refresh posts</button>
    </div>
  );
}

/** The same, for a widget that draws its own section rather than a card. */
function LinkedSection() {
  return (
    <section>
      <a href="/admin/singles/home">Open the home page</a>
    </section>
  );
}

/** A third body, so each card's content can be told apart by its link. */
function NotesBody() {
  return <a href="/admin/collections/notes">View notes</a>;
}

registerCoreComponent("core#LinkedBody", LinkedBody);
registerCoreComponent("core#LinkedSection", LinkedSection);
registerCoreComponent("core#NotesBody", NotesBody);

/** Full width three rows high by default, and resizable from 3 by 2 up to 12 by 6. */
const RESIZABLE = {
  default: { w: 12, h: 3 },
  min: { w: 3, h: 2 },
  max: { w: 12, h: 6 },
};

/**
 * Four widgets: a framed card, an unframed section, a card with a setting, and
 * one the reader has not placed.
 */
function branding(): AdminBranding {
  return {
    widgets: [
      {
        id: "core/a",
        title: "Posts",
        archetype: "custom",
        size: RESIZABLE,
        component: "core#LinkedBody",
      },
      {
        id: "core/b",
        title: "Home page",
        archetype: "custom",
        size: RESIZABLE,
        component: "core#LinkedSection",
      },
      {
        id: "core/c",
        title: "Notes",
        archetype: "custom",
        size: RESIZABLE,
        component: "core#NotesBody",
        settings: [{ name: "heading", type: "text", label: "Heading" }],
      },
      {
        id: "core/d",
        title: "Team",
        archetype: "custom",
        size: RESIZABLE,
        component: "core#LinkedBody",
      },
    ],
  } as unknown as AdminBranding;
}

/** One card, which a dashboard holds once. */
function facts(): WidgetLayoutFacts {
  return { allowsSeveral: false };
}

const OPENED: WidgetPlacement[] = [
  { id: "p1", widgetId: "core/a", w: 12, h: 3, removed: false },
  { id: "p2", widgetId: "core/b", w: 12, h: 3, removed: false },
  { id: "p3", widgetId: "core/c", w: 12, h: 3, removed: false },
];

function layout(
  patch: Partial<DashboardLayoutResponse> = {}
): DashboardLayoutResponse {
  return {
    placements: OPENED.map(p => ({ ...p })),
    widgets: {
      "core/a": facts(),
      "core/b": facts(),
      "core/c": facts(),
      "core/d": facts(),
    },
    available: ["core/d"],
    defaultPlacements: [
      { id: "core/c", widgetId: "core/c", w: 6, h: 3, removed: false },
      { id: "core/a", widgetId: "core/a", w: 6, h: 3, removed: false },
    ],
    version: 3,
    source: "own",
    // A row of dismissals at most: the reader still follows the default.
    arranged: false,
    scope: "tok",
    audience: "aud",
    ...patch,
  };
}

/** The dashboard's address, and the page a reader came to it from. */
const DASHBOARD = "/admin";
const CAME_FROM = "/admin/collections/posts";
const ELSEWHERE = "/admin/media";

/**
 * The dashboard as the page composes it. `inBar` draws it under the admin's
 * top bar, whose two places the page fills; without it there is no bar, and
 * the controls are drawn where they stand.
 */
function renderDashboard({ inBar = false }: { inBar?: boolean } = {}) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, gcTime: 0 },
      mutations: { retry: 2, retryDelay: 0 },
    },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  // The page's heading beside the grid, so the outline is the page's.
  const page = (
    <>
      <WelcomeHeader />
      <WidgetGrid />
    </>
  );
  return render(
    inBar ? (
      <TopBarPlacesProvider>
        <header data-testid="top-bar">
          <TopBarPlaceTarget name="start" />
          <TopBarPlaceTarget name="end" />
        </header>
        <main>
          <GreetingActionProvider>{page}</GreetingActionProvider>
        </main>
      </TopBarPlacesProvider>
    ) : (
      page
    ),
    { wrapper: Wrapper }
  );
}

// The settings sheet's code loads apart from the dashboard's, ahead of its opening, as a pointer
// over the card's menu fetches it. Fetched once here, so a test opening the sheet waits on the
// sheet rather than on the first transform of the editor's field renderer behind it.
beforeAll(async () => {
  preloadWidgetSettingsSheet();
  await import("../CellSettings");
});

beforeEach(() => {
  // jsdom lays nothing out; the grid asks nothing until its dashboard has a width.
  stubDashboardWidth();
  vi.clearAllMocks();
  mockBranding = branding();
  layoutResponse = layout();
  api.get.mockImplementation((path: string) =>
    // The gallery read the layout fixture implies, read when the add panel opens.
    Promise.resolve(
      isGalleryPath(path) && layoutResponse !== undefined
        ? galleryFromLayout(layoutResponse, mockBranding?.widgets ?? [])
        : layoutResponse
    )
  );
  api.put.mockResolvedValue({ message: "ok", item: {} });
  api.delete.mockResolvedValue({ message: "ok" });
  // Every card is asked for by its id; each is answered, so its component draws.
  api.post.mockImplementation((_path: string, body: unknown) =>
    Promise.resolve({
      results: (body as { queries: unknown[] }).queries.map(() => ({
        ok: true,
        result: { op: "data", data: null },
      })),
    })
  );
  // A history the reader can go Back through: they came to the dashboard
  // from another admin page.
  window.history.pushState(null, "", CAME_FROM);
  window.history.pushState(null, "", DASHBOARD);
});

afterEach(() => {
  unstubDashboardWidth();
  vi.useRealTimers();
});

type User = ReturnType<typeof userEvent.setup>;

/** Enters customise mode and waits for the per-card menus to exist. */
async function beginEditing(): Promise<User> {
  const user = userEvent.setup();
  await user.click(await screen.findByTestId("dashboard-edit-begin"));
  await screen.findAllByTestId("card-actions");
  return user;
}

function bar(): HTMLElement {
  return screen.getByRole("group", { name: "Customize dashboard" });
}

/**
 * Leaves customise mode from the bar's Cancel, agreeing to discard when the
 * mode asks first (it asks only while there are unsaved changes).
 */
async function cancelEditing(user: User): Promise<void> {
  await user.click(within(bar()).getByRole("button", { name: "Cancel" }));
  const ask = screen.queryByTestId("dashboard-leave-ask");
  if (ask !== null) {
    await user.click(
      within(ask).getByRole("button", { name: "Discard changes" })
    );
  }
  await screen.findByTestId("dashboard-edit-begin");
}

function drawnOrder(): string[] {
  return screen
    .queryAllByTestId(/^widget-cell-/)
    .map(node => node.getAttribute("data-testid")?.replace("widget-cell-", ""))
    .filter((id): id is string => id !== undefined);
}

function sizeLabels(): string[] {
  return screen
    .queryAllByTestId("card-size-label")
    .map(label => label.textContent ?? "");
}

function live(): HTMLElement {
  return screen.getByTestId("widget-grid-live");
}

/**
 * Every write the dashboard can make. The cards' batch is a POST that only reads, so it is not
 * one: every card asks it, and customising asks again with the settings each is drawn with.
 */
function writes(): number {
  return (
    api.put.mock.calls.length +
    api.post.mock.calls.filter(([path]) => path !== "/dashboard/query").length +
    api.delete.mock.calls.length
  );
}

async function choose(user: User, title: string, item: string) {
  await user.click(
    screen.getByRole("button", { name: `Card actions for ${title}` })
  );
  const menu = await screen.findByRole("menu");
  await user.click(within(menu).getByRole("menuitem", { name: item }));
}

async function confirmReset(user: User) {
  await user.click(within(bar()).getByRole("button", { name: /^Reset/ }));
  await user.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", {
      name: "Reset dashboard",
    })
  );
}

function saveButton(): HTMLElement {
  return within(bar()).getByRole("button", { name: "Save" });
}

/** Opens a card's settings drawer from its menu, once its form has loaded. */
async function openDrawer(user: User, title: string): Promise<HTMLElement> {
  await choose(user, title, "Settings…");
  // The drawer opens at once and says it is loading until its code arrives, so wait for its
  // Width before reading it.
  await screen.findByRole("radiogroup", { name: "Width" });
  return screen.getByRole("dialog", { name: title });
}

/** One change of each kind customise mode can make. */
const CHANGES: Array<[string, (user: User) => Promise<void>]> = [
  ["a move", user => choose(user, "Posts", "Move later")],
  [
    "a resize",
    async user => {
      // The drawer's Width, staged with the rest on its Save.
      const drawer = await openDrawer(user, "Posts");
      await user.click(
        within(drawer).getByRole("radio", { name: "50% width" })
      );
      await user.click(within(drawer).getByRole("button", { name: "Save" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    },
  ],
  ["a removal", user => choose(user, "Posts", "Remove")],
  [
    "an addition",
    async user => {
      // From the add panel, then closed, as a reader leaves it before Save or Cancel.
      await user.click(
        within(bar()).getByRole("button", { name: "Add widget" })
      );
      await user.click(await screen.findByRole("button", { name: "Add Team" }));
      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    },
  ],
  ["a reset", user => confirmReset(user)],
  [
    "a setting",
    async user => {
      const sheet = await openDrawer(user, "Notes");
      await user.type(within(sheet).getByLabelText(/Heading/), "Mine");
      await user.click(within(sheet).getByRole("button", { name: "Save" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    },
  ],
];

describe("customise mode writes nothing before Save", () => {
  it.each(CHANGES)(
    "after %s, sends nothing until Save, then one write",
    async (_kind, change) => {
      renderDashboard();
      const user = await beginEditing();
      // The layout's reads: opening the add panel reads the gallery, which is no re-read.
      const layoutReads = () =>
        api.get.mock.calls.filter(([path]) => !isGalleryPath(String(path)))
          .length;
      const reads = layoutReads();

      await change(user);

      expect(writes()).toBe(0);
      expect(layoutReads()).toBe(reads);
      await user.click(saveButton());
      await waitFor(() => expect(writes()).toBe(1));
    }
  );

  it.each(CHANGES)(
    "after %s, Cancel restores the dashboard as it was opened, writing nothing",
    async (_kind, change) => {
      renderDashboard();
      const user = await beginEditing();
      const order = drawnOrder();
      const sizes = sizeLabels();

      await change(user);
      await cancelEditing(user);

      expect(drawnOrder()).toEqual(order);
      expect(writes()).toBe(0);
      // Back in customise mode, the sizes are the ones it opened with.
      await beginEditing();
      expect(sizeLabels()).toEqual(sizes);
    }
  );
});

describe("the card menu and the settings drawer while customising", () => {
  it("lists Settings…, Refresh, Move earlier, Move later and Remove, and no size", async () => {
    renderDashboard();
    const user = await beginEditing();
    await user.click(
      screen.getByRole("button", { name: "Card actions for Notes" })
    );
    const menu = await screen.findByRole("menu");
    const names = within(menu)
      .getAllByRole("menuitem")
      .map(item => item.textContent?.trim() ?? "");
    // Refresh is offered where the card has data to ask again for.
    expect(names.filter(name => name !== "Refresh")).toEqual([
      "Settings…",
      "Move earlier",
      "Move later",
      "Remove",
    ]);
    expect(within(menu).queryByText(/Width|Height/)).toBeNull();
  });

  it("leaves the card as it was until the drawer's Save, then stages it until the bar's Save", async () => {
    renderDashboard();
    const user = await beginEditing();
    const before = sizeLabels();
    const drawer = await openDrawer(user, "Notes");
    await user.click(within(drawer).getByRole("radio", { name: "50% width" }));
    // The preview follows at once; the card itself does not.
    expect(
      within(drawer).getByTestId("settings-preview-width")
    ).toHaveTextContent("At 50% of the dashboard");
    expect(sizeLabels()).toEqual(before);

    await user.click(within(drawer).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // Staged in the draft, drawn at once, and nothing written until the bar's Save.
    expect(sizeLabels()).toContain("50%50% wide");
    expect(writes()).toBe(0);
    await user.click(saveButton());
    await waitFor(() => expect(writes()).toBe(1));
  });

  it("discards the drawer's change on Cancel and on Escape, the card untouched", async () => {
    renderDashboard();
    const user = await beginEditing();
    const before = sizeLabels();
    for (const close of ["Cancel", "{Escape}"]) {
      const drawer = await openDrawer(user, "Notes");
      await user.click(
        within(drawer).getByRole("radio", { name: "50% width" })
      );
      await user.type(within(drawer).getByLabelText(/Heading/), "Mine");
      if (close === "Cancel") {
        await user.click(
          within(drawer).getByRole("button", { name: "Cancel" })
        );
      } else {
        await user.keyboard(close);
      }
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(sizeLabels()).toEqual(before);
    }
    // Opened again, it holds what is stored, not what was discarded.
    const drawer = await openDrawer(user, "Notes");
    expect(within(drawer).getByLabelText(/Heading/)).toHaveValue("");
    expect(
      within(drawer).getByRole("radio", { name: "100% width" })
    ).toHaveAttribute("aria-checked", "true");
    expect(writes()).toBe(0);
  });
});

describe("the bar", () => {
  it("is a labelled group of Reset, Add widget, Cancel and Save, in place of the cog", async () => {
    renderDashboard();
    await beginEditing();

    expect(
      within(bar())
        .getAllByRole("button")
        .map(button => button.textContent)
    ).toEqual(["Reset", "Add widget", "Cancel", "Save"]);
    expect(
      within(bar()).getByRole("button", { name: "Reset to default" })
    ).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-edit-begin")).toBeNull();
    // No way to the widget previews page, in development as anywhere.
    expect(screen.queryByText("Preview widgets")).toBeNull();
  });

  it("on a phone's bar, hides Reset and draws Add widget as its icon, keeping its name", async () => {
    // jsdom lays nothing out; the bar's own width decides, through its container query.
    renderDashboard();
    await beginEditing();
    expect(within(bar()).getByTestId("dashboard-edit-reset")).toHaveClass(
      "@max-[37.5rem]/topbar:hidden"
    );
    const add = within(bar()).getByRole("button", { name: "Add widget" });
    expect(add).toHaveClass("@max-[37.5rem]/topbar:size-[34px]");
    expect(within(add).getByText("Add widget")).toHaveClass(
      "@max-[37.5rem]/topbar:sr-only"
    );
    for (const name of ["Cancel", "Save"]) {
      expect(
        within(bar()).getByRole("button", { name }).className
      ).not.toContain("@max-[37.5rem]/topbar:");
    }
  });

  it("draws rows as tall as their cards at rest and while customising, no cell spanning rows or clipping its card", async () => {
    // 🔴 Fails with fixed rows while customising, where a card is drawn at its stored rows rather
    // than its content's height, and so at another height than at rest.
    const drawnAsTallAsTheirCards = () => {
      const grid = screen.getByLabelText("Dashboard widgets");
      expect(grid).toHaveClass("auto-rows-auto");
      expect(grid).not.toHaveClass("auto-rows-[72px]");
      const cell = screen.getByTestId("widget-cell-core/a");
      expect(cell.style.gridRow).toBe("");
      expect(cell).not.toHaveClass("overflow-hidden");
      expect(cell).not.toHaveClass("contain-size");
    };
    renderDashboard();
    await screen.findByTestId("widget-cell-core/a");
    drawnAsTallAsTheirCards();
    await beginEditing();
    drawnAsTallAsTheirCards();
  });

  it("keeps exactly one level-one heading, the greeting", async () => {
    renderDashboard();
    await beginEditing();
    const mains = screen.getAllByRole("heading", { level: 1 });
    expect(mains).toHaveLength(1);
    expect(mains[0]).toHaveAttribute("id", "dashboard-heading");
  });

  it("offers Save only while there are unsaved changes", async () => {
    renderDashboard();
    const user = await beginEditing();
    expect(saveButton()).toBeDisabled();

    await choose(user, "Posts", "Move later");
    expect(saveButton()).toBeEnabled();

    await choose(user, "Posts", "Move earlier");
    expect(saveButton()).toBeDisabled();
  });

  it("Add widget opens the add panel, with focus in its search", async () => {
    renderDashboard();
    const user = await beginEditing();
    const add = within(bar()).getByRole("button", { name: "Add widget" });
    expect(add).toHaveAttribute("aria-haspopup", "dialog");
    await user.click(add);
    expect(
      await screen.findByRole("dialog", { name: "Add widget" })
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("add-panel-search")).toHaveFocus()
    );
  });

  it("shows a failed save above the cards, with Try again", async () => {
    api.put.mockRejectedValueOnce(new Error("network"));
    renderDashboard();
    const user = await beginEditing();
    await choose(user, "Posts", "Move later");
    await user.click(saveButton());

    const error = await screen.findByTestId("dashboard-edit-error");
    expect(
      error.compareDocumentPosition(
        screen.getByLabelText("Dashboard widgets")
      ) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    await user.click(within(error).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(2));
  });

  it("shows a refused save above the cards, with Reload", async () => {
    api.put.mockRejectedValue(
      Object.assign(new Error("changed"), { status: 409 })
    );
    renderDashboard();
    const user = await beginEditing();
    await choose(user, "Posts", "Move later");
    await user.click(saveButton());

    const conflict = await screen.findByTestId("dashboard-edit-conflict");
    expect(
      within(conflict).getByRole("button", { name: "Reload" })
    ).toBeInTheDocument();
  });
});

describe("in the admin's top bar", () => {
  function topBar(): HTMLElement {
    return screen.getByTestId("top-bar");
  }

  it("holds the breadcrumb at rest, and the cog at the greeting row's end rather than in the bar", async () => {
    renderDashboard({ inBar: true });
    const cog = await screen.findByTestId("dashboard-edit-begin");
    const row = screen.getByTestId("dashboard-greeting-row");
    expect(row).toContainElement(cog);
    // After the greeting, so it reads and tabs after the heading it sits beside.
    expect(row.lastElementChild).toContainElement(cog);
    expect(topBar()).not.toContainElement(cog);
    expect(
      within(topBar()).getByRole("navigation", { name: "Breadcrumb" })
    ).toHaveTextContent(/^Dashboard$/);
  });

  it("the cog is named and tooltipped Customize dashboard", async () => {
    renderDashboard({ inBar: true });
    const user = userEvent.setup();
    const cog = await screen.findByTestId("dashboard-edit-begin");
    expect(cog).toHaveAccessibleName("Customize dashboard");
    await user.hover(cog);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Customize dashboard"
    );
  });

  it.each(["{Enter}", " "])(
    "the cog is reached by Tab and opens customise mode on %s",
    async key => {
      renderDashboard({ inBar: true });
      const user = userEvent.setup();
      const cog = await screen.findByTestId("dashboard-edit-begin");
      while (document.activeElement !== cog) {
        await user.tab();
        expect(document.activeElement).not.toBe(document.body);
      }
      await user.keyboard(key);
      await waitFor(() => expect(bar()).toHaveFocus());
      expect(topBar()).toContainElement(bar());
    }
  );

  it("puts the mode's controls in the bar, the cog leaves the greeting row, and the breadcrumb says Customizing", async () => {
    renderDashboard({ inBar: true });
    await beginEditing();
    expect(topBar()).toContainElement(bar());
    expect(screen.queryByTestId("dashboard-edit-begin")).toBeNull();
    expect(screen.getByTestId("dashboard-greeting-row")).not.toContainElement(
      bar()
    );
    const crumb = within(topBar()).getByRole("navigation", {
      name: "Breadcrumb",
    });
    expect(crumb).toHaveTextContent("Dashboard");
    expect(crumb).toHaveTextContent("Customizing");
  });

  it("the breadcrumb's Dashboard leaves at once with nothing changed", async () => {
    renderDashboard({ inBar: true });
    const user = await beginEditing();
    await user.click(
      within(topBar()).getByRole("button", { name: "Dashboard" })
    );
    expect(screen.queryByTestId("dashboard-leave-ask")).toBeNull();
    expect(await screen.findByTestId("dashboard-edit-begin")).toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 })).toHaveFocus()
    );
  });

  it("the breadcrumb's Dashboard asks first with unsaved changes, as Cancel does", async () => {
    renderDashboard({ inBar: true });
    const user = await beginEditing();
    const order = drawnOrder();
    await choose(user, "Posts", "Move later");
    await user.click(
      within(topBar()).getByRole("button", { name: "Dashboard" })
    );
    const ask = await screen.findByTestId("dashboard-leave-ask");
    await user.click(within(ask).getByRole("button", { name: "Keep editing" }));
    expect(bar()).toBeInTheDocument();

    await user.click(
      within(topBar()).getByRole("button", { name: "Dashboard" })
    );
    await user.click(
      within(await screen.findByTestId("dashboard-leave-ask")).getByRole(
        "button",
        { name: "Discard changes" }
      )
    );
    await screen.findByTestId("dashboard-edit-begin");
    expect(drawnOrder()).toEqual(order);
    expect(writes()).toBe(0);
  });

  it("offers no way out through the breadcrumb while a save is on its way, as Cancel offers none", async () => {
    let land: (value: unknown) => void = () => undefined;
    api.put.mockReturnValue(
      new Promise(resolve => {
        land = resolve;
      })
    );
    renderDashboard({ inBar: true });
    const user = await beginEditing();
    await choose(user, "Posts", "Move later");
    expect(
      within(topBar()).getByRole("button", { name: "Dashboard" })
    ).toBeInTheDocument();
    await user.click(saveButton());

    await waitFor(() =>
      expect(
        within(bar()).getByRole("button", { name: "Cancel" })
      ).toBeDisabled()
    );
    expect(
      within(topBar()).queryByRole("button", { name: "Dashboard" })
    ).toBeNull();
    expect(
      within(topBar()).getByRole("navigation", { name: "Breadcrumb" })
    ).toHaveTextContent("Customizing");

    // The save then lands, and with it the mode ends as a save does.
    land({ message: "ok", item: {} });
    expect(await screen.findByTestId("dashboard-edit-begin")).toBeVisible();
    expect(screen.queryByTestId("dashboard-leave-ask")).toBeNull();
  });

  it.each([true, false])(
    "offers no Preview widgets, with the development server's previews %s",
    async widgetPreviews => {
      mockBranding = { ...branding(), widgetPreviews };
      renderDashboard({ inBar: true });
      await screen.findByTestId("dashboard-edit-begin");
      expect(screen.queryByText("Preview widgets")).toBeNull();
      await beginEditing();
      expect(screen.queryByText("Preview widgets")).toBeNull();
      expect(screen.queryByRole("link", { name: /preview/i })).toBeNull();
    }
  );
});

describe("leaving customise mode", () => {
  it("Cancel with nothing changed leaves at once", async () => {
    renderDashboard();
    const user = await beginEditing();
    await user.click(within(bar()).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("dashboard-leave-ask")).toBeNull();
    expect(await screen.findByTestId("dashboard-edit-begin")).toBeVisible();
  });

  it("Cancel with unsaved changes asks first; Keep editing stays, with the changes", async () => {
    renderDashboard();
    const user = await beginEditing();
    await choose(user, "Posts", "Move later");
    const order = drawnOrder();
    await user.click(within(bar()).getByRole("button", { name: "Cancel" }));

    const ask = await screen.findByTestId("dashboard-leave-ask");
    expect(ask).toHaveTextContent("Discard your changes?");
    await user.click(within(ask).getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByTestId("dashboard-leave-ask")).toBeNull();
    expect(bar()).toBeInTheDocument();
    expect(drawnOrder()).toEqual(order);
    expect(saveButton()).toBeEnabled();
  });

  it("Cancel with unsaved changes discards them once the reader agrees", async () => {
    renderDashboard();
    const user = await beginEditing();
    const order = drawnOrder();
    await choose(user, "Posts", "Move later");
    await user.click(within(bar()).getByRole("button", { name: "Cancel" }));
    await user.click(
      within(await screen.findByTestId("dashboard-leave-ask")).getByRole(
        "button",
        { name: "Discard changes" }
      )
    );
    await screen.findByTestId("dashboard-edit-begin");
    expect(drawnOrder()).toEqual(order);
    expect(writes()).toBe(0);
  });
});

describe("focus", () => {
  it("moves to the bar on entering customise mode", async () => {
    renderDashboard();
    await beginEditing();
    await waitFor(() => expect(bar()).toHaveFocus());
  });

  it("moves to the greeting after Cancel", async () => {
    renderDashboard();
    const user = await beginEditing();
    await cancelEditing(user);
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 })).toHaveFocus()
    );
  });

  it("moves to the greeting after discarding changes, not back to the question's Cancel", async () => {
    renderDashboard();
    const user = await beginEditing();
    await choose(user, "Posts", "Move later");
    await cancelEditing(user);
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 })).toHaveFocus()
    );
  });

  it("moves to the greeting once a save has landed", async () => {
    renderDashboard();
    const user = await beginEditing();
    await choose(user, "Posts", "Move later");
    await user.click(saveButton());
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 })).toHaveFocus()
    );
  });
});

describe("the cards' own content while customising", () => {
  // Every card is framed: it keeps its title and border, and dims its body
  // and footer, which are out of reach.
  for (const [kind, title, link] of [
    ["a framed card", "Posts", "View posts"],
  ] as const) {
    it(`puts ${kind}'s own links and controls out of reach, and dims them`, async () => {
      renderDashboard();
      await beginEditing();

      const content = screen.getByRole("link", { name: link, hidden: true });
      expect(content.closest("[inert]")).not.toBeNull();
      // The card's own body dims, once: the fence adds no dim of its own.
      const body = content.closest("[data-slot=card-content]");
      expect(body).toHaveClass("opacity-55");
      expect(body?.closest(".opacity-60")).toBeNull();
      // The edit controls are NOT fenced: they are what customising is for.
      expect(
        screen
          .getByRole("button", { name: `Card actions for ${title}` })
          .closest("[inert]")
      ).toBeNull();
      expect(
        screen.getByRole("button", { name: `Move ${title}` }).closest("[inert]")
      ).toBeNull();
    });

    it(`gives ${kind}'s content back once customising ends`, async () => {
      renderDashboard();
      const user = await beginEditing();
      await cancelEditing(user);
      expect(
        screen.getByRole("link", { name: link }).closest("[inert]")
      ).toBeNull();
    });
  }
});

describe("what customise mode says, through the grid's one live region", () => {
  it("says what entering means", async () => {
    renderDashboard();
    await beginEditing();
    expect(live()).toHaveTextContent(
      "Customizing your dashboard. Nothing is saved until you press Save."
    );
  });

  it("says Cancel discarded the changes", async () => {
    renderDashboard();
    const user = await beginEditing();
    await choose(user, "Posts", "Move later");
    await cancelEditing(user);
    expect(live()).toHaveTextContent("Changes discarded.");
  });

  it("says a save landed", async () => {
    renderDashboard();
    const user = await beginEditing();
    await choose(user, "Posts", "Move later");
    await user.click(saveButton());
    await waitFor(() => expect(live()).toHaveTextContent("Dashboard saved."));
  });

  it("says a refused save wrote nothing", async () => {
    api.put.mockRejectedValue(
      Object.assign(new Error("changed"), { status: 409 })
    );
    renderDashboard();
    const user = await beginEditing();
    await choose(user, "Posts", "Move later");
    await user.click(saveButton());
    await waitFor(() =>
      expect(live()).toHaveTextContent(
        "Your dashboard changed elsewhere, so nothing was saved."
      )
    );
  });

  it("says a failed save kept the changes", async () => {
    api.put.mockRejectedValue(new Error("network"));
    renderDashboard();
    const user = await beginEditing();
    await choose(user, "Posts", "Move later");
    await user.click(saveButton());
    await waitFor(() =>
      expect(live()).toHaveTextContent(
        "Your dashboard could not be saved. Your changes are still here."
      )
    );
  });

  it("says a staged reset, and that it is not saved yet", async () => {
    // The dashboard's first batch answers; a batch after it, for the reset's cards, stays on its
    // way, so the region holds only what the reset said, never that batch's news beside it.
    api.post.mockImplementation((_path: string, body: unknown) =>
      api.post.mock.calls.length > 1
        ? new Promise(() => undefined)
        : Promise.resolve({
            results: (body as { queries: unknown[] }).queries.map(() => ({
              ok: true,
              result: { op: "data", data: null },
            })),
          })
    );
    renderDashboard();
    const user = await beginEditing();
    await confirmReset(user);
    expect(live()).toHaveTextContent(
      "Dashboard reset to the default. Save to keep it."
    );
  });

  it("speaks a failure through that one region and no second one", async () => {
    // A `role="alert"` beside the region would read the same failure twice,
    // assertively, over whatever the region was saying.
    api.put.mockRejectedValue(new Error("network"));
    renderDashboard();
    const user = await beginEditing();
    await choose(user, "Posts", "Move later");
    await user.click(saveButton());
    await screen.findByTestId("dashboard-edit-error");
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    expect(
      bar().querySelectorAll("[aria-live], [role='status'], [role='alert']")
    ).toHaveLength(0);
  });
});

describe("leaving with unsaved changes", () => {
  /** Moves within the admin, the way its router does. */
  function navigate(path: string) {
    act(() => window.history.pushState(null, "", path));
  }

  async function changed(): Promise<User> {
    renderDashboard();
    const user = await beginEditing();
    await choose(user, "Posts", "Move later");
    return user;
  }

  function prompt(): HTMLElement {
    return screen.getByRole("alertdialog");
  }

  it("asks first, with Save, Discard and Keep editing", async () => {
    await changed();
    navigate(ELSEWHERE);

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Unsaved Changes");
    expect(
      within(dialog)
        .getAllByRole("button")
        .map(button => button.textContent)
    ).toEqual(["Discard Changes", "Keep Editing", "Save Changes"]);
    expect(window.location.pathname).toBe(DASHBOARD);
  });

  /** Opens Notes' settings drawer while customising and changes its Heading, keeping it open. */
  async function panelChanged(user: User): Promise<void> {
    const panel = await openDrawer(user, "Notes");
    await user.type(within(panel).getByLabelText(/Heading/), "Mine");
  }

  it("asks once, in the dashboard's own prompt, for a settings panel holding a change", async () => {
    // Nothing else changed: the panel's change alone is what the prompt is for.
    renderDashboard();
    const user = await beginEditing();
    await panelChanged(user);
    navigate(ELSEWHERE);

    await screen.findByRole("alertdialog");
    expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
    expect(window.location.pathname).toBe(DASHBOARD);
  });

  it("asks once when the dashboard and a settings panel both hold changes, and Save leaves", async () => {
    const user = await changed();
    await panelChanged(user);
    navigate(ELSEWHERE);

    const dialog = await screen.findByRole("alertdialog");
    expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
    // The dashboard's prompt, whose Save keeps the arrangement and leaves. A panel asking for
    // itself first would stage its change on Save and leave the dashboard's prompt to ask again.
    await user.click(
      within(dialog).getByRole("button", { name: "Save Changes" })
    );
    await waitFor(() => expect(window.location.pathname).toBe(ELSEWHERE));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  /** The placements the last layout write sent. */
  function sentPlacements(): Array<{
    widgetId: string;
    config?: Record<string, unknown>;
  }> {
    const body = api.put.mock.calls.at(-1)?.[1] as
      | {
          placements?: Array<{
            widgetId: string;
            config?: Record<string, unknown>;
          }>;
        }
      | undefined;
    return body?.placements ?? [];
  }

  it("Save in the prompt keeps a settings panel's change in the arrangement it saves", async () => {
    const user = await changed();
    await panelChanged(user);
    navigate(ELSEWHERE);
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Save Changes" })
    );
    await waitFor(() => expect(window.location.pathname).toBe(ELSEWHERE));
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(
      sentPlacements().find(placement => placement.widgetId === "core/c")
        ?.config
    ).toEqual({ heading: "Mine" });
  });

  it("Save in the prompt stops, saying why in the panel, when the panel's change is refused", async () => {
    const user = await changed();
    await panelChanged(user);
    const panel = screen.getByRole("dialog", { name: "Notes" });
    const title = within(panel).getByLabelText("Title");
    await user.click(title);
    await user.paste("x".repeat(81));
    navigate(ELSEWHERE);
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Save Changes" })
    );
    // Nothing written, still here, and the panel says what to fix, with focus on it.
    expect(
      await within(panel).findByText("A title can be at most 80 characters.")
    ).toBeTruthy();
    await waitFor(() => expect(title).toHaveFocus());
    expect(api.put).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe(DASHBOARD);
  });

  it("the bar's Save keeps a settings panel's change too, as the prompt's does", async () => {
    // One Save: the bar and the prompt treat a panel holding a change alike.
    renderDashboard();
    const user = await beginEditing();
    await panelChanged(user);
    await user.click(saveButton());
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(
      sentPlacements().find(placement => placement.widgetId === "core/c")
        ?.config
    ).toEqual({ heading: "Mine" });
  });

  it("the bar's Save keeps an open drawer's width too, with its settings", async () => {
    // A width chosen in the drawer, left open, and the dashboard saved from the bar.
    renderDashboard();
    const user = await beginEditing();
    const drawer = await openDrawer(user, "Notes");
    await user.click(within(drawer).getByRole("radio", { name: "50% width" }));
    await user.type(within(drawer).getByLabelText(/Heading/), "Mine");
    await user.click(saveButton());
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(
      sentPlacements().find(placement => placement.widgetId === "core/c")
    ).toMatchObject({ w: 6, config: { heading: "Mine" } });
  });

  it("the bar's Save stops, with the panel saying why, when the panel's change is refused", async () => {
    renderDashboard();
    const user = await beginEditing();
    await panelChanged(user);
    const panel = screen.getByRole("dialog", { name: "Notes" });
    const title = within(panel).getByLabelText("Title");
    await user.click(title);
    await user.paste("x".repeat(81));
    await user.click(saveButton());
    expect(
      await within(panel).findByText("A title can be at most 80 characters.")
    ).toBeTruthy();
    await waitFor(() => expect(title).toHaveFocus());
    expect(api.put).not.toHaveBeenCalled();
  });

  it("Discard in the prompt drops the dashboard's changes and the panel's alike", async () => {
    const user = await changed();
    await panelChanged(user);
    navigate(ELSEWHERE);
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Discard Changes" })
    );
    await waitFor(() => expect(window.location.pathname).toBe(ELSEWHERE));
    expect(api.put).not.toHaveBeenCalled();
  });

  it("freezes a settings panel while the dashboard's Save is on its way, so nothing is changed after it was staged", async () => {
    renderDashboard();
    const user = await beginEditing();
    await panelChanged(user);
    const panel = screen.getByRole("dialog", { name: "Notes" });
    // The write is held, so the save is on its way while the panel is checked.
    api.put.mockReturnValue(new Promise(() => {}));
    await user.click(saveButton());
    await waitFor(() =>
      expect(within(panel).getByLabelText(/Heading/)).toBeDisabled()
    );
    // Save says the save is on its way, as it does for the drawer's own.
    expect(
      within(panel).getByRole("button", { name: "Saving…" })
    ).toBeDisabled();
  });

  it("the bar's Cancel discards a settings panel's change too: it closes, and nothing is left to keep", async () => {
    renderDashboard();
    const user = await beginEditing();
    await panelChanged(user);
    await cancelEditing(user);
    // "Changes discarded" is true of the drawer too: it is closed, with no Save to press.
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Notes" })).toBeNull()
    );
    expect(writes()).toBe(0);
    // Opened again, it holds what is stored, not the discarded Heading.
    await user.click(await screen.findByTestId("dashboard-edit-begin"));
    await screen.findAllByTestId("card-actions");
    const panel = await openDrawer(user, "Notes");
    expect(within(panel).getByLabelText(/Heading/)).toHaveValue("");
    expect(writes()).toBe(0);
  });

  it("hands focus to the card's menu at rest when a panel opened while customising closes after the mode ended", async () => {
    renderDashboard();
    const user = await beginEditing();
    const panel = await openDrawer(user, "Notes");
    await user.type(within(panel).getByLabelText(/Heading/), "Mine");
    // Saved, the drawer's change with it: customise mode ends, and the menu the drawer was
    // opened from goes with it, while the drawer stays open.
    await user.click(saveButton());
    await screen.findByTestId("dashboard-edit-begin");
    expect(screen.getByRole("dialog", { name: "Notes" })).toBe(panel);
    await user.click(within(panel).getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Card menu for Notes" })
      ).toHaveFocus()
    );
  });

  it("lets the reader leave without asking when nothing changed", async () => {
    renderDashboard();
    await beginEditing();
    navigate(ELSEWHERE);

    expect(window.location.pathname).toBe(ELSEWHERE);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("Keep Editing stays in customise mode with the changes", async () => {
    const user = await changed();
    navigate(ELSEWHERE);
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Keep Editing",
      })
    );

    expect(window.location.pathname).toBe(DASHBOARD);
    expect(drawnOrder()).toEqual(["core/b", "core/a", "core/c"]);
    expect(screen.getAllByTestId("card-actions")).toHaveLength(3);
  });

  it("Save Changes saves the whole arrangement, then leaves", async () => {
    const user = await changed();
    navigate(ELSEWHERE);
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Save Changes",
      })
    );

    await waitFor(() => expect(window.location.pathname).toBe(ELSEWHERE));
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(
      (
        api.put.mock.calls[0][1] as { placements: WidgetPlacement[] }
      ).placements.map(p => p.id)
    ).toEqual(["p2", "p1", "p3"]);
  });

  it("Save Changes that fails stays in customise mode with every change, and says why", async () => {
    api.put.mockRejectedValue(new Error("network"));
    const user = await changed();
    navigate(ELSEWHERE);
    await user.click(
      within(prompt()).getByRole("button", { name: "Save Changes" })
    );

    expect(await screen.findByTestId("dashboard-edit-error")).toBeVisible();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(window.location.pathname).toBe(DASHBOARD);
    expect(drawnOrder()).toEqual(["core/b", "core/a", "core/c"]);
    expect(screen.getAllByTestId("card-actions")).toHaveLength(3);
  });

  it("Save Changes that conflicts stays in customise mode with every change, and says why", async () => {
    api.put.mockRejectedValue(
      Object.assign(new Error("changed"), { status: 409 })
    );
    const user = await changed();
    navigate(ELSEWHERE);
    await user.click(
      within(prompt()).getByRole("button", { name: "Save Changes" })
    );

    expect(await screen.findByTestId("dashboard-edit-conflict")).toBeVisible();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(window.location.pathname).toBe(DASHBOARD);
    expect(drawnOrder()).toEqual(["core/b", "core/a", "core/c"]);
  });

  it("Discard Changes leaves, writes nothing, and adds nothing to the region", async () => {
    const user = await changed();
    const said = live().textContent;
    navigate(ELSEWHERE);
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Discard Changes",
      })
    );

    expect(window.location.pathname).toBe(ELSEWHERE);
    expect(writes()).toBe(0);
    expect(live().textContent).toBe(said);
  });

  it("Save Changes over an unreadable stored dashboard asks to replace it first, and stays", async () => {
    // The server refuses that save unless the reader confirmed replacing the
    // row it could not read; the prompt is not that confirmation.
    layoutResponse = layout({ source: "unreadable" });
    const user = await changed();
    navigate(ELSEWHERE);
    await user.click(
      within(prompt()).getByRole("button", { name: "Save Changes" })
    );

    expect(
      await screen.findByRole("alertdialog", {
        name: "Replace your saved dashboard?",
      })
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe(DASHBOARD);
    expect(writes()).toBe(0);
  });

  it("still asks while a save is on its way, and keeps the changes if it then fails", async () => {
    // 🔴 The separating case. A save on its way is not yet a save: turning
    // the guard off for it let a leave through, and when the write then
    // failed the draft was already gone with the page.
    let fail: (error: Error) => void = () => undefined;
    api.put.mockReturnValue(
      new Promise((_, reject) => {
        fail = reject;
      })
    );
    const user = await changed();
    await user.click(saveButton());
    await waitFor(() =>
      expect(screen.getByTestId("dashboard-edit-save")).toBeDisabled()
    );

    navigate(ELSEWHERE);
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(window.location.pathname).toBe(DASHBOARD);

    await user.click(
      within(prompt()).getByRole("button", { name: "Keep Editing" })
    );
    fail(new Error("network"));
    expect(await screen.findByTestId("dashboard-edit-error")).toBeVisible();
    expect(window.location.pathname).toBe(DASHBOARD);
    expect(drawnOrder()).toEqual(["core/b", "core/a", "core/c"]);
    expect(saveButton()).toBeEnabled();
  });

  it("Save Changes during a save already on its way waits for it, and writes once", async () => {
    // A second write against the same version would come back as a conflict
    // the reader did not cause.
    let land: (value: unknown) => void = () => undefined;
    api.put.mockReturnValue(
      new Promise(resolve => {
        land = resolve;
      })
    );
    const user = await changed();
    await user.click(saveButton());
    navigate(ELSEWHERE);
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Save Changes",
      })
    );
    land({ message: "ok", item: {} });
    await waitFor(() => expect(window.location.pathname).toBe(ELSEWHERE));
    expect(api.put).toHaveBeenCalledTimes(1);
  });

  it("leaves the browser's own prompt to reload and close", async () => {
    await changed();
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });

  it("does not hold a reload or close when nothing changed", async () => {
    renderDashboard();
    await beginEditing();
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
  });

  describe("by going Back", () => {
    // Stands in for the admin's router, which listens on `popstate` and was
    // mounted long before the dashboard: it hears whatever the guard lets
    // through.
    const router = vi.fn();
    beforeEach(() => {
      router.mockClear();
      window.addEventListener("popstate", router);
    });
    afterEach(() => {
      window.removeEventListener("popstate", router);
    });

    function goBack() {
      act(() => window.history.back());
    }

    it("asks first, with the dashboard still at its address", async () => {
      await changed();
      goBack();

      await screen.findByRole("alertdialog");
      await waitFor(() => expect(window.location.pathname).toBe(DASHBOARD));
      // 🔴 The router must not hear a Back the guard is holding: it would
      // draw the page the reader is being asked about leaving for, and the
      // dashboard, its draft and this prompt would be gone before any answer.
      expect(router).not.toHaveBeenCalled();
    });

    it("goes Back once the reader discards", async () => {
      const user = await changed();
      goBack();
      const dialog = await screen.findByRole("alertdialog");
      await waitFor(() => expect(window.location.pathname).toBe(DASHBOARD));

      await user.click(
        within(dialog).getByRole("button", { name: "Discard Changes" })
      );

      await waitFor(() => expect(window.location.pathname).toBe(CAME_FROM));
      // And the router heard the traversal it is meant to act on.
      await waitFor(() => expect(router).toHaveBeenCalled());
      expect(writes()).toBe(0);
    });

    it("stays on the dashboard, in customise mode with the changes, on Keep Editing", async () => {
      const user = await changed();
      goBack();
      const dialog = await screen.findByRole("alertdialog");
      await waitFor(() => expect(window.location.pathname).toBe(DASHBOARD));

      await user.click(
        within(dialog).getByRole("button", { name: "Keep Editing" })
      );

      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
      expect(window.location.pathname).toBe(DASHBOARD);
      expect(drawnOrder()).toEqual(["core/b", "core/a", "core/c"]);
      expect(screen.getAllByTestId("card-actions")).toHaveLength(3);
      expect(router).not.toHaveBeenCalled();
    });
  });

  describe("by going Forward", () => {
    /** The page the reader came Back from, and can go Forward to again. */
    const AHEAD = "/admin/settings";

    beforeEach(async () => {
      window.history.pushState(null, "", AHEAD);
      window.history.back();
      await waitFor(() => expect(window.location.pathname).toBe(DASHBOARD));
    });

    it("asks first, with the dashboard still at its address", async () => {
      // 🔴 Putting the address back by stepping forward one entry, as Back
      // can, does nothing here: the reader is already on the last entry, so
      // the dashboard stayed on screen under another page's address.
      await changed();
      act(() => window.history.forward());

      await screen.findByRole("alertdialog");
      await waitFor(() => expect(window.location.pathname).toBe(DASHBOARD));
    });

    it("goes Forward once the reader discards", async () => {
      const user = await changed();
      act(() => window.history.forward());
      const dialog = await screen.findByRole("alertdialog");
      await waitFor(() => expect(window.location.pathname).toBe(DASHBOARD));

      await user.click(
        within(dialog).getByRole("button", { name: "Discard Changes" })
      );

      await waitFor(() => expect(window.location.pathname).toBe(AHEAD));
    });
  });
});
