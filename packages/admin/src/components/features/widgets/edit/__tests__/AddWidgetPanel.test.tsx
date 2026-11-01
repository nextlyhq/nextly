/**
 * The add gallery as a reader meets it (dashboard-experience R-19, R-20): where focus starts, the
 * chips, the Suggested row and one tile per widget; what a search keeps, including a collection's
 * pairs, and what it says; the add step and when it may add; what an add says and where focus
 * stays; and the removed cards first.
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
import {
  MAX_PLACEMENTS,
  sizeBounds,
  type PublishedContentSource,
} from "nextly/config";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { protectedApi } from "@admin/lib/api/protectedApi";
import type {
  DashboardWidget,
  WidgetPlacement,
} from "@admin/types/dashboard/widgets";

import { registerCoreWidgetComponents } from "../../core-components";
import { cardOuterWidth } from "../../frame/tier";
import { DashboardWidthProvider } from "../../useDashboardWidth";
import type { GalleryRead, GalleryTile } from "../add-panel-model";
import { AddWidgetPanel, type AddWidgetPanelProps } from "../AddWidgetPanel";

/** The collections the reader's content settings see, as the workspace payload publishes them. */
let mockSources: PublishedContentSource[] | undefined;
vi.mock("@admin/context/providers/BrandingProvider", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/context/providers/BrandingProvider")
  >()),
  useBranding: () => ({ widgetSources: mockSources }),
}));
vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: { post: vi.fn() },
}));
// The add step's preview asks through the batch, answered as the `post` mock says.
vi.mock("@admin/hooks/queries/widget-query-stream", async () =>
  (
    await import("@admin/hooks/queries/__tests__/batch-over-post")
  ).streamOverPost()
);

// Core's components under their `core#` paths, so a tile is drawn by its widget's own view.
registerCoreWidgetComponents();

const OVER_TIME_SIZE = sizeBounds({
  default: { w: 6, h: 3 },
  min: { w: 4, h: 3 },
  max: { w: 12, h: 4 },
});

/** The widgets as this admin draws them. */
const WIDGETS: DashboardWidget[] = [
  {
    id: "core/over-time",
    title: "Over time",
    archetype: "custom",
    component: "core#OverTime",
    serverData: true,
    size: OVER_TIME_SIZE,
    settings: [
      { name: "collection", type: "collection", label: "Collection" },
      {
        name: "dateRange",
        type: "select",
        label: "Date range",
        quick: true,
        defaultValue: "30d",
        options: [
          { value: "7d", label: "7 days" },
          { value: "30d", label: "30 days" },
          { value: "90d", label: "90 days" },
          { value: "12m", label: "12 months" },
        ],
      },
    ],
  },
  {
    id: "core/note",
    title: "Note",
    archetype: "custom",
    component: "core#Note",
    serverData: true,
    size: sizeBounds({ default: { w: 4, h: 3 } }),
  },
  {
    id: "core/team-activity",
    title: "Team activity",
    archetype: "list",
    size: sizeBounds({ default: { w: 6, h: 5 } }),
  },
  {
    id: "seo/score",
    title: "SEO score",
    archetype: "metric",
    size: sizeBounds({ default: { w: 3, h: 2 }, max: { w: 3, h: 2 } }),
  },
];
const BY_ID = new Map(WIDGETS.map(widget => [widget.id, widget]));

const TILES: GalleryTile[] = [
  {
    id: "core/over-time",
    name: "Over time",
    description: "How many entries a collection gained over a range.",
    category: "trends",
    size: OVER_TIME_SIZE,
    collectionSetting: "collection",
    allowsSeveral: true,
  },
  {
    id: "core/note",
    name: "Note",
    description: "A note of your own, in Markdown.",
    category: "content",
    size: sizeBounds({ default: { w: 4, h: 3 } }),
    allowsSeveral: true,
    preview: {
      result: { op: "data", data: { text: "**This week:** review drafts." } },
    },
  },
  {
    id: "core/team-activity",
    name: "Team activity",
    description: "Who changed what.",
    category: "activity",
    size: sizeBounds({ default: { w: 6, h: 5 } }),
    allowsSeveral: false,
  },
  {
    id: "seo/score",
    name: "SEO score",
    description: "How well pages are set up for search.",
    category: "plugins",
    declaredCategory: "Marketing",
    size: sizeBounds({ default: { w: 3, h: 2 }, max: { w: 3, h: 2 } }),
    allowsSeveral: false,
  },
];

