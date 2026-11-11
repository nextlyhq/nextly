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
import { MAX_PLACEMENTS } from "nextly/config";

import { WelcomeHeader } from "../../../dashboard/WelcomeHeader";
import { FrameState } from "../../frame/card-state";
import { WidgetGrid } from "../../WidgetGrid";
import { preloadWidgetSettingsSheet } from "../settings-sheet-code";
import {
  resizeDashboard,
  stubDashboardWidth,
  unstubDashboardWidth,
} from "../../__tests__/dashboard-width";

import { galleryFromLayout, isGalleryPath } from "./gallery-read";

let mockBranding: AdminBranding | undefined;
let layoutResponse: DashboardLayoutResponse | undefined;
let layoutRejects = false;

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

/**
 * How many times the arrangement was read. The dashboard's header also reads the setup card's
 * own state (`/dashboard/setup`), which is not the arrangement.
 */
const layoutReads = () =>
  api.get.mock.calls.filter(([path]) => path.startsWith("/dashboard/layout"))
    .length;

/** Full width three rows high by default, resizable from 3 by 2 up to 12 by 6. */
const RESIZABLE = {
  default: { w: 12, h: 3 },
  min: { w: 3, h: 2 },
  max: { w: 12, h: 6 },
};

/** Six by three by default, and from 4 by 2 up to 8 by 4: bounds short of both ends. */
const BOUNDED = {
  default: { w: 6, h: 3 },
  min: { w: 4, h: 2 },
  max: { w: 8, h: 4 },
};

/**
 * Registered widgets, each drawn by its own component, which this file registers: every card is
 * asked for by its id and answered (see the `post` stand-in below).
 */
function branding(
  ids: string[],
  patch: Record<string, Record<string, unknown>> = {}
): AdminBranding {
  return {
    widgets: ids.map(id => ({
      id,
      title: `Widget ${id}`,
      archetype: "custom",
      size: RESIZABLE,
      component: "core#Whatever",
      ...patch[id],
    })),
  } as unknown as AdminBranding;
}

