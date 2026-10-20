/**
 * Customising the dashboard: what the reader can do, what is sent when they
 * save, and what happens when the arrangement is not there.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { layOutStacked, recordDragRegion } from "@admin/__tests__/helpers/drag";
import { protectedApi } from "@admin/lib/api/protectedApi";
import { registerCoreComponent } from "@admin/lib/plugins/component-registry-internal";
import type { AdminBranding } from "@admin/types/branding";
import type {
  DashboardLayoutResponse,
  WidgetPlacement,
  WidgetWidthFacts,
} from "@admin/types/dashboard/widgets";
import { MAX_PLACEMENTS } from "nextly/config";

import { WidgetGrid } from "../../WidgetGrid";
import {
  stubDashboardWidth,
  unstubDashboardWidth,
} from "../../__tests__/dashboard-width";

let mockBranding: AdminBranding | undefined;
let layoutResponse: DashboardLayoutResponse | undefined;
let layoutRejects = false;

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
vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

const api = vi.mocked(protectedApi);

/** Registered widgets, drawn by a component so no query is issued. */
function branding(
  ids: string[],
  patch: Record<string, Record<string, unknown>> = {}
): AdminBranding {
  return {
    widgets: ids.map(id => ({
      id,
      title: `Widget ${id}`,
      archetype: "custom",
      defaultSize: "full",
      component: "core#Whatever",
      ...patch[id],
    })),
  } as unknown as AdminBranding;
}

/**
 * Facts for a widget that allows every width, unless told otherwise. Listed in the add panel's
 * Overview group, as core lists every widget a reader may see under one of its groups.
 */
function facts(patch: Partial<WidgetWidthFacts> = {}): WidgetWidthFacts {
  return {
    allowedWidths: ["quarter", "third", "half", "twoThirds", "full"],
    defaultWidth: "full",
    allowsSeveral: false,
    group: "overview",
    ...patch,
  };
}

type PlacementInput = Partial<WidgetPlacement> &
  Pick<WidgetPlacement, "id" | "widgetId">;

function layout(
  placements: PlacementInput[],
  patch: Partial<DashboardLayoutResponse> = {}
): DashboardLayoutResponse {
  const full = placements.map(p => ({
    width: "full",
    removed: false,
    ...p,
  }));
  return {
    placements: full,
    widgets: Object.fromEntries(full.map(p => [p.widgetId, facts()])),
    available: [],
    defaultPlacements: [],
    version: 3,
    source: "own",
    scope: "tok",
    audience: "aud",
    ...patch,
  };
}

function renderGrid() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, gcTime: 0 },
      // 🔴 Mirrors the app's own `QueryProvider`, which retries mutations.
      // TanStack does not retry them by default, so a test client that stayed
      // silent here could never observe an unwanted retry.
      mutations: { retry: 2, retryDelay: 0 },
    },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, ...render(<WidgetGrid />, { wrapper: Wrapper }) };
}

beforeEach(() => {
  // jsdom lays nothing out; the grid asks nothing until its dashboard has a width.
  stubDashboardWidth();
  vi.clearAllMocks();
  layoutRejects = false;
  mockBranding = branding(["core/a", "core/b", "core/c"]);
  layoutResponse = layout([
    { id: "p1", widgetId: "core/a" },
    { id: "p2", widgetId: "core/b" },
    { id: "p3", widgetId: "core/c" },
  ]);
  api.get.mockImplementation(() =>
    layoutRejects
      ? Promise.reject(new Error("layout unavailable"))
      : Promise.resolve(layoutResponse)
  );
  api.put.mockResolvedValue({ message: "ok", item: {} });
  api.delete.mockResolvedValue({ message: "ok" });
});

afterEach(() => {
  unstubDashboardWidth();
});

/** Enters customise mode and waits for the per-card menus to exist. */
async function beginEditing() {
  const user = userEvent.setup();
  await user.click(await screen.findByTestId("dashboard-edit-begin"));
  await screen.findAllByTestId("card-actions");
  return user;
}

/** The order the grid draws its cells in, by widget id. */
function drawnOrder(): string[] {
  return screen
    .queryAllByTestId(/^widget-cell-/)
    .map(node => node.getAttribute("data-testid")?.replace("widget-cell-", ""))
    .filter((id): id is string => id !== undefined);
}

function menuButton(title: string): HTMLElement {
  return screen.getByRole("button", { name: `Card actions for ${title}` });
}

/** Opens a card's menu and returns it. */
async function openMenu(
  user: ReturnType<typeof userEvent.setup>,
  title: string
) {
  await user.click(menuButton(title));
  return screen.findByRole("menu");
}

/** Opens a card's menu and chooses one item from it. */
async function choose(
  user: ReturnType<typeof userEvent.setup>,
  title: string,
  item: string
) {
  const menu = await openMenu(user, title);
  await user.click(within(menu).getByRole("menuitem", { name: item }));
}

/** Opens a card's Width submenu and returns it. */
async function openWidths(
  user: ReturnType<typeof userEvent.setup>,
  title: string
) {
  const menu = await openMenu(user, title);
  await user.click(within(menu).getByRole("menuitem", { name: /Width/ }));
  return waitFor(() => {
    const menus = screen.getAllByRole("menu");
    expect(menus.length).toBe(2);
    return menus[1];
  });
}

function live(): HTMLElement {
  return screen.getByTestId("widget-grid-live");
}

/** Opens the add panel from the bar and returns it. */
async function openAddPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Add widget" }));
  return screen.findByTestId("add-widget-panel");
}

/** Closes the add panel by Escape, as a reader leaves it, and waits for it to go. */
async function closeAddPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.queryByTestId("add-widget-panel")).toBeNull()
  );
}

function putBody() {
  return api.put.mock.calls[0][1] as {
    placements: WidgetPlacement[];
    version: number;
    scope: string;
    arranged: boolean;
    replaceUnreadable?: boolean;
  };
}