const READ: GalleryRead = {
  tiles: TILES,
  collections: [
    { slug: "posts", label: "Posts", lifecycle: true, entries: 40 },
    { slug: "pages", label: "Pages", lifecycle: true, entries: 12 },
  ],
  mostEdited: "pages",
  suggested: [
    {
      widgetId: "core/over-time",
      collection: "posts",
      label: "Posts over time",
    },
  ],
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function props(over: Partial<AddWidgetPanelProps> = {}): AddWidgetPanelProps {
  return {
    open: true,
    onOpenChange: vi.fn(),
    gallery: { read: READ, isError: false, retry: vi.fn() },
    placements: [],
    byId: BY_ID,
    atCapacity: false,
    onAdd: vi.fn((widgetId: string) => ({
      title: BY_ID.get(widgetId)?.title ?? widgetId,
    })),
    onAddBack: vi.fn(() => ({ title: "Team activity" })),
    onClosed: vi.fn(),
    ...over,
  };
}

function renderPanel(over: Partial<AddWidgetPanelProps> = {}) {
  const all = props(over);
  const view = render(<AddWidgetPanel {...all} />, { wrapper });
  return { ...all, rerender: view.rerender };
}

const panel = () => screen.getByRole("dialog", { name: "Add widget" });
const live = () => screen.getByTestId("add-panel-live");
const search = () =>
  screen.getByRole("searchbox", { name: "Search widgets or collections" });
const tileNames = () =>
  within(screen.getByTestId("add-panel-tiles"))
    .getAllByRole("listitem")
    .map(item => item.getAttribute("data-testid"));

beforeEach(() => {
  vi.clearAllMocks();
  mockSources = undefined;
  // The add step's preview waits on its answer; the gallery never needs one.
  vi.mocked(protectedApi.post).mockReturnValue(new Promise(() => {}));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("opening", () => {
  it("opens with focus in the search, the five chips, Suggested and one tile per widget", () => {
    renderPanel();
    expect(search()).toHaveFocus();
    expect(search()).toHaveValue("");
    expect(search()).toHaveAccessibleDescription("4 widgets");
    const chips = within(screen.getByRole("group", { name: "Filter widgets" }))
      .getAllByRole("button")
      .map(chip => [chip.textContent, chip.getAttribute("aria-pressed")]);
    expect(chips).toEqual([
      ["All", "true"],
      ["Content", "false"],
      ["Activity", "false"],
      ["Trends", "false"],
      ["Plugins", "false"],
    ]);
    // No group per collection: the sections are Suggested and the tiles, nothing named after one.
    expect(
      within(panel())
        .getAllByRole("heading", { level: 3 })
        .map(heading => heading.textContent)
    ).toEqual(["Suggested for you", "Widgets"]);
    expect(tileNames()).toEqual([
      "add-panel-tile-core/over-time",
      "add-panel-tile-core/note",
      "add-panel-tile-core/team-activity",
      "add-panel-tile-seo/score",
    ]);
  });

  it("gives each tile its name, its one-line description and the widths it allows", () => {
    renderPanel();
    const tile = screen.getByRole("button", { name: "Add Over time" });
    expect(tile).toHaveAccessibleDescription(
      "How many entries a collection gained over a range."
    );
    expect(tile).toHaveTextContent("⅓ to Full width");
    expect(
      screen.getByRole("button", { name: "Add SEO score" })
    ).toHaveTextContent("¼ width");
  });

  it("draws a tile's preview with the widget's own view from its declared case, a sketch without one", async () => {
    renderPanel();
    const note = screen.getByTestId("add-panel-tile-core/note");
    const preview = within(note).getByTestId("tile-preview");
    // The note's own text, drawn by its own component from its preview case.
    await waitFor(() =>
      expect(preview).toHaveTextContent("This week: review drafts.")
    );
    expect(within(preview).queryByTestId("tile-sketch")).toBeNull();
    // Shown, not used.
    expect(preview).toHaveAttribute("aria-hidden", "true");
    expect(preview).toHaveAttribute("inert");
    const seo = screen.getByTestId("add-panel-tile-seo/score");
    expect(within(seo).getByTestId("tile-sketch")).toBeInTheDocument();
  });

  it("names a tile as the dashboard titles its card, and lists none this admin cannot draw", () => {
    renderPanel({
      gallery: {
        read: {
          ...READ,
          tiles: [
            // Sent under its id: a widget the server has no declared title for.
            { ...TILES[1]!, name: "core/note" },
            { ...TILES[0]!, id: "acme/unknown", name: "acme/unknown" },
          ],
          suggested: [],
        },
        isError: false,
        retry: vi.fn(),
      },
    });
    expect(
      screen.getByRole("button", { name: "Add Note" })
    ).toBeInTheDocument();
    expect(screen.queryByText("core/note")).toBeNull();
    expect(screen.queryByTestId("add-panel-tile-acme/unknown")).toBeNull();
  });

  it("shows a loading state, then an error with Try again, before the read answers", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    const { rerender } = renderPanel({
      gallery: { read: undefined, isError: false, retry },
    });
    expect(screen.getByTestId("add-panel-loading")).toBeInTheDocument();
    rerender(
      <AddWidgetPanel
        {...props({ gallery: { read: undefined, isError: true, retry } })}
      />
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});

describe("the chips", () => {
  it("keeps only the chosen chip's widgets, and says which chip is on", async () => {
    const user = userEvent.setup();
    renderPanel();
    const trends = screen.getByRole("button", { name: "Trends" });
    await user.click(trends);
    expect(trends).toHaveAttribute("aria-pressed", "true");
    expect(tileNames()).toEqual(["add-panel-tile-core/over-time"]);
    // Suggested is for the whole gallery, not one chip's part of it.
    expect(screen.queryByTestId("add-panel-suggested")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Plugins" }));
    expect(tileNames()).toEqual(["add-panel-tile-seo/score"]);
    await user.click(screen.getByRole("button", { name: "All" }));
    expect(tileNames()).toHaveLength(4);
  });

  it("says a chip has nothing to add, rather than that a search matched nothing", async () => {
    const user = userEvent.setup();
    renderPanel({
      gallery: {
        read: { ...READ, tiles: TILES.filter(t => t.category !== "plugins") },
        isError: false,
        retry: vi.fn(),
      },
    });
    await user.click(screen.getByRole("button", { name: "Plugins" }));
    expect(screen.getByTestId("add-panel-chip-empty")).toHaveTextContent(
      "No Plugins widgets to add."
    );
    expect(screen.queryByTestId("add-panel-none")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Show all widgets" }));
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });
});

describe("searching", () => {
  it("matches a widget by its name, description or category", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(search(), "markdown");
    expect(tileNames()).toEqual(["add-panel-tile-core/note"]);
    await user.clear(search());
    await user.type(search(), "marketing");
    expect(tileNames()).toEqual(["add-panel-tile-seo/score"]);
    await user.clear(search());
    await user.type(search(), "trends");
    expect(tileNames()).toEqual(["add-panel-tile-core/over-time"]);
  });

  it("lists a collection's label as pairs, each adding its widget with that collection chosen", async () => {
    const user = userEvent.setup();
    const all = renderPanel();
    await user.type(search(), "pag");
    const pairs = screen.getByTestId("add-panel-pairs");
    // Only a widget that reads a collection pairs with one.
    expect(
      within(pairs)
        .getAllByRole("button")
        .map(b => b.textContent)
    ).toEqual(["Over time · Pages"]);
    await user.click(
      within(pairs).getByRole("button", { name: "Add Over time · Pages" })
    );
    expect(all.onAdd).toHaveBeenCalledWith("core/over-time", {
      collection: "pages",
    });
    expect(live()).toHaveTextContent("Added Over time.");
    // Still open, for the next card.
    expect(panel()).toBeInTheDocument();
  });

  it("announces the number of results once typing pauses, not on every key", () => {
    vi.useFakeTimers();
    renderPanel();
    fireEvent.change(search(), { target: { value: "po" } });
    act(() => vi.advanceTimersByTime(300));
    fireEvent.change(search(), { target: { value: "pos" } });
    act(() => vi.advanceTimersByTime(300));
    expect(live().textContent).toBe("");
    act(() => vi.advanceTimersByTime(200));
    // The one pair, Over time · Posts.
    expect(live()).toHaveTextContent("1 result for “pos”.");
    expect(screen.getByTestId("add-panel-count")).toHaveTextContent(
      "1 result for “pos”"
    );
  });

  it("says when nothing matches, and Clear brings every widget back", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(search(), "zzz");
    expect(screen.getByTestId("add-panel-none")).toHaveTextContent(
      "No widgets match “zzz”"
    );
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(search()).toHaveValue("");
    expect(search()).toHaveFocus();
    expect(live()).toHaveTextContent("4 widgets.");
    expect(tileNames()).toHaveLength(4);
  });
});

describe("what the gallery says for a chip", () => {
  it("says the count for a chip the reader chooses, and nothing for the All it opens on", () => {
    vi.useFakeTimers();
    renderPanel();
    act(() => vi.advanceTimersByTime(1000));
    expect(live().textContent).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Trends" }));
    act(() => vi.advanceTimersByTime(500));
    expect(live()).toHaveTextContent("1 widget.");
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    act(() => vi.advanceTimersByTime(500));
    expect(live()).toHaveTextContent("4 widgets.");
  });

  it("says the count again for each chip, even when two chips hold as many widgets", () => {
    vi.useFakeTimers();
    renderPanel();
    // The sentence as a node of its own: the region's text replaced, not left as it was.
    const saying = () => live().firstElementChild;
    fireEvent.click(screen.getByRole("button", { name: "Trends" }));
    act(() => vi.advanceTimersByTime(500));
    expect(live().textContent).toBe("1 widget.");
    const trends = saying();
    fireEvent.click(screen.getByRole("button", { name: "Content" }));
    act(() => vi.advanceTimersByTime(500));
    expect(live().textContent).toBe("1 widget.");
    expect(saying()).not.toBe(trends);
    expect(saying()).toHaveTextContent("1 widget.");
  });

  it("says the chip's count after Clear, not every widget's", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Trends" }));
    await user.type(search(), "zzz");
    expect(screen.getByTestId("add-panel-none")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(tileNames()).toEqual(["add-panel-tile-core/over-time"]);
    expect(live()).toHaveTextContent("1 widget.");
    expect(screen.getByTestId("add-panel-count")).toHaveTextContent("1 widget");
  });

  it("says the chip's count once after Clear, not again once the pause has passed", () => {
    vi.useFakeTimers();
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Trends" }));
    fireEvent.change(search(), { target: { value: "zzz" } });
    act(() => vi.advanceTimersByTime(500));
    expect(live().textContent).toBe("0 results for “zzz”.");
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(live().textContent).toBe("1 widget.");
    // Each saying is a node of its own: the count said a second time would replace this one.
    const cleared = live().firstElementChild;
    act(() => vi.advanceTimersByTime(1000));
    expect(live().firstElementChild).toBe(cleared);
    expect(live().textContent).toBe("1 widget.");
  });

  it("never says a chip's count once the add step has opened, nor again on coming back", () => {
    vi.useFakeTimers();
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Trends" }));
    // Into the step before the pause ends: the count waiting is for a gallery no longer shown.
    act(() => vi.advanceTimersByTime(200));
    fireEvent.click(screen.getByRole("button", { name: "Add Over time" }));
    expect(screen.getByTestId("add-panel-step")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1000));
    expect(live().textContent).toBe("");
    // Back in the gallery, the same chip still on: nothing said over the reader's return.
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    act(() => vi.advanceTimersByTime(1000));
    expect(live().textContent).toBe("");
    // A new narrowing is said as ever.
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    act(() => vi.advanceTimersByTime(500));
    expect(live()).toHaveTextContent("4 widgets.");
  });

  it("lets an add from the step be heard, not the chip's count after it", () => {
    vi.useFakeTimers();
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Trends" }));
    act(() => vi.advanceTimersByTime(500));
    expect(live()).toHaveTextContent("1 widget.");
    fireEvent.click(screen.getByRole("button", { name: "Add Over time" }));
    fireEvent.click(screen.getByRole("button", { name: "Add to dashboard" }));
    expect(live()).toHaveTextContent("Added Over time.");
    act(() => vi.advanceTimersByTime(1000));
    expect(live()).toHaveTextContent("Added Over time.");
  });

  it("never says a chip's count after the panel closes on it", () => {
    vi.useFakeTimers();
    const all = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Trends" }));
    act(() => vi.advanceTimersByTime(200));
    all.rerender(<AddWidgetPanel {...all} open={false} />);
    act(() => vi.advanceTimersByTime(1000));
    all.rerender(<AddWidgetPanel {...all} open />);
    act(() => vi.advanceTimersByTime(1000));
    expect(live().textContent).toBe("");
  });

  it("lets a card put back under a chip be said, never spoken over by the count it moved", () => {
    vi.useFakeTimers();
    const removed: WidgetPlacement = {
      id: "p1",
      widgetId: "core/team-activity",
      w: 6,
      h: 5,
      removed: true,
    };
    const all = renderPanel({ placements: [removed] });
    fireEvent.click(screen.getByRole("button", { name: "Activity" }));
    act(() => vi.advanceTimersByTime(500));
    fireEvent.click(
      screen.getByRole("button", { name: "Add back Team activity" })
    );
    // The draft as it is once the card is back: off the Removed list, so the count moves.
    all.rerender(
      <AddWidgetPanel {...all} placements={[{ ...removed, removed: false }]} />
    );
    act(() => vi.advanceTimersByTime(1000));
    expect(live()).toHaveTextContent("Added back Team activity.");
  });
});

describe("the add step", () => {
  it("opens for a widget that reads a collection, on the collection the reader edits most", async () => {
    const user = userEvent.setup();
    const all = renderPanel();
    await user.click(screen.getByRole("button", { name: "Add Over time" }));
    expect(all.onAdd).not.toHaveBeenCalled();
    const step = screen.getByTestId("add-panel-step");
    expect(
      within(step).getByRole("heading", { name: "Add “Over time”" })
    ).toHaveFocus();
    const collection = within(step).getByRole("combobox", {
      name: "Collection",
    });
    expect(collection).toHaveValue("pages");
    expect(collection).toHaveAccessibleDescription(
      "The collection you edit most."
    );
    // The period it declares, at its starting value.
    const period = within(step).getByRole("group", { name: "Period" });
    expect(
      within(period).getByRole("radio", { name: "30 days" })
    ).toBeChecked();
    // Widths within its sizes only: from a third to full.
    const width = within(step).getByRole("group", { name: "Width" });
    expect(
      within(width)
        .getAllByRole("radio")
        .map(radio => radio.getAttribute("aria-label"))
    ).toEqual([
      "Third width, 4 columns",
      "Half width, 6 columns",
      "Two thirds width, 8 columns",
      "Full width, 12 columns",
    ]);
    // The card previewed as it will be added.
    expect(within(step).getByTestId("settings-preview")).toBeInTheDocument();
    expect(within(step).getByRole("button", { name: "Back" })).toBeEnabled();
  });

  it("previews the card at the width chosen in the step, as it will be added", async () => {
    const user = userEvent.setup();
    const all = props();
    // On a 1,200 px dashboard, so each width draws the card at its own width there.
    render(
      <DashboardWidthProvider value={1200}>
        <AddWidgetPanel {...all} />
      </DashboardWidthProvider>,
      { wrapper }
    );
    await user.click(screen.getByRole("button", { name: "Add Over time" }));
    const step = screen.getByTestId("add-panel-step");
    await user.selectOptions(
      within(step).getByRole("combobox", { name: "Collection" }),
      "posts"
    );
    const preview = () => within(step).getByTestId("settings-preview");
    // The control: the default width and full width draw the card at different widths.
    expect(cardOuterWidth(6, 1200)).not.toBe(cardOuterWidth(12, 1200));
    expect(preview().style.width).toBe(`${cardOuterWidth(6, 1200)}px`);
    await user.click(
      within(step).getByRole("radio", { name: "Full width, 12 columns" })
    );
    expect(preview().style.width).toBe(`${cardOuterWidth(12, 1200)}px`);
  });

  it("adds with what was chosen, then goes back to the gallery, focus on the tile", async () => {
    const user = userEvent.setup();
    const all = renderPanel();
    await user.click(screen.getByRole("button", { name: "Add Over time" }));
    const step = screen.getByTestId("add-panel-step");
    await user.selectOptions(
      within(step).getByRole("combobox", { name: "Collection" }),
      "posts"
    );
    await user.click(within(step).getByRole("radio", { name: "90 days" }));
    await user.click(
      within(step).getByRole("radio", { name: "Full width, 12 columns" })
    );
    await user.click(
      within(step).getByRole("button", { name: "Add to dashboard" })
    );
    expect(all.onAdd).toHaveBeenCalledWith(
      "core/over-time",
      { collection: "posts", dateRange: "90d" },
      12
    );
    expect(live()).toHaveTextContent("Added Over time.");
    expect(screen.queryByTestId("add-panel-step")).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Over time$/ })).toHaveFocus()
    );
  });

  it("keeps Add to dashboard unavailable until a collection is chosen", async () => {
    const user = userEvent.setup();
    const all = renderPanel();
    await user.click(screen.getByRole("button", { name: "Add Over time" }));
    const step = screen.getByTestId("add-panel-step");
    const add = within(step).getByRole("button", { name: "Add to dashboard" });
    await user.selectOptions(
      within(step).getByRole("combobox", { name: "Collection" }),
      ""
    );
    expect(add).toBeDisabled();
    await user.click(add);
    expect(all.onAdd).not.toHaveBeenCalled();
    await user.selectOptions(
      within(step).getByRole("combobox", { name: "Collection" }),
      "posts"
    );
    expect(add).toBeEnabled();
  });

  it("offers no collection card when the reader may read no collection", () => {
    renderPanel({
      gallery: {
        read: { ...READ, collections: [], suggested: [] },
        isError: false,
        retry: vi.fn(),
      },
    });
    const tile = screen.getByTestId("add-panel-tile-core/over-time");
    expect(tile).toHaveTextContent("No collection you can read suits it.");
    expect(within(tile).queryByRole("button")).toBeNull();
    // A widget that reads none is still added on choosing it.
    expect(screen.getByRole("button", { name: "Add Note" })).toBeEnabled();
  });

  it("starts on the first readable collection, and says so, when the reader edited none", async () => {
    const user = userEvent.setup();
    renderPanel({
      gallery: {
        read: { ...READ, mostEdited: undefined },
        isError: false,
        retry: vi.fn(),
      },
    });
    await user.click(screen.getByRole("button", { name: "Add Over time" }));
    const collection = within(screen.getByTestId("add-panel-step")).getByRole(
      "combobox",
      { name: "Collection" }
    );
    expect(collection).toHaveValue("posts");
    expect(collection).toHaveAccessibleDescription(
      "Starts on the first collection you can read."
    );
  });

  it("Back returns to the gallery with focus on the tile it came from", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Add Over time" }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.queryByTestId("add-panel-step")).toBeNull();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Add Over time" })
      ).toHaveFocus()
    );
  });

  it("adds a widget that reads no collection on choosing it, and keeps the panel open", async () => {
    const user = userEvent.setup();
    const all = renderPanel();
    await user.click(screen.getByRole("button", { name: "Add Note" }));
    expect(all.onAdd).toHaveBeenCalledWith("core/note", undefined);
    expect(screen.queryByTestId("add-panel-step")).toBeNull();
    expect(live()).toHaveTextContent("Added Note.");
    expect(panel()).toBeInTheDocument();
  });
});