/** Facts for a widget, one card only unless told otherwise. */
function facts(patch: Partial<WidgetLayoutFacts> = {}): WidgetLayoutFacts {
  return {
    allowsSeveral: false,
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
    w: 12,
    h: 3,
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
    // A row of dismissals at most: the reader still follows the default.
    arranged: false,
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
  // The page's header and grid, as the page composes them: Customize is the header's.
  return {
    client,
    ...render(
      <>
        <WelcomeHeader />
        <WidgetGrid />
      </>,
      { wrapper: Wrapper }
    ),
  };
}

// The cards' own component, so each card draws its answer rather than a missing component's
// error, which the grid would count and announce as a failure.
registerCoreComponent("core#Whatever", () => <p>Body</p>);

// The settings drawer's code loads apart from the dashboard's. Fetched once here, so a test
// opening the drawer meets its form rather than its loading screen.
beforeAll(async () => {
  preloadWidgetSettingsSheet();
  await import("../CellSettings");
});

beforeEach(() => {
  // jsdom lays nothing out; the grid asks nothing until its dashboard has a width.
  stubDashboardWidth();
  vi.clearAllMocks();
  // Every card answered with data of nothing in particular, so its component draws; a case
  // about what a card shows answers its own.
  api.post.mockImplementation((_path: string, body: unknown) =>
    Promise.resolve({
      results: (body as { queries: unknown[] }).queries.map(() => ({
        ok: true,
        result: { op: "data", data: null },
      })),
    })
  );
  layoutRejects = false;
  mockBranding = branding(["core/a", "core/b", "core/c"]);
  layoutResponse = layout([
    { id: "p1", widgetId: "core/a" },
    { id: "p2", widgetId: "core/b" },
    { id: "p3", widgetId: "core/c" },
  ]);
  api.get.mockImplementation((path: string) => {
    if (layoutRejects) return Promise.reject(new Error("layout unavailable"));
    // The gallery read the layout fixture implies, read when the add panel opens.
    if (isGalleryPath(path) && layoutResponse !== undefined) {
      return Promise.resolve(
        galleryFromLayout(layoutResponse, mockBranding?.widgets ?? [])
      );
    }
    return Promise.resolve(layoutResponse);
  });
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

/**
 * Leaves customise mode from the bar's Cancel, agreeing to discard when the
 * mode asks first (it asks only while there are unsaved changes).
 */
async function cancelEditing(
  user: ReturnType<typeof userEvent.setup>
): Promise<void> {
  await user.click(screen.getByTestId("dashboard-edit-cancel"));
  const ask = screen.queryByTestId("dashboard-leave-ask");
  if (ask !== null) {
    await user.click(
      within(ask).getByRole("button", { name: "Discard changes" })
    );
  }
  await screen.findByTestId("dashboard-edit-begin");
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

/** Opens a card's settings drawer from its menu, and returns its Width, once it has loaded. */
async function openSizes(
  user: ReturnType<typeof userEvent.setup>,
  title: string
) {
  await choose(user, title, "Settings…");
  return screen.findByRole("radiogroup", { name: "Width" });
}

/** Chooses a width in the open drawer and saves it, which stages it in customise mode. */
async function chooseWidth(
  user: ReturnType<typeof userEvent.setup>,
  widths: HTMLElement,
  name: string
) {
  await user.click(within(widths).getByRole("radio", { name }));
  // The drawer's own Save, not the customise bar's.
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Save" })
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
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

  it("draws each card at its STORED size, not the declaration's", async () => {
    // The widgets declare 12 by 3; the placement says 3 by 5.
    layoutResponse = layout([{ id: "p1", widgetId: "core/a", w: 3, h: 5 }]);
    renderGrid();
    await screen.findByTestId("dashboard-edit-begin");
    const cell = screen.getByTestId("widget-cell-core/a");
    expect(cell).toHaveClass("@min-[1024px]/dashboard:col-span-3");
    // Its stored rows set no height: no row span, the card as tall as its content.
    expect(cell.style.gridRow).toBe("");
  });

  it("draws a stored size outside its widget's bounds at the nearest size inside them", async () => {
    // Stored 12 by 6; the widget's bounds have narrowed to at most 8 by 4, and at least 4 by 2.
    mockBranding = branding(["core/a", "core/b", "core/c"], {
      "core/a": { size: BOUNDED },
      "core/b": { size: BOUNDED },
    });
    layoutResponse = layout([
      { id: "p1", widgetId: "core/a", w: 12, h: 6 },
      { id: "p2", widgetId: "core/b", w: 1, h: 2 },
    ]);
    renderGrid();
    await screen.findByTestId("dashboard-edit-begin");
    const clamped = screen.getByTestId("widget-cell-core/a");
    expect(clamped).toHaveClass("@min-[1024px]/dashboard:col-span-8");
    // Too narrow is widened.
    const widened = screen.getByTestId("widget-cell-core/b");
    expect(widened).toHaveClass("@min-[1024px]/dashboard:col-span-4");
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

  it("shows each card's size beside its menu, as its share of the row", async () => {
    layoutResponse = layout([
      { id: "p1", widgetId: "core/a", w: 6, h: 3 },
      { id: "p2", widgetId: "core/b", w: 3, h: 4 },
    ]);
    renderGrid();
    await beginEditing();
    const labels = screen.getAllByTestId("card-size-label");
    expect(labels.map(label => label.textContent)).toEqual([
      "50%50% wide",
      "25%25% wide",
    ]);
  });

  it("shows no menu outside customise mode", async () => {
    renderGrid();
    await screen.findByTestId("dashboard-edit-begin");
    expect(screen.queryAllByTestId("card-actions")).toHaveLength(0);
  });
});

describe("moving a card from its menu", () => {
  it("offers Move earlier and Move later, disabling the one a card at an end cannot make", async () => {
    renderGrid();
    const user = await beginEditing();

    let menu = await openMenu(user, "Widget core/a");
    const item = (name: string) => within(menu).getByRole("menuitem", { name });
    expect(item("Move earlier")).toHaveAttribute("aria-disabled", "true");
    expect(item("Move later")).not.toHaveAttribute("aria-disabled");
    expect(
      within(menu).queryByRole("menuitem", { name: /Move to/ })
    ).toBeNull();
    await user.keyboard("{Escape}");

    menu = await openMenu(user, "Widget core/c");
    expect(item("Move later")).toHaveAttribute("aria-disabled", "true");
    expect(item("Move earlier")).not.toHaveAttribute("aria-disabled");
  });

  it("moves it, and says where from and where to", async () => {
    renderGrid();
    const user = await beginEditing();

    await choose(user, "Widget core/a", "Move later");

    expect(drawnOrder()).toEqual(["core/b", "core/a", "core/c"]);
    expect(live()).toHaveTextContent("Widget core/a moved from 1 to 2 of 3.");
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

describe("choosing a width in the settings drawer while customising", () => {
  beforeEach(() => {
    mockBranding = branding(["core/a", "core/b", "core/c"], {
      "core/a": { size: BOUNDED },
    });
    layoutResponse = layout([{ id: "p1", widgetId: "core/a", w: 6, h: 3 }]);
  });

  it("lists the named widths within the widget's bounds and its ends, the current one checked", async () => {
    renderGrid();
    const user = await beginEditing();

    const widths = await openSizes(user, "Widget core/a");
    const items = within(widths).getAllByRole("radio");
    // 🔴 Never past the bounds: no 3 below the minimum, no 12 above the maximum.
    expect(items.map(i => i.getAttribute("aria-label"))).toEqual([
      "33% width",
      "50% width",
      "66% width",
    ]);
    const half = within(widths).getByRole("radio", { name: "50% width" });
    expect(half).toHaveAttribute("aria-checked", "true");
    // Drawn as the design names it: the percent.
    expect(half).toHaveTextContent(/^50%$/);
  });

  it("offers no Height, though the widget's bounds allow several", async () => {
    // 🔴 `core/a` may be two to six rows high: a card is as tall as its content, so its stored
    // rows are not offered to change, in the menu or in the drawer.
    renderGrid();
    const user = await beginEditing();
    const menu = await openMenu(user, "Widget core/a");
    expect(within(menu).queryByText(/Height|Width/)).toBeNull();
    await user.keyboard("{Escape}");
    await openSizes(user, "Widget core/a");
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Height follows the content."
    );
    expect(screen.queryByRole("radiogroup", { name: /Height/ })).toBeNull();
  });

  it("applies a width at once, keeping the stored h, and says so by the width alone", async () => {
    renderGrid();
    const user = await beginEditing();

    const widths = await openSizes(user, "Widget core/a");
    await chooseWidth(user, widths, "33% width");

    expect(screen.getByTestId("widget-cell-core/a")).toHaveClass(
      "@min-[1024px]/dashboard:col-span-4"
    );
    expect(live()).toHaveTextContent("Widget core/a set to 33% wide.");
    expect(screen.getByTestId("card-size-label").textContent).toBe(
      "33%33% wide"
    );
    // Nothing written until Save.
    expect(api.put).not.toHaveBeenCalled();
    await user.click(screen.getByTestId("dashboard-edit-save"));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(putBody().placements[0]).toMatchObject({ w: 4, h: 3 });
  });

  it("checks the DRAWN size when the stored one is outside the bounds, and saves it unchanged", async () => {
    layoutResponse = layout([
      { id: "p1", widgetId: "core/a", w: 12, h: 6 },
      { id: "p2", widgetId: "core/b" },
    ]);
    renderGrid();
    const user = await beginEditing();

    const widths = await openSizes(user, "Widget core/a");
    expect(
      within(widths).getByRole("radio", { name: "66% width" })
    ).toHaveAttribute("aria-checked", "true");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // An unrelated change saves the stored size as it was: it is kept until
    // its owner changes it.
    await choose(user, "Widget core/b", "Move earlier");
    await user.click(screen.getByTestId("dashboard-edit-save"));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(putBody().placements.find(p => p.id === "p1")).toMatchObject({
      w: 12,
      h: 6,
    });
  });
});

/**
 * Answers the dashboard's first batch and leaves every batch after it on its way, so the grid's
 * live region says only what the reader's own change did, never a later batch's news beside it.
 */
function answerFirstBatchOnly(): void {
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
}

describe("removing a card", () => {
  beforeEach(answerFirstBatchOnly);

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

  it("rings the card Undo puts back, as putting it back from the add panel does", async () => {
    // 🔴 Undo restored the card through its own path, which had no reach to the ring, so the
    // card came back unmarked while the same card put back from the panel was ringed.
    renderGrid();
    const user = await beginEditing();
    await choose(user, "Widget core/b", "Remove");
    await user.click(screen.getByTestId("removal-notice-undo"));

    expect(screen.getByTestId("widget-cell-core/b")).toHaveAttribute(
      "data-highlighted"
    );
    expect(screen.getByTestId("widget-cell-core/a")).not.toHaveAttribute(
      "data-highlighted"
    );
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
      { id: "p2", widgetId: "core/b", w: 4, h: 3, config: { limit: 4 } },
    ]);
    renderGrid();
    const user = await beginEditing();
    await choose(user, "Widget core/b", "Remove");
    await user.click(screen.getByTestId("dashboard-edit-save"));

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(putBody().placements).toEqual([
      { id: "p1", widgetId: "core/a", w: 12, h: 3, removed: false },
      {
        id: "p2",
        widgetId: "core/b",
        w: 4,
        h: 3,
        removed: true,
        config: { limit: 4 },
      },
    ]);
  });

  it("puts a removed one-card widget back in place from its Add, with no list of removed cards", async () => {
    renderGrid();
    const user = await beginEditing();
    await choose(user, "Widget core/a", "Remove");

    const panel = await openAddPanel(user);
    expect(within(panel).queryAllByRole("heading", { level: 3 })).toEqual([]);
    await user.click(
      within(panel).getByRole("button", { name: "Add Widget core/a" })
    );

    expect(drawnOrder()).toEqual(["core/a", "core/b", "core/c"]);
    // The panel says it, since a modal sheet hides the grid's own region.
    expect(within(panel).getByTestId("add-panel-live")).toHaveTextContent(
      "Added Widget core/a."
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

  it("appends the card at the widget's default size", async () => {
    mockBranding = branding(["core/a", "core/d"], {
      "core/d": { size: { default: { w: 4, h: 3 } } },
    });
    layoutResponse = layout([{ id: "p1", widgetId: "core/a" }], {
      available: ["core/d"],
      widgets: {
        "core/a": facts(),
        "core/d": facts(),
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
      "Added Widget core/d."
    );

    await closeAddPanel(user);
    await user.click(screen.getByTestId("dashboard-edit-save"));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(putBody().placements[1]).toEqual({
      id: "core/d",
      widgetId: "core/d",
      w: 4,
      h: 3,
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
    await user.click(screen.getByRole("button", { name: "Add Widget core/d" }));
    expect(screen.getAllByTestId("widget-cell-core/d")).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Add Widget core/d" })
    ).toBeEnabled();

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

  it("rings the card just added, scrolls it into view, and closing sends focus to its menu", async () => {
    mockBranding = branding(["core/a", "core/d"]);
    layoutResponse = layout([{ id: "p1", widgetId: "core/a" }], {
      available: ["core/d"],
      widgets: { "core/a": facts(), "core/d": facts() },
    });
    renderGrid();
    const user = await beginEditing();

    await openAddPanel(user);
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
    await user.click(screen.getByTestId("add-panel-add-core/d"));
    expect(screen.getByTestId("widget-cell-core/d")).toHaveAttribute(
      "data-highlighted"
    );
    // Brought into view while the panel stays open, focus still in it.
    await waitFor(() =>
      expect(scrolled.mock.contexts).toContain(
        screen.getByTestId("widget-cell-core/d")
      )
    );
    scrolled.mockRestore();
    expect(screen.getByTestId("widget-cell-core/a")).not.toHaveAttribute(
      "data-highlighted"
    );

    await closeAddPanel(user);
    await waitFor(() =>
      expect(document.activeElement).toBe(menuButton("Widget core/d"))
    );
  });

  it("forgets the last visit's card: a later visit closed with nothing added goes to Add widget", async () => {
    // 🔴 The bar opens the panel by setting its state, so a reset kept in the sheet's own open
    // callback never ran, and the later visit sent focus to the card the earlier one added.
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
    await waitFor(() =>
      expect(document.activeElement).toBe(menuButton("Widget core/d"))
    );

    await openAddPanel(user);
    await closeAddPanel(user);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Add widget" })
      )
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
        { id: "p2", widgetId: "core/b", w: 12, h: 3, removed: false },
        { id: "p1", widgetId: "core/a", w: 12, h: 3, removed: false },
        { id: "p3", widgetId: "core/c", w: 12, h: 3, removed: false },
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
    expect(layoutReads()).toBe(2);

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
    await cancelEditing(user);

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

    await cancelEditing(user);

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
    answerFirstBatchOnly();
    layoutResponse = layout(
      [
        { id: "p3", widgetId: "core/c", w: 3, h: 3 },
        { id: "p1", widgetId: "core/a" },
      ],
      {
        defaultPlacements: [
          { id: "core/a", widgetId: "core/a", w: 6, h: 3, removed: false },
          { id: "core/b", widgetId: "core/b", w: 6, h: 3, removed: false },
          { id: "core/c", widgetId: "core/c", w: 12, h: 3, removed: false },
        ],
      }
    );
  });

  it("rings no card once the reset is staged, even one the default reuses", async () => {
    // 🔴 The ring outlived the reset: a layout saved from the defaults reuses their placement
    // ids, so the card ringed for the last move came back ringed, as if Reset had placed it.
    layoutResponse = layout(
      [
        { id: "core/a", widgetId: "core/a" },
        { id: "core/b", widgetId: "core/b" },
      ],
      {
        defaultPlacements: [
          { id: "core/a", widgetId: "core/a", w: 6, h: 3, removed: false },
          { id: "core/b", widgetId: "core/b", w: 6, h: 3, removed: false },
          { id: "core/c", widgetId: "core/c", w: 12, h: 3, removed: false },
        ],
      }
    );
    renderGrid();
    const user = await beginEditing();
    await choose(user, "Widget core/b", "Move earlier");
    expect(screen.getByTestId("widget-cell-core/b")).toHaveAttribute(
      "data-highlighted"
    );

    await user.click(screen.getByTestId("dashboard-edit-reset"));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Reset dashboard",
      })
    );

    expect(drawnOrder()).toEqual(["core/a", "core/b", "core/c"]);
    expect(screen.getByTestId("widget-cell-core/b")).not.toHaveAttribute(
      "data-highlighted"
    );
  });

  it("asks first, and keeping the layout changes nothing", async () => {
    renderGrid();
    const user = await beginEditing();

    await user.click(screen.getByTestId("dashboard-edit-reset"));
    const ask = await screen.findByRole("alertdialog");
    expect(ask).toHaveTextContent("Reset to the default dashboard?");
    expect(ask).toHaveTextContent(
      "Your cards, sizes and settings will be replaced."
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

    await cancelEditing(user);

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
    await choose(user, "Widget core/a", "Move later");
    await choose(user, "Widget core/a", "Move later");

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
      arranged: false,
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
      "Your saved dashboard couldn't be loaded, so you're seeing the default. Saving from Customize dashboard replaces the saved one."
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
  it("still fills its cell with its frame: no card is left blank or unframed", async () => {
    registerCoreComponent("core#Nothing", () => null);
    mockBranding = {
      widgets: [
        {
          id: "core/framed",
          title: "Framed",
          archetype: "custom",
          size: RESIZABLE,
          component: "core#Nothing",
        },
      ],
    } as unknown as AdminBranding;
    layoutResponse = layout([{ id: "p1", widgetId: "core/framed" }]);
    renderGrid();

    const cell = await screen.findByTestId("widget-cell-core/framed");
    expect(
      within(cell).getByRole("region", { name: "Framed" })
    ).toBeInTheDocument();
  });

  it("is taken out of the grid only through its frame's hidden-while-empty mark", async () => {
    // jsdom evaluates no CSS, so the two halves are asserted: the cell's rule
    // asks for the frame's mark, and `WidgetCard` sets the mark only for an
    // empty card whose widget hides (its own tests).
    mockBranding = branding(["core/a"]);
    layoutResponse = layout([{ id: "p1", widgetId: "core/a" }]);
    renderGrid();
    const cell = await screen.findByTestId("widget-cell-core/a");
    expect(cell).toHaveClass("has-[[data-hidden-empty]]:hidden");
    expect(cell.className).not.toContain("empty:hidden");
  });
});

describe("when the schema changes underneath an open dashboard", () => {
  it("re-reads the arrangement, so the add panel knows what exists now", () => {
    renderGrid();

    return waitFor(() => expect(layoutReads()).toBe(1)).then(() => {
      act(() => {
        window.dispatchEvent(new Event("nextly:schema-updated"));
      });
      return waitFor(() => expect(layoutReads()).toBe(2));
    });
  });

  it("does not re-read on an unrelated event", () => {
    renderGrid();

    return waitFor(() => expect(layoutReads()).toBe(1)).then(() => {
      act(() => {
        window.dispatchEvent(new Event("nextly:something-else"));
      });
      expect(layoutReads()).toBe(1);
    });
  });
});

describe("the drag handle and the resize edge", () => {
  it("draws each card's handle over its header's leading slot, before the title, for a pointer only", async () => {
    renderGrid();
    await beginEditing();
    for (const id of ["core/a", "core/b", "core/c"]) {
      const cell = screen.getByTestId(`widget-cell-${id}`);
      const handle = within(cell).getByTestId("widget-drag-handle");
      // Read by no screen reader and reached by no Tab: the menu's Move earlier and Move later
      // are the keyboard's way.
      expect(handle).toHaveAttribute("aria-hidden", "true");
      expect(handle).not.toHaveAttribute("tabindex");
      const header = within(cell).getByTestId("widget-card-header");
      const space = within(header).getByTestId("card-handle-space");
      // The header's first part, so the title starts after it on the header's own row.
      expect(header.firstElementChild).toContainElement(space);
      const title = within(header).getByRole("heading", { level: 2 });
      expect(
        space.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    }
  });

  it("keeps no room for a handle at rest", async () => {
    renderGrid();
    await screen.findAllByTestId("widget-card-header");
    expect(screen.queryAllByTestId("widget-drag-handle")).toEqual([]);
    expect(screen.queryAllByTestId("card-handle-space")).toEqual([]);
  });

  it("draws a right edge on each card with more than one width, and none on a card bounded 5 to 5", async () => {
    mockBranding = branding(["core/a", "core/b", "core/c"], {
      "core/b": {
        size: {
          default: { w: 5, h: 2 },
          min: { w: 5, h: 2 },
          max: { w: 5, h: 2 },
        },
      },
    });
    renderGrid();
    await beginEditing();
    const edgeOf = (id: string) =>
      within(screen.getByTestId(`widget-cell-${id}`)).queryByTestId(
        "widget-resize-edge"
      );
    expect(edgeOf("core/a")).not.toBeNull();
    expect(edgeOf("core/b")).toBeNull();
    expect(edgeOf("core/c")).not.toBeNull();
  });

  it("draws no edge below 1,024px, where the card's settings set its width, and keeps the handles", async () => {
    stubDashboardWidth(1000);
    renderGrid();
    await beginEditing();
    expect(screen.queryAllByTestId("widget-resize-edge")).toEqual([]);
    expect(screen.getAllByTestId("widget-drag-handle")).toHaveLength(3);
  });
});

describe("at one column", () => {
  // jsdom lays nothing out; the dashboard's width is stubbed, as the grid measures it.

  it("offers customising at every width", async () => {
    stubDashboardWidth(390);
    renderGrid();
    const begin = await screen.findByTestId("dashboard-edit-begin");
    expect(begin).not.toHaveClass("hidden");
    expect(begin).toHaveAccessibleName("Customize dashboard");
  });

  it("draws no handle, and leaves every move to the card menu", async () => {
    stubDashboardWidth(390);
    renderGrid();
    const user = await beginEditing();
    expect(screen.queryAllByTestId("widget-drag-handle")).toEqual([]);

    await choose(user, "Widget core/c", "Move earlier");
    expect(drawnOrder()).toEqual(["core/a", "core/c", "core/b"]);
  });

  it("sets the width in the full-width drawer, the menu holding no sizes", async () => {
    // On a phone the drawer takes the whole width; the menu stays short.
    mockBranding = branding(["core/a", "core/b", "core/c"], {
      "core/a": { size: BOUNDED },
    });
    layoutResponse = layout([{ id: "p1", widgetId: "core/a", w: 6, h: 3 }]);
    stubDashboardWidth(390);
    renderGrid();
    const user = await beginEditing();

    const menu = await openMenu(user, "Widget core/a");
    expect(within(menu).queryByRole("menuitemradio")).toBeNull();
    await user.keyboard("{Escape}");
    const widths = await openSizes(user, "Widget core/a");
    expect(screen.getByRole("dialog")).toHaveClass("w-full");
    await chooseWidth(user, widths, "33% width");
    expect(screen.getByTestId("card-size-label").textContent).toBe(
      "33%33% wide"
    );
  });

  it("keeps the drag library's sensors the same size while the dashboard narrows to one column", async () => {
    // 🔴 The drag context swapped its sensors for none at one column, and dnd-kit reads the
    // list as an effect's dependencies: every narrowing changed the list's size, which React
    // warns of and does not promise to handle. That a drag still cannot start at one column is
    // "draws no handle, and leaves every move to the card menu", above.
    const errors = vi.spyOn(console, "error");
    try {
      renderGrid();
      await beginEditing();
      resizeDashboard(390);
      await waitFor(() =>
        expect(screen.queryAllByTestId("widget-drag-handle")).toEqual([])
      );
      resizeDashboard(1200);
      await waitFor(() =>
        expect(
          screen.getAllByTestId("widget-drag-handle").length
        ).toBeGreaterThan(0)
      );
      const sizeChanges = errors.mock.calls.filter(args =>
        String(args[0]).includes("changed size between renders")
      );
      expect(sizeChanges).toEqual([]);
    } finally {
      errors.mockRestore();
    }
  });

  it("tells a reader with an empty dashboard to customise it, at any width", async () => {
    layoutResponse = layout([{ id: "p1", widgetId: "core/a", removed: true }]);
    renderGrid();
    expect(await screen.findByTestId("widget-grid-empty")).toHaveTextContent(
      "Your dashboard has no cards on it. Customize it to bring one back, or reset to the default dashboard."
    );
  });
});

describe("an arrangement whose every card is not shown for its reader", () => {
  it("tells them their dashboard is empty at rest, and still lists the cards while customising", async () => {
    // Each card is taken off the dashboard; counted as on show, they left it blank instead.
    mockBranding = branding(["acme/posts"], {
      "acme/posts": {
        archetype: "list",
        component: undefined,
      },
    });
    layoutResponse = layout([{ id: "p1", widgetId: "acme/posts" }]);
    api.post.mockResolvedValue({
      results: [{ ok: false, error: "Not shown for you", code: "not-shown" }],
    });
    renderGrid();

    expect(await screen.findByTestId("widget-grid-empty")).toBeInTheDocument();
    await beginEditing();
    // In customise mode the card is on show, marked, so it can be removed.
    expect(screen.queryByTestId("widget-grid-empty")).toBeNull();
    expect(screen.getByTestId("hidden-while-empty")).toHaveTextContent(
      "Not shown for you right now"
    );
  });
});

describe("an arrangement whose every card leaves by its own empty answer", () => {
  /**
   * One card of a widget drawn by its own component at `component`, which hides while empty and
   * which the layout read names as leaving by its own answer.
   */
  function quietCard(component: string) {
    mockBranding = branding(["acme/quiet"], {
      "acme/quiet": { component, hidesWhenEmpty: true },
    });
    layoutResponse = layout([{ id: "p1", widgetId: "acme/quiet" }], {
      hiddenWhenAnswerEmpty: ["acme/quiet"],
    });
    renderGrid();
    return screen.findByTestId("widget-cell-acme/quiet");
  }

  it("tells the reader their dashboard is empty at rest, counting the card as it hid itself", async () => {
    // The component reports its answer empty to the frame, which only the card can see: counted
    // from the answer instead, the card was on show and the grid was left blank.
    registerCoreComponent("core#ReportsEmpty", () => (
      <FrameState
        state={{ kind: "empty", empty: { title: "Nothing waiting" } }}
      />
    ));
    const cell = await quietCard("core#ReportsEmpty");
    expect(within(cell).getByRole("region")).toHaveAttribute(
      "data-hidden-empty"
    );
    expect(await screen.findByTestId("widget-grid-empty")).toBeInTheDocument();
  });

  it("does not while the card has something to draw", async () => {
    // The control: a grid that said every such dashboard was empty would pass the case above.
    registerCoreComponent("core#DrawsALine", () => <p>One order waiting</p>);
    const cell = await quietCard("core#DrawsALine");
    expect(
      await within(cell).findByText("One order waiting")
    ).toBeInTheDocument();
    expect(within(cell).getByRole("region")).not.toHaveAttribute(
      "data-hidden-empty"
    );
    expect(screen.queryByTestId("widget-grid-empty")).toBeNull();
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
      within(panel).getByRole("button", { name: "Add Widget core/a" })
    ).toBeInTheDocument();
    await user.click(
      within(panel).getByRole("button", { name: "Add Widget core/b" })
    );
    expect(drawnOrder()).toEqual(["core/b"]);
  });
});