describe("when the arrangement has not been read", () => {
  it("still draws the declared widgets", async () => {
    // 🔴 Deriving the grid from the layout alone blanked the entire dashboard
    // while the request was in flight, and for the whole of any outage.
    layoutRejects = true;
    renderGrid();

    await waitFor(() =>
      expect(screen.getByTestId("widget-cell-core/a")).toBeInTheDocument()
    );
    expect(drawnOrder()).toEqual(["core/a", "core/b", "core/c"]);
  });

  it("does not offer customising, because a write would have nothing to guard it", async () => {
    layoutRejects = true;
    renderGrid();

    await waitFor(() =>
      expect(screen.getByTestId("widget-cell-core/a")).toBeInTheDocument()
    );
    expect(screen.queryByTestId("dashboard-edit-begin")).toBeNull();
  });
});

describe("the dashboard is one ordered list", () => {
  it("draws the cards in the list's order, not the declaration order", async () => {
    layoutResponse = layout([
      { id: "p3", widgetId: "core/c" },
      { id: "p1", widgetId: "core/a" },
      { id: "p2", widgetId: "core/b" },
    ]);
    renderGrid();
    // Waits for the BEGIN button, which exists only once an arrangement has
    // been read; every cell exists in the declared fallback too.
    await screen.findByTestId("dashboard-edit-begin");
    expect(drawnOrder()).toEqual(["core/c", "core/a", "core/b"]);
  });

  it("draws each card at its STORED width, not the declaration's", async () => {
    // The widgets declare `full`; the placement says quarter.
    layoutResponse = layout([
      { id: "p1", widgetId: "core/a", width: "quarter" },
    ]);
    renderGrid();
    await screen.findByTestId("dashboard-edit-begin");
    expect(screen.getByTestId("widget-cell-core/a")).toHaveClass(
      "@min-[1024px]/dashboard:col-span-3"
    );
  });

  it("draws a width the widget no longer allows at the nearest allowed one, wider on a tie", async () => {
    // Stored half; the widget now allows a third or two thirds, equally near.
    layoutResponse = layout([{ id: "p1", widgetId: "core/a", width: "half" }], {
      widgets: { "core/a": facts({ allowedWidths: ["third", "twoThirds"] }) },
    });
    renderGrid();
    await screen.findByTestId("dashboard-edit-begin");
    expect(screen.getByTestId("widget-cell-core/a")).toHaveClass(
      "@min-[1024px]/dashboard:col-span-8"
    );
  });

  it("does not draw a removed card", async () => {
    layoutResponse = layout([
      { id: "p1", widgetId: "core/a" },
      { id: "p2", widgetId: "core/b", removed: true },
    ]);
    renderGrid();
    await screen.findByTestId("dashboard-edit-begin");
    expect(drawnOrder()).toEqual(["core/a"]);
  });
});

describe("entering customise mode", () => {
  it("gives every card ONE named menu button, large enough to hit", async () => {
    renderGrid();
    await beginEditing();
    expect(screen.getAllByTestId("card-actions")).toHaveLength(3);
    // 28px, past the 24px minimum target size.
    expect(menuButton("Widget core/a")).toHaveClass("size-7");
  });

  it("shows each card's width beside its menu", async () => {
    layoutResponse = layout([
      { id: "p1", widgetId: "core/a", width: "half" },
      { id: "p2", widgetId: "core/b", width: "quarter" },
    ]);
    renderGrid();
    await beginEditing();
    const labels = screen.getAllByTestId("card-width-label");
    expect(labels.map(label => label.textContent)).toEqual([
      "½Half width",
      "¼Quarter width",
    ]);
  });

  it("shows no menu outside customise mode", async () => {
    renderGrid();
    await screen.findByTestId("dashboard-edit-begin");
    expect(screen.queryAllByTestId("card-actions")).toHaveLength(0);
  });
});

describe("moving a card from its menu", () => {
  it("offers the four moves, disabling the ones a card at an end cannot make", async () => {
    renderGrid();
    const user = await beginEditing();

    let menu = await openMenu(user, "Widget core/a");
    const item = (name: string) => within(menu).getByRole("menuitem", { name });
    expect(item("Move to start")).toHaveAttribute("aria-disabled", "true");
    expect(item("Move earlier")).toHaveAttribute("aria-disabled", "true");
    expect(item("Move later")).not.toHaveAttribute("aria-disabled");
    expect(item("Move to end")).not.toHaveAttribute("aria-disabled");
    await user.keyboard("{Escape}");

    menu = await openMenu(user, "Widget core/c");
    expect(item("Move later")).toHaveAttribute("aria-disabled", "true");
    expect(item("Move to end")).toHaveAttribute("aria-disabled", "true");
    expect(item("Move to start")).not.toHaveAttribute("aria-disabled");
  });

  it("moves it, and says where from and where to", async () => {
    renderGrid();
    const user = await beginEditing();

    await choose(user, "Widget core/a", "Move later");

    expect(drawnOrder()).toEqual(["core/b", "core/a", "core/c"]);
    expect(live()).toHaveTextContent("Widget core/a moved from 1 to 2 of 3.");
  });

  it("moves it to either end", async () => {
    renderGrid();
    const user = await beginEditing();

    await choose(user, "Widget core/a", "Move to end");
    expect(drawnOrder()).toEqual(["core/b", "core/c", "core/a"]);
    expect(live()).toHaveTextContent("Widget core/a moved from 1 to 3 of 3.");

    await choose(user, "Widget core/a", "Move to start");
    expect(drawnOrder()).toEqual(["core/a", "core/b", "core/c"]);
  });

  it("returns focus to the moved card's menu button", async () => {
    renderGrid();
    const user = await beginEditing();

    await choose(user, "Widget core/a", "Move later");

    // The card's DOM moved with it; without sending focus back, the reader
    // would have to find the card again to move it a second step.
    await waitFor(() =>
      expect(document.activeElement).toBe(menuButton("Widget core/a"))
    );
  });

  it("counts only the cards the grid DRAWS", async () => {
    // 🔴 A placement whose widget this admin cannot draw sits in the list
    // between two drawn ones. Counted, a move would be announced against a
    // total the reader cannot see -- and a step earlier would swap the drawn
    // card with the invisible one, changing nothing on screen.
    mockBranding = branding(["core/a", "core/b"]);
    layoutResponse = layout([
      { id: "p1", widgetId: "core/a" },
      { id: "px", widgetId: "plugin/unbundled" },
      { id: "p2", widgetId: "core/b" },
    ]);
    renderGrid();
    const user = await beginEditing();

    await choose(user, "Widget core/b", "Move earlier");

    expect(drawnOrder()).toEqual(["core/b", "core/a"]);
    expect(live()).toHaveTextContent("Widget core/b moved from 2 to 1 of 2.");
    await user.click(screen.getByTestId("dashboard-edit-save"));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    // The undrawn card keeps its place relative to the card it followed.
    expect(putBody().placements.map(p => p.id)).toEqual(["p2", "p1", "px"]);
  });
});