describe("collections a widget can be set to", () => {
  /** Breakdown divides a collection's entries: by status where it has a lifecycle. */
  const BREAKDOWN: DashboardWidget = {
    id: "core/breakdown",
    title: "Breakdown",
    archetype: "custom",
    component: "core#Breakdown",
    serverData: true,
    size: sizeBounds({ default: { w: 4, h: 3 } }),
    settings: [
      { name: "collection", type: "collection", label: "Collection" },
      {
        name: "groupBy",
        type: "groupBy",
        of: "collection",
        label: "Group by",
        defaultFrom: "collection",
      },
    ],
  };
  const BREAKDOWN_TILE: GalleryTile = {
    id: "core/breakdown",
    name: "Breakdown",
    category: "trends",
    size: BREAKDOWN.size,
    collectionSetting: "collection",
    allowsSeveral: true,
  };
  // Posts has a lifecycle to divide by; Pages has nothing to group its entries by.
  const SOURCES: PublishedContentSource[] = [
    {
      collection: "posts",
      label: "Posts",
      lifecycle: true,
      fields: [
        {
          name: "status",
          label: "Status",
          type: "string",
          choices: [
            { value: "draft", label: "Draft" },
            { value: "published", label: "Published" },
          ],
        },
      ],
    },
    {
      collection: "pages",
      label: "Pages",
      lifecycle: false,
      fields: [{ name: "title", label: "Title", type: "string" }],
    },
  ];
  const withBreakdown = (read: Partial<GalleryRead> = {}) =>
    props({
      byId: new Map([...BY_ID, [BREAKDOWN.id, BREAKDOWN]]),
      gallery: {
        read: { ...READ, tiles: [...TILES, BREAKDOWN_TILE], ...read },
        isError: false,
        retry: vi.fn(),
      },
    });

  it("offers in the add step only the collections the widget can ask anything of", async () => {
    mockSources = SOURCES;
    const user = userEvent.setup();
    render(<AddWidgetPanel {...withBreakdown()} />, { wrapper });
    await user.click(screen.getByRole("button", { name: "Add Breakdown" }));
    const picker = within(screen.getByTestId("add-panel-step")).getByRole(
      "combobox",
      { name: "Collection" }
    );
    expect(
      within(picker)
        .getAllByRole("option")
        .map(option => option.textContent)
    ).toEqual(["Choose a collection", "Posts"]);
    // Pages is the reader's most-edited, but Breakdown cannot ask it, so it starts on Posts.
    expect(picker).toHaveValue("posts");
  });

  it("lists no pair, and no suggestion, for a collection the widget cannot ask", async () => {
    mockSources = SOURCES;
    const user = userEvent.setup();
    render(
      <AddWidgetPanel
        {...withBreakdown({
          suggested: [
            {
              widgetId: "core/breakdown",
              collection: "pages",
              label: "Pages by status",
            },
          ],
        })}
      />,
      { wrapper }
    );
    expect(screen.queryByTestId("add-panel-suggested")).toBeNull();
    await user.type(search(), "pages");
    const pairs = within(screen.getByTestId("add-panel-pairs"))
      .getAllByRole("button")
      .map(b => b.textContent);
    expect(pairs).toEqual(["Over time · Pages"]);
  });

  it("says a widget no readable collection suits cannot be added", () => {
    mockSources = [SOURCES[1]!];
    render(
      <AddWidgetPanel
        {...withBreakdown({
          collections: [
            { slug: "pages", label: "Pages", lifecycle: false, entries: 12 },
          ],
        })}
      />,
      { wrapper }
    );
    const tile = screen.getByTestId("add-panel-tile-core/breakdown");
    expect(tile).toHaveTextContent("No collection you can read suits it.");
    expect(within(tile).queryByRole("button")).toBeNull();
    // The control: a widget that can read Pages is still offered.
    expect(screen.getByRole("button", { name: "Add Over time" })).toBeEnabled();
  });
});

