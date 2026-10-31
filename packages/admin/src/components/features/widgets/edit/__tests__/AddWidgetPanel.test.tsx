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
import { MAX_PLACEMENTS, sizeBounds } from "nextly/config";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { protectedApi } from "@admin/lib/api/protectedApi";
import type {
  DashboardWidget,
  WidgetPlacement,
} from "@admin/types/dashboard/widgets";

import { registerCoreWidgetComponents } from "../../core-components";
import type { GalleryRead, GalleryTile } from "../add-panel-model";
import { AddWidgetPanel, type AddWidgetPanelProps } from "../AddWidgetPanel";

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

  it("has nothing to add a collection card with when the reader may read no collection", async () => {
    const user = userEvent.setup();
    renderPanel({
      gallery: {
        read: { ...READ, collections: [], suggested: [] },
        isError: false,
        retry: vi.fn(),
      },
    });
    await user.click(screen.getByRole("button", { name: "Add Over time" }));
    const step = screen.getByTestId("add-panel-step");
    expect(
      within(step).getByRole("button", { name: "Add to dashboard" })
    ).toBeDisabled();
    expect(step).toHaveTextContent("There is no collection you can read yet.");
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
    expect(all.onAdd).toHaveBeenCalledWith("core/note");
    expect(screen.queryByTestId("add-panel-step")).toBeNull();
    expect(live()).toHaveTextContent("Added Note.");
    expect(panel()).toBeInTheDocument();
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