describe("choosing a width", () => {
  beforeEach(() => {
    layoutResponse = layout([{ id: "p1", widgetId: "core/a", width: "half" }], {
      widgets: {
        "core/a": facts({ allowedWidths: ["third", "half", "full"] }),
      },
    });
  });

  it("lists only the widths the widget allows, by name and fraction, the current one checked", async () => {
    renderGrid();
    const user = await beginEditing();

    const widths = await openWidths(user, "Widget core/a");
    const items = within(widths).getAllByRole("menuitemradio");
    expect(items.map(i => i.textContent)).toEqual([
      "Third width⅓",
      "Half width½",
      "Full width",
    ]);
    expect(
      within(widths).getByRole("menuitemradio", { name: "Half width" })
    ).toHaveAttribute("aria-checked", "true");
  });

  it("applies the width at once and says so", async () => {
    renderGrid();
    const user = await beginEditing();

    const widths = await openWidths(user, "Widget core/a");
    // By keyboard: jsdom has no geometry, so a simulated pointer crossing from
    // the submenu's trigger into it reads as leaving, and Radix closes it.
    within(widths).getByRole("menuitemradio", { name: "Third width" }).focus();
    await user.keyboard("{Enter}");

    expect(screen.getByTestId("widget-cell-core/a")).toHaveClass(
      "@min-[1024px]/dashboard:col-span-4"
    );
    expect(live()).toHaveTextContent("Widget core/a set to Third width.");
    expect(screen.getByTestId("card-width-label")).toHaveTextContent("⅓");
    // Nothing written until Save.
    expect(api.put).not.toHaveBeenCalled();
    await user.click(screen.getByTestId("dashboard-edit-save"));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(putBody().placements[0].width).toBe("third");
  });

  it("checks the DRAWN width when the stored one is no longer allowed, and saves it unchanged", async () => {
    layoutResponse = layout(
      [
        { id: "p1", widgetId: "core/a", width: "half" },
        { id: "p2", widgetId: "core/b" },
      ],
      {
        widgets: {
          "core/a": facts({ allowedWidths: ["third", "twoThirds"] }),
          "core/b": facts(),
        },
      }
    );
    renderGrid();
    const user = await beginEditing();

    const widths = await openWidths(user, "Widget core/a");
    expect(
      within(widths).getByRole("menuitemradio", { name: "Two-thirds width" })
    ).toHaveAttribute("aria-checked", "true");
    await user.keyboard("{Escape}");

    // An unrelated change saves the stored width as it was: the server keeps
    // an unchanged width the widget has stopped allowing.
    await choose(user, "Widget core/b", "Move to start");
    await user.click(screen.getByTestId("dashboard-edit-save"));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(putBody().placements.find(p => p.id === "p1")?.width).toBe("half");
  });
});

describe("moving a card from the keyboard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Enters customise mode and gives the cells the geometry a list has. */
  async function beginKeyboardEditing() {
    renderGrid();
    await beginEditing();
    layOutStacked(
      ["core/a", "core/b", "core/c"].map(id =>
        screen.getByTestId(`widget-cell-${id}`)
      ),
      { height: 200, width: 400 }
    );
  }

  it("says which card was picked up, and where it sits, by title", async () => {
    // 🔴 dnd-kit's default reads the placement id aloud, which names nothing a
    // reader can see.
    await beginKeyboardEditing();
    const heard = recordDragRegion();
    const handle = screen.getByRole("button", {
      name: "Drag to reorder Widget core/b",
    });
    handle.focus();
    fireEvent.keyDown(handle, { code: "Space", key: " " });

    await waitFor(() =>
      expect(heard).toContain("Picked up Widget core/b, position 2 of 3.")
    );
    expect(heard.join(" ")).not.toContain("draggable item");
    // The grid's OWN region is for landings. A pick-up is not one.
    expect(live().textContent).not.toMatch(/Widget core\/b/);
  });

  it("does not read a drop twice: dnd-kit is silent on landing, the grid speaks", async () => {
    await beginKeyboardEditing();
    const heard = recordDragRegion();
    const handle = screen.getByRole("button", {
      name: "Drag to reorder Widget core/b",
    });
    handle.focus();
    fireEvent.keyDown(handle, { code: "Space", key: " " });
    await waitFor(() => expect(handle).toHaveAttribute("aria-pressed", "true"));

    fireEvent.keyDown(handle, { code: "Space", key: " " });
    await waitFor(() => expect(handle).not.toHaveAttribute("aria-pressed"));
    expect(heard.join(" ")).not.toMatch(/moved to|was dropped/);
    expect(live().textContent).not.toMatch(/moved/);
  });
});

describe("dragging cards of different widths", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("moves only the held card while dragging, and reorders on drop", async () => {
    // A quarter beside a full card. dnd-kit's live preview would slide the
    // full card into the quarter's rectangle, scaled to fit, drawing a row the
    // grid never lays out; so the card not held stays put until the drop.
    mockBranding = branding(["core/a", "core/b"]);
    layoutResponse = layout([
      { id: "p1", widgetId: "core/a", width: "quarter" },
      { id: "p2", widgetId: "core/b", width: "full" },
    ]);
    renderGrid();
    await beginEditing();
    layOutStacked(
      ["core/a", "core/b"].map(id => screen.getByTestId(`widget-cell-${id}`)),
      { height: 200, width: 400 }
    );

    const handle = screen.getByRole("button", {
      name: "Drag to reorder Widget core/a",
    });
    handle.focus();
    fireEvent.keyDown(handle, { code: "Space", key: " " });
    await waitFor(() => expect(handle).toHaveAttribute("aria-pressed", "true"));
    fireEvent.keyDown(handle, { code: "ArrowDown", key: "ArrowDown" });

    await waitFor(() =>
      expect(screen.getByTestId("widget-cell-core/a").style.transform).not.toBe(
        ""
      )
    );
    // The held card follows unscaled; the other card has no transform at all.
    expect(
      screen.getByTestId("widget-cell-core/a").style.transform
    ).not.toMatch(/scale/);
    expect(screen.getByTestId("widget-cell-core/b").style.transform).toBe("");

    fireEvent.keyDown(handle, { code: "Space", key: " " });
    await waitFor(() => expect(drawnOrder()).toEqual(["core/b", "core/a"]));
    expect(live()).toHaveTextContent("Widget core/a moved from 1 to 2 of 2.");
  });
});