describe("what is on the dashboard", () => {
  const placed = (over: Partial<WidgetPlacement>): WidgetPlacement => ({
    id: "p1",
    widgetId: "core/team-activity",
    w: 6,
    h: 5,
    removed: false,
    ...over,
  });

  it("says a one-card widget is on the dashboard, and offers no add for it", () => {
    renderPanel({ placements: [placed({})] });
    const tile = screen.getByTestId("add-panel-tile-core/team-activity");
    expect(tile).toHaveTextContent("On your dashboard");
    expect(within(tile).queryByRole("button")).toBeNull();
  });

  it("lists the cards removed this session first, each put back with its settings", async () => {
    const user = userEvent.setup();
    const all = renderPanel({ placements: [placed({ removed: true })] });
    expect(
      within(panel())
        .getAllByRole("heading", { level: 3 })
        .map(heading => heading.textContent)
    ).toEqual(["Removed 1", "Suggested for you", "Widgets"]);
    // The one-card widget is reached through its removed card alone, never as a second card.
    expect(
      screen.queryByTestId("add-panel-tile-core/team-activity")
    ).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Add back Team activity" })
    );
    expect(all.onAddBack).toHaveBeenCalledWith("p1");
    expect(live()).toHaveTextContent("Added back Team activity.");
  });

  it("at the limit, disables adding but not adding back, and says why", () => {
    renderPanel({ atCapacity: true, placements: [placed({ removed: true })] });
    expect(screen.getByRole("button", { name: "Add Note" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Add back Team activity" })
    ).toBeEnabled();
    expect(screen.getByTestId("add-panel-at-capacity")).toHaveTextContent(
      String(MAX_PLACEMENTS)
    );
  });

  it("says nothing was added when the dashboard refused it", async () => {
    const user = userEvent.setup();
    renderPanel({ onAdd: vi.fn(() => null) });
    await user.click(screen.getByRole("button", { name: "Add Note" }));
    expect(live()).toHaveTextContent("Nothing was added.");
  });
});

describe("Suggested", () => {
  it("opens the add step with the widget and its collection both chosen", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Posts over time" }));
    const step = screen.getByTestId("add-panel-step");
    expect(within(step).getByRole("heading", { level: 3 })).toHaveTextContent(
      "Over time"
    );
    expect(
      within(step).getByRole("combobox", { name: "Collection" })
    ).toHaveValue("posts");
  });

  it("leaves out a pair the draft already holds", () => {
    renderPanel({
      placements: [
        {
          id: "c1",
          widgetId: "core/over-time",
          w: 6,
          h: 3,
          removed: false,
          config: { collection: "posts" },
        },
      ],
    });
    expect(screen.queryByTestId("add-panel-suggested")).toBeNull();
  });
});

