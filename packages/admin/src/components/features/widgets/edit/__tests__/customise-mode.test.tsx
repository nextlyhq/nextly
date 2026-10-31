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

import { DashboardChromeProvider } from "../../../dashboard/header/dashboard-chrome";
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
// The page's header beside the grid holds Customize: its own reads stubbed.
vi.mock("@admin/hooks/queries/useDashboardSummary", () => ({
  DASHBOARD_SUMMARY_KEY: ["dashboard", "summary"],
  useDashboardSummary: () => ({ data: undefined }),
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
        chrome: "none",
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

/** One card, listed in the add panel's Overview group as core lists it. */
function facts(): WidgetLayoutFacts {
  return {
    allowsSeveral: false,
    group: "overview",
  };
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

function renderDashboard() {
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
  return render(
    <DashboardChromeProvider>
      <WelcomeHeader />
      <WidgetGrid />
    </DashboardChromeProvider>,
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
  return screen.getByRole("group", { name: "Customize your dashboard" });
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

/** Every write the dashboard can make. */
function writes(): number {
  return (
    api.put.mock.calls.length +
    api.post.mock.calls.length +
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

/** One change of each kind customise mode can make. */
const CHANGES: Array<[string, (user: User) => Promise<void>]> = [
  ["a move", user => choose(user, "Posts", "Move later")],
  [
    "a resize",
    async user => {
      await user.click(
        screen.getByRole("button", { name: "Card actions for Posts" })
      );
      const menu = await screen.findByRole("menu");
      await user.click(within(menu).getByRole("menuitem", { name: /Width/ }));
      const widths = await waitFor(() => {
        const menus = screen.getAllByRole("menu");
        expect(menus.length).toBe(2);
        return menus[1];
      });
      // By keyboard: jsdom has no geometry, so a pointer crossing into the
      // submenu reads as leaving it.
      within(widths)
        .getByRole("menuitemradio", { name: "Half width, 6 columns" })
        .focus();
      await user.keyboard("{Enter}");
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
    "a size from the quick popover",
    async user => {
      // Settings opens the card's quick popover; its Size is staged with the rest.
      await choose(user, "Notes", "Settings");
      const popover = await screen.findByRole("dialog", {
        name: "Quick settings for Notes",
      });
      await user.click(
        within(popover).getByRole("combobox", { name: "Width" })
      );
      await user.click(
        await screen.findByRole("option", { name: "Half width, 6 columns" })
      );
      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    },
  ],
  [
    "a setting",
    async user => {
      // Settings opens the card's quick popover, and More settings the sheet.
      await choose(user, "Notes", "Settings");
      const popover = await screen.findByRole("dialog", {
        name: "Quick settings for Notes",
      });
      await user.click(
        within(popover).getByRole("button", { name: "More settings" })
      );
      // The sheet's panel opens at once and says it is loading until its code
      // arrives, so wait for the form's field before reading the sheet.
      await screen.findByLabelText(/Heading/);
      const sheet = screen.getByRole("dialog", { name: "Notes settings" });
      await user.type(within(sheet).getByLabelText(/Heading/), "Mine");
      await user.click(within(sheet).getByRole("button", { name: "Done" }));
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
      await user.click(within(bar()).getByRole("button", { name: "Cancel" }));

      expect(drawnOrder()).toEqual(order);
      expect(writes()).toBe(0);
      // Back in customise mode, the sizes are the ones it opened with.
      await beginEditing();
      expect(sizeLabels()).toEqual(sizes);
    }
  );
});

describe("the card menu and quick popover while customising", () => {
  it("lists Settings, the size, the moves, then Remove", async () => {
    renderDashboard();
    const user = await beginEditing();
    await user.click(
      screen.getByRole("button", { name: "Card actions for Notes" })
    );
    const menu = await screen.findByRole("menu");
    const names = within(menu)
      .getAllByRole("menuitem")
      .map(item => item.textContent?.trim() ?? "");
    expect(names[0]).toBe("Settings");
    expect(names[1]).toMatch(/^Width/);
    expect(names[2]).toMatch(/^Height/);
    expect(names.slice(3, 7)).toEqual([
      "Move to start",
      "Move earlier",
      "Move later",
      "Move to end",
    ]);
    expect(names.at(-1)).toBe("Remove");
  });

  it("applies a size at once, with the popover still open, and keeps it for Save", async () => {
    renderDashboard();
    const user = await beginEditing();
    const before = sizeLabels();
    await choose(user, "Notes", "Settings");
    const popover = await screen.findByRole("dialog", {
      name: "Quick settings for Notes",
    });
    await user.click(within(popover).getByRole("combobox", { name: "Width" }));
    await user.click(
      await screen.findByRole("option", { name: "Half width, 6 columns" })
    );

    // Drawn at once in the draft, the popover still open over the card, and nothing written.
    await waitFor(() => expect(sizeLabels()).not.toEqual(before));
    // The label's glyphs, then the name a screen reader hears.
    expect(sizeLabels()).toContain("6×36 columns by 3 rows");
    expect(
      screen.getByRole("dialog", { name: "Quick settings for Notes" })
    ).toBeInTheDocument();
    expect(writes()).toBe(0);
  });
});

describe("the bar", () => {
  it("is a labelled group with a title, a hint, and Add widget, Reset, Cancel and Save", async () => {
    renderDashboard();
    await beginEditing();

    expect(bar()).toHaveTextContent("Customizing your dashboard");
    const status = within(bar()).getByTestId("dashboard-edit-status");
    expect(status).toHaveTextContent("Only you see this layout.");
    // The handle is named only where it is drawn: from the dashboard's one-column width up.
    expect(
      within(status).getByText("Drag a card by its handle, or use its menu.")
    ).toHaveClass("hidden", "@min-[640px]/dashboard:inline");
    expect(
      within(status).getByText(
        "Use a card's menu to move, resize or remove it."
      )
    ).toHaveClass("@min-[640px]/dashboard:hidden");
    expect(
      within(bar())
        .getAllByRole("button")
        .map(button => button.textContent)
    ).toEqual(["Add widget", "Reset", "Cancel", "Save"]);
    expect(
      within(bar()).getByRole("button", { name: "Reset to default" })
    ).toBeInTheDocument();
  });

  it("stays at the top of the dashboard area while customising", async () => {
    // jsdom lays nothing out; the cause is asserted, on the element it is on.
    renderDashboard();
    await beginEditing();
    expect(bar()).toHaveClass("sticky", "top-0");
  });

  it("keeps exactly one level-one heading, the page's own", async () => {
    renderDashboard();
    await beginEditing();
    const mains = screen.getAllByRole("heading", { level: 1 });
    expect(mains).toHaveLength(1);
    expect(mains[0]).toHaveTextContent("Acme Site");
  });

  it("marks unsaved changes only while there are some", async () => {
    renderDashboard();
    const user = await beginEditing();
    expect(within(bar()).queryByText("Unsaved changes")).toBeNull();

    await choose(user, "Posts", "Move later");
    expect(within(bar()).getByText("Unsaved changes")).toBeInTheDocument();

    await choose(user, "Posts", "Move earlier");
    expect(within(bar()).queryByText("Unsaved changes")).toBeNull();
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

  it("shows a failed save inside the bar, with Try again", async () => {
    api.put.mockRejectedValueOnce(new Error("network"));
    renderDashboard();
    const user = await beginEditing();
    await choose(user, "Posts", "Move later");
    await user.click(saveButton());

    const error = await screen.findByTestId("dashboard-edit-error");
    expect(bar()).toContainElement(error);
    await user.click(within(error).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(2));
  });

  it("shows a refused save inside the bar, with Reload", async () => {
    api.put.mockRejectedValue(
      Object.assign(new Error("changed"), { status: 409 })
    );
    renderDashboard();
    const user = await beginEditing();
    await choose(user, "Posts", "Move later");
    await user.click(saveButton());

    const conflict = await screen.findByTestId("dashboard-edit-conflict");
    expect(bar()).toContainElement(conflict);
    expect(
      within(conflict).getByRole("button", { name: "Reload" })
    ).toBeInTheDocument();
  });
});

describe("focus", () => {
  it("moves to the bar on entering customise mode", async () => {
    renderDashboard();
    await beginEditing();
    await waitFor(() => expect(bar()).toHaveFocus());
  });

  it("returns to Customize after Cancel", async () => {
    renderDashboard();
    const user = await beginEditing();
    await user.click(within(bar()).getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.getByTestId("dashboard-edit-begin")).toHaveFocus()
    );
  });

  it("returns to Customize once a save has landed", async () => {
    renderDashboard();
    const user = await beginEditing();
    await choose(user, "Posts", "Move later");
    await user.click(saveButton());
    await waitFor(() =>
      expect(screen.getByTestId("dashboard-edit-begin")).toHaveFocus()
    );
  });

  it("keeps a card's controls clear of the sticky bar when they take focus", async () => {
    // Scrolling a focused control into view honours its scroll margin, which
    // is what keeps it out from under a bar stuck to the top.
    renderDashboard();
    await beginEditing();
    for (const control of [
      ...screen.getAllByTestId("widget-drag-handle"),
      ...screen.getAllByRole("button", { name: /^Card actions for / }),
    ]) {
      expect(control.closest("[data-testid^='widget-cell-']")).toHaveClass(
        "[&_button]:scroll-mt-40"
      );
    }
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
      await user.click(within(bar()).getByRole("button", { name: "Cancel" }));
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
    await user.click(within(bar()).getByRole("button", { name: "Cancel" }));
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

  /** Opens Notes' settings panel while customising and changes its Heading, keeping it open. */
  async function panelChanged(user: User): Promise<void> {
    await choose(user, "Notes", "Settings");
    const popover = await screen.findByRole("dialog", {
      name: "Quick settings for Notes",
    });
    await user.click(
      within(popover).getByRole("button", { name: "More settings" })
    );
    const panel = await screen.findByRole("dialog", { name: /settings$/ });
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
    const panel = screen.getByRole("dialog", { name: /settings$/ });
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

  it("the bar's Save stops, with the panel saying why, when the panel's change is refused", async () => {
    renderDashboard();
    const user = await beginEditing();
    await panelChanged(user);
    const panel = screen.getByRole("dialog", { name: /settings$/ });
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
    const panel = screen.getByRole("dialog", { name: /settings$/ });
    // The write is held, so the save is on its way while the panel is checked.
    api.put.mockReturnValue(new Promise(() => {}));
    await user.click(saveButton());
    await waitFor(() =>
      expect(within(panel).getByLabelText(/Heading/)).toBeDisabled()
    );
    // Done says the save is on its way, as it does for the panel's own.
    expect(
      within(panel).getByRole("button", { name: "Saving…" })
    ).toBeDisabled();
  });

  it("the bar's Cancel discards a settings panel's change too: it closes, and nothing is left to keep", async () => {
    renderDashboard();
    const user = await beginEditing();
    await panelChanged(user);
    await user.click(within(bar()).getByRole("button", { name: "Cancel" }));
    // "Changes discarded" is true of the panel too: it is closed, with no Done to press.
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /settings$/ })).toBeNull()
    );
    expect(writes()).toBe(0);
    // Opened again, it holds what is stored, not the discarded Heading.
    await user.click(await screen.findByTestId("dashboard-edit-begin"));
    await screen.findAllByTestId("card-actions");
    await choose(user, "Notes", "Settings");
    const popover = await screen.findByRole("dialog", {
      name: "Quick settings for Notes",
    });
    await user.click(
      within(popover).getByRole("button", { name: "More settings" })
    );
    const panel = await screen.findByRole("dialog", { name: /settings$/ });
    expect(within(panel).getByLabelText(/Heading/)).toHaveValue("");
    expect(writes()).toBe(0);
  });

  it("hands focus to the card's menu at rest when a panel opened while customising closes after the mode ended", async () => {
    renderDashboard();
    const user = await beginEditing();
    await choose(user, "Notes", "Settings");
    const popover = await screen.findByRole("dialog", {
      name: "Quick settings for Notes",
    });
    await user.click(
      within(popover).getByRole("button", { name: "More settings" })
    );
    const panel = await screen.findByRole("dialog", { name: /settings$/ });
    await user.type(within(panel).getByLabelText(/Heading/), "Mine");
    // Saved, the panel's change with it: customise mode ends, and the controls the popover was
    // opened from go with it, while the panel stays open.
    await user.click(saveButton());
    await screen.findByTestId("dashboard-edit-begin");
    expect(screen.getByRole("dialog", { name: /settings$/ })).toBe(panel);
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
    expect(within(bar()).getByText("Unsaved changes")).toBeInTheDocument();
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