describe("removing a card", () => {
  it("takes it off the grid, says so, and offers Undo", async () => {
    renderGrid();
    const user = await beginEditing();

    await choose(user, "Widget core/b", "Remove");

    expect(drawnOrder()).toEqual(["core/a", "core/c"]);
    expect(live()).toHaveTextContent("Widget core/b removed.");
    const notice = screen.getByTestId("removal-notice");
    expect(notice).toHaveTextContent("Widget core/b removed.");
    expect(
      within(notice).getByRole("button", {
        name: "Undo removing Widget core/b",
      })
    ).toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
  });

  it("sends focus to the NEXT card's menu", async () => {
    renderGrid();
    const user = await beginEditing();
    await choose(user, "Widget core/b", "Remove");
    await waitFor(() =>
      expect(document.activeElement).toBe(menuButton("Widget core/c"))
    );
  });

  it("sends focus to the PREVIOUS card's menu when it was the last", async () => {
    renderGrid();
    const user = await beginEditing();
    await choose(user, "Widget core/c", "Remove");
    await waitFor(() =>
      expect(document.activeElement).toBe(menuButton("Widget core/b"))
    );
  });

  it("sends focus to Add widget when no card is left", async () => {
    mockBranding = branding(["core/a"]);
    layoutResponse = layout([{ id: "p1", widgetId: "core/a" }]);
    renderGrid();
    const user = await beginEditing();
    await choose(user, "Widget core/a", "Remove");
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Add widget" })
      )
    );
  });

  it("Undo puts the card back where it was, and leaves nothing to save", async () => {
    renderGrid();
    const user = await beginEditing();
    await choose(user, "Widget core/b", "Remove");

    await user.click(screen.getByTestId("removal-notice-undo"));

    expect(drawnOrder()).toEqual(["core/a", "core/b", "core/c"]);
    expect(screen.queryByTestId("removal-notice")).toBeNull();
    expect(screen.getByTestId("dashboard-edit-save")).toBeDisabled();
  });

  it("keeps the notice until it is closed, or replaced by the next one", async () => {
    renderGrid();
    const user = await beginEditing();
    await choose(user, "Widget core/a", "Remove");
    await choose(user, "Widget core/b", "Remove");

    expect(screen.getAllByTestId("removal-notice")).toHaveLength(1);
    expect(screen.getByTestId("removal-notice")).toHaveTextContent(
      "Widget core/b removed."
    );
    await user.click(screen.getByTestId("removal-notice-close"));
    expect(screen.queryByTestId("removal-notice")).toBeNull();
  });

  it("saves a removed card AS removed, keeping its width and settings", async () => {
    layoutResponse = layout([
      { id: "p1", widgetId: "core/a" },
      { id: "p2", widgetId: "core/b", width: "third", config: { limit: 4 } },
    ]);
    renderGrid();
    const user = await beginEditing();
    await choose(user, "Widget core/b", "Remove");
    await user.click(screen.getByTestId("dashboard-edit-save"));

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(putBody().placements).toEqual([
      { id: "p1", widgetId: "core/a", width: "full", removed: false },
      {
        id: "p2",
        widgetId: "core/b",
        width: "third",
        removed: true,
        config: { limit: 4 },
      },
    ]);
  });

  it("lists removed cards first in the panel, and Add back restores one in place", async () => {
    renderGrid();
    const user = await beginEditing();
    await choose(user, "Widget core/a", "Remove");

    const panel = await openAddPanel(user);
    const headings = within(panel)
      .getAllByRole("heading", { level: 3 })
      .map(heading => heading.textContent);
    expect(headings[0]).toBe("Removed from your dashboard 1");
    await user.click(
      within(panel).getByRole("button", { name: "Add back Widget core/a" })
    );

    expect(drawnOrder()).toEqual(["core/a", "core/b", "core/c"]);
    // The panel says it, since a modal sheet hides the grid's own region.
    expect(within(panel).getByTestId("add-panel-live")).toHaveTextContent(
      "Added back Widget core/a at position 1 of 3."
    );
    // Putting back the card the notice offered to undo answers the notice.
    expect(screen.queryByTestId("removal-notice")).toBeNull();
  });
});