describe("each visit", () => {
  it("starts with an empty search, All, and the gallery rather than an add step", async () => {
    const user = userEvent.setup();
    const all = renderPanel();
    await user.type(search(), "note");
    await user.click(screen.getByRole("button", { name: "Trends" }));
    all.rerender(<AddWidgetPanel {...all} open={false} />);
    await waitFor(() => expect(all.onClosed).toHaveBeenCalledTimes(1));
    all.rerender(<AddWidgetPanel {...all} open />);
    expect(search()).toHaveValue("");
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("opens again on the gallery with focus in its search, after closing in an add step", async () => {
    const user = userEvent.setup();
    const all = renderPanel();
    await user.click(screen.getByRole("button", { name: "Add Over time" }));
    expect(screen.getByTestId("add-panel-step")).toBeInTheDocument();
    all.rerender(<AddWidgetPanel {...all} open={false} />);
    await waitFor(() => expect(all.onClosed).toHaveBeenCalledTimes(1));
    all.rerender(<AddWidgetPanel {...all} open />);
    // The first frame of the new visit already draws the search the sheet focuses.
    await waitFor(() => expect(search()).toHaveFocus());
    expect(screen.queryByTestId("add-panel-step")).toBeNull();
  });

  it("never says the last visit's add again on opening", () => {
    vi.useFakeTimers();
    const all = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Add Note" }));
    expect(live()).toHaveTextContent("Added Note.");
    all.rerender(<AddWidgetPanel {...all} open={false} />);
    act(() => vi.advanceTimersByTime(100));
    all.rerender(<AddWidgetPanel {...all} open />);
    expect(live().textContent).toBe("");
  });

  it("never lets a count still waiting on a pause speak over an add made before it", () => {
    vi.useFakeTimers();
    renderPanel();
    fireEvent.change(search(), { target: { value: "note" } });
    act(() => vi.advanceTimersByTime(200));
    fireEvent.click(screen.getByRole("button", { name: "Add Note" }));
    expect(live()).toHaveTextContent("Added Note.");
    act(() => vi.advanceTimersByTime(1000));
    expect(live()).toHaveTextContent("Added Note.");
  });

  it("closes from its button", async () => {
    const user = userEvent.setup();
    const all = renderPanel();
    await user.click(within(panel()).getByRole("button", { name: "Close" }));
    expect(all.onOpenChange).toHaveBeenCalledWith(false);
  });
});
