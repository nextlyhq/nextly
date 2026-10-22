/**
 * Customise mode as a whole: its bar, what it keeps from the server until Save,
 * where focus goes, what it says, the cards it puts out of reach, and what
 * happens when the reader tries to leave with unsaved changes.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { protectedApi } from "@admin/lib/api/protectedApi";
import { registerCoreComponent } from "@admin/lib/plugins/component-registry-internal";
import type { AdminBranding } from "@admin/types/branding";
import type {
  DashboardLayoutResponse,
  WidgetPlacement,
  WidgetWidthFacts,
} from "@admin/types/dashboard/widgets";

import { WelcomeHeader } from "../../../dashboard/WelcomeHeader";
import { WidgetGrid } from "../../WidgetGrid";
import {
  stubDashboardWidth,
  unstubDashboardWidth,
} from "../../__tests__/dashboard-width";

let mockBranding: AdminBranding | undefined;
let layoutResponse: DashboardLayoutResponse | undefined;

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => mockBranding,
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
        defaultSize: "full",
        component: "core#LinkedBody",
      },
      {
        id: "core/b",
        title: "Home page",
        archetype: "custom",
        defaultSize: "full",
        chrome: "none",
        component: "core#LinkedSection",
      },
      {
        id: "core/c",
        title: "Notes",
        archetype: "custom",
        defaultSize: "full",
        component: "core#NotesBody",
        settings: [{ name: "heading", type: "text", label: "Heading" }],
      },
      {
        id: "core/d",
        title: "Team",
        archetype: "custom",
        defaultSize: "full",
        component: "core#LinkedBody",
      },
    ],
  } as unknown as AdminBranding;
}

/** Every width, one card, listed in the add panel's Overview group as core lists it. */
function facts(): WidgetWidthFacts {
  return {
    allowedWidths: ["quarter", "third", "half", "twoThirds", "full"],
    defaultWidth: "full",
    allowsSeveral: false,
    group: "overview",
  };
}

const OPENED: WidgetPlacement[] = [
  { id: "p1", widgetId: "core/a", width: "full", removed: false },
  { id: "p2", widgetId: "core/b", width: "full", removed: false },
  { id: "p3", widgetId: "core/c", width: "full", removed: false },
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
      { id: "core/c", widgetId: "core/c", width: "half", removed: false },
      { id: "core/a", widgetId: "core/a", width: "half", removed: false },
    ],
    version: 3,
    source: "own",
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
    <>
      <WelcomeHeader />
      <WidgetGrid />
    </>,
    { wrapper: Wrapper }
  );
}

beforeEach(() => {
  // jsdom lays nothing out; the grid asks nothing until its dashboard has a width.
  stubDashboardWidth();
  vi.clearAllMocks();
  mockBranding = branding();
  layoutResponse = layout();
  api.get.mockImplementation(() => Promise.resolve(layoutResponse));
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

function widthLabels(): string[] {
  return screen
    .queryAllByTestId("card-width-label")
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
    "a width",
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
      within(widths).getByRole("menuitemradio", { name: "Half width" }).focus();
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
    "a setting",
    async user => {
      await choose(user, "Notes", "Settings");
      const sheet = await screen.findByRole("dialog");
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
      const reads = api.get.mock.calls.length;

      await change(user);

      expect(writes()).toBe(0);
      expect(api.get.mock.calls.length).toBe(reads);
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
      const widths = widthLabels();

      await change(user);
      await user.click(within(bar()).getByRole("button", { name: "Cancel" }));

      expect(drawnOrder()).toEqual(order);
      expect(writes()).toBe(0);
      // Back in customise mode, the widths are the ones it opened with.
      await beginEditing();
      expect(widthLabels()).toEqual(widths);
    }
  );
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
    expect(mains[0]).toHaveTextContent("Welcome, Dev");
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
  // How each kind dims: a framed card keeps its title and border, so the dim
  // reaches its body and footer through the card's slots; an unframed
  // section has no frame, so all of it dims.
  for (const [kind, title, link, dims] of [
    [
      "a framed card",
      "Posts",
      "View posts",
      "[&_[data-slot=card-content]]:opacity-60",
    ],
    ["an unframed section", "Home page", "Open the home page", "opacity-60"],
  ] as const) {
    it(`puts ${kind}'s own links and controls out of reach, and dims them`, async () => {
      renderDashboard();
      await beginEditing();

      const content = screen.getByRole("link", { name: link, hidden: true });
      const fence = content.closest("[inert]");
      expect(fence).not.toBeNull();
      expect(fence).toHaveClass(dims);
      // And what the framed dim reaches for is there to reach.
      if (kind === "a framed card") {
        expect(
          fence?.querySelector("[data-slot=card-content]")
        ).toContainElement(content);
      }
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