describe("adding a widget", () => {
  it("offers what the server said is available", async () => {
    mockBranding = branding(["core/a", "core/b", "core/c", "core/d"]);
    layoutResponse = layout(
      [
        { id: "p1", widgetId: "core/a" },
        { id: "p2", widgetId: "core/b" },
        { id: "p3", widgetId: "core/c" },
      ],
      {
        available: ["core/d"],
        widgets: Object.fromEntries(
          ["core/a", "core/b", "core/c", "core/d"].map(id => [id, facts()])
        ),
      }
    );
    renderGrid();
    const user = await beginEditing();
    const panel = await openAddPanel(user);
    expect(
      within(panel).getByRole("button", { name: "Add Widget core/d" })
    ).toBeInTheDocument();
  });

  it("appends the card at the widget's default width", async () => {
    mockBranding = branding(["core/a", "core/d"]);
    layoutResponse = layout([{ id: "p1", widgetId: "core/a" }], {
      available: ["core/d"],
      widgets: {
        "core/a": facts(),
        "core/d": facts({ defaultWidth: "third" }),
      },
    });
    renderGrid();
    const user = await beginEditing();

    await openAddPanel(user);
    await user.click(screen.getByTestId("add-panel-add-core/d"));
    expect(drawnOrder()).toEqual(["core/a", "core/d"]);
    expect(screen.getByTestId("widget-cell-core/d")).toHaveClass(
      "@min-[1024px]/dashboard:col-span-4"
    );
    expect(screen.getByTestId("add-panel-live")).toHaveTextContent(
      "Added Widget core/d at position 2 of 2."
    );

    await closeAddPanel(user);
    await user.click(screen.getByTestId("dashboard-edit-save"));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(putBody().placements[1]).toEqual({
      id: "core/d",
      widgetId: "core/d",
      width: "third",
      removed: false,
    });
  });

  it("shows a one-card widget as on the dashboard once it is added, and keeps focus in the panel", async () => {
    mockBranding = branding(["core/a", "core/d"]);
    layoutResponse = layout([{ id: "p1", widgetId: "core/a" }], {
      available: ["core/d"],
      widgets: { "core/a": facts(), "core/d": facts() },
    });
    renderGrid();
    const user = await beginEditing();

    await openAddPanel(user);
    await user.click(screen.getByTestId("add-panel-add-core/d"));
    expect(screen.queryByTestId("add-panel-add-core/d")).toBeNull();
    expect(
      screen.getByTestId("add-panel-on-dashboard-core/d")
    ).toBeInTheDocument();
    // The pressed button is gone with the row's change, so focus goes back to the search.
    await waitFor(() =>
      expect(screen.getByTestId("add-panel-search")).toHaveFocus()
    );
  });

  it("keeps offering a widget that allows several cards", async () => {
    mockBranding = branding(["core/a", "core/d"]);
    layoutResponse = layout([{ id: "p1", widgetId: "core/a" }], {
      available: ["core/d"],
      widgets: {
        "core/a": facts(),
        "core/d": facts({ allowsSeveral: true }),
      },
    });
    renderGrid();
    const user = await beginEditing();

    await openAddPanel(user);
    await user.click(screen.getByRole("button", { name: "Add Widget core/d" }));
    await user.click(
      screen.getByRole("button", { name: "Add another Widget core/d" })
    );
    expect(screen.getAllByTestId("widget-cell-core/d")).toHaveLength(2);
    expect(screen.getByTestId("add-panel-row-core/d")).toHaveTextContent(
      "2 on your dashboard"
    );

    await closeAddPanel(user);
    await user.click(screen.getByTestId("dashboard-edit-save"));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    const ids = putBody().placements.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("shows every placed one-card widget as on the dashboard, with nothing to add", async () => {
    renderGrid();
    const user = await beginEditing();
    const panel = await openAddPanel(user);
    for (const id of ["core/a", "core/b", "core/c"]) {
      expect(
        within(panel).getByTestId(`add-panel-on-dashboard-${id}`)
      ).toBeInTheDocument();
    }
    expect(within(panel).queryAllByRole("button", { name: /^Add / })).toEqual(
      []
    );
  });

  it("rings the card just added, and closing sends focus to its menu", async () => {
    mockBranding = branding(["core/a", "core/d"]);
    layoutResponse = layout([{ id: "p1", widgetId: "core/a" }], {
      available: ["core/d"],
      widgets: { "core/a": facts(), "core/d": facts() },
    });
    renderGrid();
    const user = await beginEditing();

    await openAddPanel(user);
    await user.click(screen.getByTestId("add-panel-add-core/d"));
    expect(screen.getByTestId("widget-cell-core/d")).toHaveAttribute(
      "data-highlighted"
    );
    expect(screen.getByTestId("widget-cell-core/a")).not.toHaveAttribute(
      "data-highlighted"
    );

    await closeAddPanel(user);
    await waitFor(() =>
      expect(document.activeElement).toBe(menuButton("Widget core/d"))
    );
  });

  it("closing with nothing added sends focus back to Add widget", async () => {
    renderGrid();
    const user = await beginEditing();
    await openAddPanel(user);
    await closeAddPanel(user);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Add widget" })
      )
    );
  });

  it("drops the ring once customise mode ends", async () => {
    mockBranding = branding(["core/a", "core/d"]);
    layoutResponse = layout([{ id: "p1", widgetId: "core/a" }], {
      available: ["core/d"],
      widgets: { "core/a": facts(), "core/d": facts() },
    });
    renderGrid();
    const user = await beginEditing();
    await openAddPanel(user);
    await user.click(screen.getByTestId("add-panel-add-core/d"));
    await closeAddPanel(user);

    // The read after the save answers with the card, so it is still drawn to be looked at.
    layoutResponse = layout(
      [
        { id: "p1", widgetId: "core/a" },
        { id: "core/d", widgetId: "core/d" },
      ],
      { widgets: { "core/a": facts(), "core/d": facts() } }
    );
    await user.click(screen.getByTestId("dashboard-edit-save"));
    await screen.findByTestId("dashboard-edit-begin");
    expect(screen.getByTestId("widget-cell-core/d")).not.toHaveAttribute(
      "data-highlighted"
    );
  });
});

describe("an arrangement that already holds as many cards as a write may carry", () => {
  it("disables adding, and says why, while still listing the surplus", async () => {
    const ids = Array.from({ length: MAX_PLACEMENTS }, (_, i) => `core/w${i}`);
    mockBranding = branding([...ids, "core/surplus"]);
    layoutResponse = layout(
      ids.map((id, i) => ({ id: `p${i}`, widgetId: id })),
      {
        available: ["core/surplus"],
        widgets: Object.fromEntries(
          [...ids, "core/surplus"].map(id => [id, facts()])
        ),
      }
    );
    renderGrid();
    const user = await beginEditing();
    await openAddPanel(user);

    const add = await screen.findByTestId("add-panel-add-core/surplus");
    expect(add).toBeDisabled();
    expect(screen.getByTestId("add-panel-at-capacity")).toBeInTheDocument();
  });

  // The REFUSAL itself is asserted against `addPlacement` in
  // `layout-editor.test.ts`: a disabled button's click never fires, so a test
  // driving it cannot reach the guard.
});

describe("saving", () => {
  it("sends the whole ordered list in one PUT, with both guards, as an arrangement", async () => {
    renderGrid();
    const user = await beginEditing();

    await choose(user, "Widget core/a", "Move later");
    await user.click(screen.getByTestId("dashboard-edit-save"));

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(api.put.mock.calls[0][0]).toBe("/dashboard/layout");
    expect(putBody()).toEqual({
      placements: [
        { id: "p2", widgetId: "core/b", width: "full", removed: false },
        { id: "p1", widgetId: "core/a", width: "full", removed: false },
        { id: "p3", widgetId: "core/c", width: "full", removed: false },
      ],
      version: 3,
      scope: "tok",
      arranged: true,
    });
  });

  it("cannot be pressed with nothing to save", async () => {
    renderGrid();
    await beginEditing();
    expect(screen.getByTestId("dashboard-edit-save")).toBeDisabled();
  });

  it("leaves customise mode when it lands", async () => {
    renderGrid();
    const user = await beginEditing();

    await choose(user, "Widget core/a", "Move later");
    await user.click(screen.getByTestId("dashboard-edit-save"));

    await waitFor(() =>
      expect(screen.queryAllByTestId("card-actions")).toHaveLength(0)
    );
  });
});

describe("the guards a save is sent against", () => {
  it("uses the version the DRAFT was taken from, not the newest one", async () => {
    // 🔴 The query refetches on window focus, so another tab can save while
    // this one is customising. A save that read the version fresh would then
    // SUCCEED against a version its arrangement was never derived from.
    const { client } = renderGrid();
    const user = await beginEditing();
    await choose(user, "Widget core/a", "Move later");

    layoutResponse = layout([{ id: "p1", widgetId: "core/a" }], {
      version: 99,
      scope: "moved-on",
    });
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["dashboard", "layout"] });
    });
    expect(api.get).toHaveBeenCalledTimes(2);

    await user.click(screen.getByTestId("dashboard-edit-save"));

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(putBody().version).toBe(3);
    expect(putBody().scope).toBe("tok");
  });

  it("does not retry a failed save", async () => {
    // A version-guarded write is not idempotent under an AMBIGUOUS failure: a
    // retry of a write that committed is refused as a conflict nobody caused.
    api.put.mockRejectedValue(new Error("network"));
    renderGrid();
    const user = await beginEditing();

    await choose(user, "Widget core/a", "Move later");
    await user.click(screen.getByTestId("dashboard-edit-save"));

    await screen.findByTestId("dashboard-edit-error");
    expect(api.put).toHaveBeenCalledTimes(1);
  });

  it("stays in customise mode with the changes kept when a save fails, and says why", async () => {
    api.put.mockRejectedValue(new Error("boom"));
    renderGrid();
    const user = await beginEditing();

    await choose(user, "Widget core/a", "Move later");
    await user.click(screen.getByTestId("dashboard-edit-save"));

    expect(await screen.findByTestId("dashboard-edit-error")).toHaveTextContent(
      "Your dashboard could not be saved. Your changes are still here"
    );
    expect(screen.queryByTestId("dashboard-edit-conflict")).toBeNull();
    expect(drawnOrder()).toEqual(["core/b", "core/a", "core/c"]);
    expect(screen.getAllByTestId("card-actions")).toHaveLength(3);
  });
});

describe("cancelling", () => {
  it("puts the arrangement back as it was opened", async () => {
    renderGrid();
    const user = await beginEditing();

    await choose(user, "Widget core/a", "Move later");
    await choose(user, "Widget core/c", "Remove");
    await user.click(screen.getByTestId("dashboard-edit-cancel"));

    expect(drawnOrder()).toEqual(["core/a", "core/b", "core/c"]);
    expect(api.put).not.toHaveBeenCalled();
    // A notice about a draft that no longer exists would offer an Undo that
    // has nothing to undo.
    expect(screen.queryByTestId("removal-notice")).toBeNull();
  });

  it("takes a failure message with the draft", async () => {
    api.put.mockRejectedValue(new Error("network"));
    renderGrid();
    const user = await beginEditing();

    await choose(user, "Widget core/a", "Move later");
    await user.click(screen.getByTestId("dashboard-edit-save"));
    await screen.findByTestId("dashboard-edit-error");

    await user.click(screen.getByTestId("dashboard-edit-cancel"));

    await waitFor(() =>
      expect(screen.queryByTestId("dashboard-edit-error")).toBeNull()
    );
  });
});

describe("a conflict", () => {
  it("says the dashboard changed, and KEEPS the reader's work on screen", async () => {
    const conflict = Object.assign(new Error("changed"), { status: 409 });
    api.put.mockRejectedValue(conflict);
    renderGrid();
    const user = await beginEditing();

    await choose(user, "Widget core/a", "Move later");
    await user.click(screen.getByTestId("dashboard-edit-save"));

    expect(
      await screen.findByTestId("dashboard-edit-conflict")
    ).toHaveTextContent("Your dashboard changed somewhere else");
    expect(drawnOrder()).toEqual(["core/b", "core/a", "core/c"]);
  });

  it("Reload takes the server's arrangement and dismisses itself", async () => {
    const conflict = Object.assign(new Error("changed"), { status: 409 });
    api.put.mockRejectedValue(conflict);
    renderGrid();
    const user = await beginEditing();

    await choose(user, "Widget core/a", "Move later");
    await user.click(screen.getByTestId("dashboard-edit-save"));
    await screen.findByTestId("dashboard-edit-conflict");

    layoutResponse = layout([
      { id: "p3", widgetId: "core/c" },
      { id: "p1", widgetId: "core/a" },
      { id: "p2", widgetId: "core/b" },
    ]);
    await user.click(screen.getByTestId("dashboard-edit-reload"));

    await waitFor(() =>
      expect(drawnOrder()).toEqual(["core/c", "core/a", "core/b"])
    );
    expect(screen.queryByTestId("dashboard-edit-conflict")).toBeNull();
    expect(screen.getByTestId("dashboard-edit-begin")).toBeInTheDocument();
  });
});

describe("resetting to the default dashboard", () => {
  beforeEach(() => {
    layoutResponse = layout(
      [
        { id: "p3", widgetId: "core/c", width: "quarter" },
        { id: "p1", widgetId: "core/a" },
      ],
      {
        defaultPlacements: [
          { id: "core/a", widgetId: "core/a", width: "half", removed: false },
          { id: "core/b", widgetId: "core/b", width: "half", removed: false },
          { id: "core/c", widgetId: "core/c", width: "full", removed: false },
        ],
      }
    );
  });

  it("asks first, and keeping the layout changes nothing", async () => {
    renderGrid();
    const user = await beginEditing();

    await user.click(screen.getByTestId("dashboard-edit-reset"));
    const ask = await screen.findByRole("alertdialog");
    expect(ask).toHaveTextContent("Reset to the default dashboard?");
    expect(ask).toHaveTextContent(
      "Your cards, widths and settings will be replaced."
    );
    await user.click(
      within(ask).getByRole("button", { name: "Keep my layout" })
    );

    expect(drawnOrder()).toEqual(["core/c", "core/a"]);
    expect(screen.getByTestId("dashboard-edit-save")).toBeDisabled();
  });

  it("draws the default once confirmed, says so, and writes NOTHING", async () => {
    renderGrid();
    const user = await beginEditing();

    await user.click(screen.getByTestId("dashboard-edit-reset"));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Reset dashboard",
      })
    );

    expect(drawnOrder()).toEqual(["core/a", "core/b", "core/c"]);
    expect(live()).toHaveTextContent(
      "Dashboard reset to the default. Save to keep it."
    );
    expect(screen.getByTestId("dashboard-edit-status")).toHaveTextContent(
      "Showing the default dashboard."
    );
    // 🔴 Staged, not performed: nothing reaches the server until Save.
    expect(api.delete).not.toHaveBeenCalled();
    expect(api.put).not.toHaveBeenCalled();
    expect(screen.getByTestId("dashboard-edit-save")).toBeEnabled();
  });

  it("Cancel brings the reader's own arrangement back", async () => {
    renderGrid();
    const user = await beginEditing();
    await user.click(screen.getByTestId("dashboard-edit-reset"));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Reset dashboard",
      })
    );

    await user.click(screen.getByTestId("dashboard-edit-cancel"));

    expect(drawnOrder()).toEqual(["core/c", "core/a"]);
    expect(api.delete).not.toHaveBeenCalled();
  });

  it("Save of an untouched staged reset DELETES, with the draft's version and scope", async () => {
    renderGrid();
    const user = await beginEditing();
    await user.click(screen.getByTestId("dashboard-edit-reset"));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Reset dashboard",
      })
    );

    await user.click(screen.getByTestId("dashboard-edit-save"));

    await waitFor(() => expect(api.delete).toHaveBeenCalledTimes(1));
    expect(api.delete).toHaveBeenCalledWith(
      "/dashboard/layout?version=3&scope=tok"
    );
    expect(api.put).not.toHaveBeenCalled();
  });

  it("Save PUTs the arrangement once the reader changed the staged default", async () => {
    renderGrid();
    const user = await beginEditing();
    await user.click(screen.getByTestId("dashboard-edit-reset"));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Reset dashboard",
      })
    );
    await choose(user, "Widget core/a", "Move to end");

    await user.click(screen.getByTestId("dashboard-edit-save"));

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(api.delete).not.toHaveBeenCalled();
    expect(putBody().placements.map(p => p.id)).toEqual([
      "core/b",
      "core/c",
      "core/a",
    ]);
  });

  it("is not offered when there is no stored row at all", async () => {
    layoutResponse = layout([{ id: "p1", widgetId: "core/a" }], {
      source: "default",
      version: 0,
    });
    renderGrid();
    await beginEditing();
    expect(screen.queryByTestId("dashboard-edit-reset")).toBeNull();
  });
});

describe("a stored dashboard the server could not read", () => {
  beforeEach(() => {
    layoutResponse = layout(
      [
        { id: "p1", widgetId: "core/a" },
        { id: "p2", widgetId: "core/b" },
      ],
      { source: "unreadable", version: 7 }
    );
  });

  it("says so above the grid", async () => {
    renderGrid();
    expect(await screen.findByTestId("dashboard-unreadable")).toHaveTextContent(
      "Your saved dashboard couldn't be loaded, so you're seeing the default. Saving from Customize replaces the saved one."
    );
  });

  it("asks before Save replaces it, and sends nothing on Cancel", async () => {
    renderGrid();
    const user = await beginEditing();
    await choose(user, "Widget core/a", "Move later");

    await user.click(screen.getByTestId("dashboard-edit-save"));
    const ask = await screen.findByRole("alertdialog");
    expect(ask).toHaveTextContent("Replace your saved dashboard?");
    expect(ask).toHaveTextContent(
      "It couldn't be loaded, and saving replaces it with this layout."
    );
    await user.click(within(ask).getByRole("button", { name: "Cancel" }));

    expect(api.put).not.toHaveBeenCalled();
    expect(drawnOrder()).toEqual(["core/b", "core/a"]);
  });

  it("saves with replaceUnreadable only once the reader confirms", async () => {
    renderGrid();
    const user = await beginEditing();
    await choose(user, "Widget core/a", "Move later");

    await user.click(screen.getByTestId("dashboard-edit-save"));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Replace and save",
      })
    );

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(putBody().replaceUnreadable).toBe(true);
    expect(putBody().arranged).toBe(true);
  });

  it("does not ask, or claim to replace, for a readable dashboard", async () => {
    // The control: a save that always sent the flag, or always asked, would
    // pass the case above.
    layoutResponse = layout([
      { id: "p1", widgetId: "core/a" },
      { id: "p2", widgetId: "core/b" },
    ]);
    renderGrid();
    const user = await beginEditing();
    await choose(user, "Widget core/a", "Move later");
    await user.click(screen.getByTestId("dashboard-edit-save"));

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(putBody()).not.toHaveProperty("replaceUnreadable");
  });
});

describe("a widget that draws nothing", () => {
  it("leaves its grid cell with no children, so `empty:hidden` can collapse it", async () => {
    // 🔴 The cell hides itself through CSS `:empty`, which counts ELEMENT
    // CHILDREN rather than rendered output.
    registerCoreComponent("core#Nothing", () => null);
    mockBranding = {
      widgets: [
        {
          id: "core/silent",
          title: "Silent",
          archetype: "custom",
          defaultSize: "full",
          chrome: "none",
          component: "core#Nothing",
        },
      ],
    } as unknown as AdminBranding;
    layoutResponse = layout([{ id: "p1", widgetId: "core/silent" }]);
    renderGrid();

    const cell = await screen.findByTestId("widget-cell-core/silent");
    expect(cell.childElementCount).toBe(0);
  });

  it("DOES fill its cell when the same widget is framed", async () => {
    registerCoreComponent("core#Nothing", () => null);
    mockBranding = {
      widgets: [
        {
          id: "core/framed",
          title: "Framed",
          archetype: "custom",
          defaultSize: "full",
          component: "core#Nothing",
        },
      ],
    } as unknown as AdminBranding;
    layoutResponse = layout([{ id: "p1", widgetId: "core/framed" }]);
    renderGrid();

    expect(
      (await screen.findByTestId("widget-cell-core/framed")).childElementCount
    ).toBeGreaterThan(0);
  });

  it("gives an unframed card a small header of its own while customising", async () => {
    mockBranding = branding(["core/a"], { "core/a": { chrome: "none" } });
    layoutResponse = layout([{ id: "p1", widgetId: "core/a" }]);
    renderGrid();
    await beginEditing();

    const header = screen.getByTestId("widget-edit-header");
    expect(header).toHaveTextContent("Widget core/a");
    expect(within(header).getByTestId("card-actions")).toBeInTheDocument();
  });
});

describe("when the schema changes underneath an open dashboard", () => {
  it("re-reads the arrangement, so the add panel knows what exists now", () => {
    renderGrid();

    return waitFor(() => expect(api.get).toHaveBeenCalledTimes(1)).then(() => {
      act(() => {
        window.dispatchEvent(new Event("nextly:schema-updated"));
      });
      return waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    });
  });

  it("does not re-read on an unrelated event", () => {
    renderGrid();

    return waitFor(() => expect(api.get).toHaveBeenCalledTimes(1)).then(() => {
      act(() => {
        window.dispatchEvent(new Event("nextly:something-else"));
      });
      expect(api.get).toHaveBeenCalledTimes(1);
    });
  });
});

describe("below the md breakpoint", () => {
  // jsdom lays nothing out; what is asserted is the CAUSE -- the responsive
  // classes -- on the exact elements the fold applies to.

  it("does not offer customising: the entry control is hidden until md", async () => {
    renderGrid();
    const offer = await screen.findByTestId("dashboard-edit-offer");
    expect(offer).toHaveClass("hidden", "md:flex");
    expect(offer).toContainElement(screen.getByTestId("dashboard-edit-begin"));
  });

  it("keeps the way OUT at every width once customising is under way", async () => {
    renderGrid();
    await beginEditing();
    const bar = screen.getByTestId("dashboard-edit-cancel").parentElement;
    expect(bar).not.toBeNull();
    expect(bar).not.toHaveClass("hidden");
    expect(screen.queryByTestId("dashboard-edit-offer")).toBeNull();
  });

  it("tells a narrow-screen reader the way back is a larger screen", async () => {
    layoutResponse = layout([{ id: "p1", widgetId: "core/a", removed: true }]);
    renderGrid();
    const empty = await screen.findByTestId("widget-grid-empty");
    const wide = screen.getByText(/Customize it to bring one back/);
    const narrow = screen.getByText(/Customize it on a larger screen/);
    expect(empty).toContainElement(wide);
    expect(empty).toContainElement(narrow);
    expect(wide).toHaveClass("hidden", "md:inline");
    expect(narrow).toHaveClass("md:hidden");
  });
});

describe("an arrangement with nothing left on it", () => {
  it("KEEPS the way back when every card is removed", async () => {
    // 🔴 An arrangement must never reach a state it cannot leave: the
    // customise chrome outlives the rows.
    layoutResponse = layout([
      { id: "p1", widgetId: "core/a", removed: true },
      { id: "p2", widgetId: "core/b", removed: true },
    ]);
    renderGrid();

    expect(
      await screen.findByTestId("dashboard-edit-begin")
    ).toBeInTheDocument();
    expect(screen.getByTestId("widget-grid-empty")).toBeInTheDocument();
    expect(screen.queryAllByTestId(/^widget-cell-/)).toHaveLength(0);

    // And the way back WORKS: the add panel offers both cards to put back.
    const user = userEvent.setup();
    await user.click(screen.getByTestId("dashboard-edit-begin"));
    const panel = await openAddPanel(user);
    expect(
      within(panel).getByRole("button", { name: "Add back Widget core/a" })
    ).toBeInTheDocument();
    await user.click(
      within(panel).getByRole("button", { name: "Add back Widget core/b" })
    );
    expect(drawnOrder()).toEqual(["core/b"]);
  });
});

describe("a card's rows follow its reader's settings", () => {
  it("draws the number of items its reader chose, not the declared number", async () => {
    // Declared at five, set to eight by the reader. The batch asks for eight and one more; the
    // card must draw the eight it asked for, not slice to the declaration's five and say more
    // exist.
    mockBranding = branding(["acme/posts"], {
      "acme/posts": {
        archetype: "list",
        component: undefined,
        query: {
          source: "collection:posts",
          op: "list",
          select: ["title"],
          limit: 5,
        },
        settings: [
          { name: "limit", type: "number", label: "Items", defaultValue: 5 },
        ],
      },
    });
    layoutResponse = layout([
      { id: "p1", widgetId: "acme/posts", config: { limit: 8 } },
    ]);
    api.post.mockResolvedValue({
      results: [
        {
          ok: true,
          result: {
            op: "list",
            items: Array.from({ length: 9 }, (_, i) => ({
              title: `Post ${i + 1}`,
            })),
          },
        },
      ],
    });
    renderGrid();

    await waitFor(() =>
      expect(screen.getAllByTestId("widget-list-row")).toHaveLength(8)
    );
    // The latest request: one may leave before the reader's layout is read, asked as declared.
    const asked = api.post.mock.calls.at(-1)?.[1] as {
      queries: Array<{ limit?: number }>;
    };
    expect(asked.queries[0].limit).toBe(9);
  });
});
