/**
 * The add panel as a reader meets it: focus in the search, then one list of every widget with its
 * icon, name, plugin, one line and Add, and nothing else; what a row says when there is nothing to
 * add; what a search keeps and says; what Add hands the dashboard, the collection a new card
 * starts on included; and where focus stays after an add.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MAX_PLACEMENTS, sizeBounds } from "nextly/config";
import { useState, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PluginMetadata } from "@admin/types/branding";
import type {
  DashboardWidget,
  WidgetPlacement,
} from "@admin/types/dashboard/widgets";

import type { GalleryRead, GalleryTile } from "../add-panel-model";
import { AddWidgetPanel, type AddWidgetPanelProps } from "../AddWidgetPanel";

/** The plugins the workspace payload names, for the plugin line beside a widget's name. */
const PLUGINS: PluginMetadata[] = [
  { name: "@acme/plugin-seo", appearance: { label: "SEO" }, collections: [] },
];
vi.mock("@admin/context/providers/BrandingProvider", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/context/providers/BrandingProvider")
  >()),
  useBranding: () => ({ widgetSources: undefined, plugins: PLUGINS }),
}));

const COLLECTION_SETTING = {
  name: "collection",
  type: "collection",
  label: "Collection",
} as const;

/** The widgets as this admin draws them. */
const WIDGETS: DashboardWidget[] = [
  {
    id: "core/count",
    title: "Count",
    icon: "Hash",
    archetype: "metric",
    size: sizeBounds({ default: { w: 3, h: 2 } }),
    settings: [COLLECTION_SETTING],
  },
  {
    id: "core/note",
    title: "Note",
    archetype: "custom",
    component: "core#Note",
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
    size: sizeBounds({ default: { w: 3, h: 2 } }),
  },
];
const BY_ID = new Map(WIDGETS.map(widget => [widget.id, widget]));

const TILES: GalleryTile[] = [
  {
    id: "core/count",
    name: "Count",
    description: "How many entries a collection holds.",
    size: sizeBounds({ default: { w: 3, h: 2 } }),
    collectionSetting: "collection",
    allowsSeveral: true,
  },
  {
    id: "core/note",
    name: "Note",
    description: "A private note, written in Markdown.",
    size: sizeBounds({ default: { w: 4, h: 3 } }),
    allowsSeveral: true,
  },
  {
    id: "core/team-activity",
    name: "Team activity",
    description: "Who changed what.",
    size: sizeBounds({ default: { w: 6, h: 5 } }),
    allowsSeveral: false,
  },
  {
    id: "seo/score",
    name: "SEO score",
    description: "Pages missing a title.",
    plugin: "@acme/plugin-seo",
    size: sizeBounds({ default: { w: 3, h: 2 } }),
    allowsSeveral: false,
  },
];

const READ: GalleryRead = {
  tiles: TILES,
  collections: [
    { slug: "posts", label: "Posts", lifecycle: true },
    { slug: "pages", label: "Pages", lifecycle: true },
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
const search = () => screen.getByRole("searchbox", { name: "Search widgets" });
const row = (id: string) => screen.getByTestId(`add-panel-row-${id}`);
const rowIds = () => {
  const list = screen.queryByRole("list", { name: "Widgets" });
  return list === null
    ? []
    : within(list)
        .getAllByRole("listitem")
        .map(item => item.getAttribute("data-testid"));
};

/** A card on the dashboard, as the draft holds it. */
function card(
  id: string,
  widgetId: string,
  over: Partial<WidgetPlacement> = {}
): WidgetPlacement {
  return { id, widgetId, w: 3, h: 2, removed: false, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("opening", () => {
  it("opens with focus in the search, then one list of every widget, and nothing else", () => {
    renderPanel();
    expect(search()).toHaveFocus();
    expect(search()).toHaveValue("");
    expect(search()).toHaveAccessibleDescription("4 widgets");
    expect(rowIds()).toEqual([
      "add-panel-row-core/count",
      "add-panel-row-core/note",
      "add-panel-row-core/team-activity",
      "add-panel-row-seo/score",
    ]);
    // No chips, no Suggested or Removed group, no second step.
    expect(within(panel()).queryAllByRole("heading", { level: 3 })).toEqual([]);
    expect(within(panel()).queryByRole("group")).toBeNull();
    expect(within(panel()).queryByRole("combobox")).toBeNull();
    expect(within(panel()).queryByText(/Suggested|Removed/)).toBeNull();
  });

  it("gives each row its icon, name, plugin, one line and Add", () => {
    renderPanel();
    const count = row("core/count");
    expect(count).toHaveTextContent("Count");
    expect(count).toHaveTextContent("How many entries a collection holds.");
    // Its own icon, by the name its declaration gives.
    expect(count.querySelector(".lucide-hash")).not.toBeNull();
    expect(
      within(count).getByRole("button", { name: "Add Count" })
    ).toBeEnabled();
    // A plugin's widget names its plugin as the admin names it, and is drawn with a glyph.
    const seo = row("seo/score");
    expect(seo).toHaveTextContent("SEO plugin");
    expect(seo.querySelector("svg")).not.toBeNull();
    expect(row("core/note")).not.toHaveTextContent("plugin");
  });

  it("names a row as the dashboard titles its card, and lists none this admin cannot draw", () => {
    renderPanel({
      gallery: {
        read: {
          ...READ,
          tiles: [
            // Sent under its id: a widget the server has no declared title for.
            { ...TILES[1]!, name: "core/note" },
            { ...TILES[0]!, id: "acme/unknown", name: "acme/unknown" },
          ],
        },
        isError: false,
        retry: vi.fn(),
      },
    });
    expect(screen.getByRole("button", { name: "Add Note" })).toBeVisible();
    expect(screen.queryByText("core/note")).toBeNull();
    expect(screen.queryByTestId("add-panel-row-acme/unknown")).toBeNull();
  });

  it("shows a loading state, then an error with Try again, before the read answers", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    const { rerender } = renderPanel({
      gallery: { read: undefined, isError: false, retry },
    });
    expect(screen.getByTestId("add-panel-loading")).toBeVisible();
    // The count line says nothing before there is anything to count.
    expect(screen.getByTestId("add-panel-count")).toHaveTextContent("");
    rerender(
      <AddWidgetPanel
        {...props({ gallery: { read: undefined, isError: true, retry } })}
      />
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe("what a row offers", () => {
  it("says a one-card widget the dashboard holds is on it, with nothing to add", () => {
    renderPanel({
      placements: [card("t", "core/team-activity"), card("c", "core/count")],
    });
    const team = row("core/team-activity");
    expect(team).toHaveTextContent("On dashboard");
    expect(within(team).queryByRole("button")).toBeNull();
    // A widget that allows several is offered again.
    expect(
      within(row("core/count")).getByRole("button", { name: "Add Count" })
    ).toBeEnabled();
  });

  it("puts a one-card widget removed this session back as it was, rather than adding a second", async () => {
    const user = userEvent.setup();
    const { onAdd, onAddBack } = renderPanel({
      placements: [card("t-1", "core/team-activity", { removed: true })],
    });
    await user.click(screen.getByRole("button", { name: "Add Team activity" }));
    expect(onAddBack).toHaveBeenCalledWith("t-1");
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("offers no Add for a widget that reads a collection when the reader may read none", () => {
    renderPanel({
      gallery: {
        read: { ...READ, collections: [] },
        isError: false,
        retry: vi.fn(),
      },
    });
    const count = row("core/count");
    expect(count).toHaveTextContent("Needs a collection you can read");
    expect(within(count).queryByRole("button")).toBeNull();
    // The control: a widget that reads none is still offered.
    expect(
      within(row("core/note")).getByRole("button", { name: "Add Note" })
    ).toBeEnabled();
  });

  it("offers no new card at the limit, but still puts a removed one back", () => {
    renderPanel({
      atCapacity: true,
      placements: [card("t-1", "core/team-activity", { removed: true })],
    });
    expect(screen.getByTestId("add-panel-at-capacity")).toHaveTextContent(
      String(MAX_PLACEMENTS)
    );
    expect(screen.getByRole("button", { name: "Add Note" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Add Team activity" })
    ).toBeEnabled();
  });
});

describe("adding", () => {
  it("adds a widget that reads no collection with its defaults, says so and keeps the panel open", async () => {
    const user = userEvent.setup();
    const { onAdd, onOpenChange } = renderPanel();
    const add = screen.getByRole("button", { name: "Add Note" });
    await user.click(add);
    expect(onAdd).toHaveBeenCalledWith("core/note", undefined, false);
    expect(live()).toHaveTextContent("Added Note.");
    expect(onOpenChange).not.toHaveBeenCalled();
    // Focus stays on the Add pressed, for the next card.
    await waitFor(() => expect(add).toHaveFocus());
  });

  it("starts a collection card on the first collection no card of it uses yet", async () => {
    const user = userEvent.setup();
    const first = renderPanel();
    await user.click(screen.getByRole("button", { name: "Add Count" }));
    expect(first.onAdd).toHaveBeenLastCalledWith(
      "core/count",
      { collection: "posts" },
      false
    );
    first.rerender(
      <AddWidgetPanel
        {...first}
        placements={[
          card("c-1", "core/count", { config: { collection: "posts" } }),
          // A removed card holds no collection.
          card("c-2", "core/count", {
            config: { collection: "pages" },
            removed: true,
          }),
        ]}
      />
    );
    await user.click(screen.getByRole("button", { name: "Add Count" }));
    expect(first.onAdd).toHaveBeenLastCalledWith(
      "core/count",
      { collection: "pages" },
      false
    );
  });

  it("adds a collection card as one the reader has when every collection has its card", async () => {
    const user = userEvent.setup();
    const { onAdd } = renderPanel({
      placements: [
        card("c-1", "core/count", { config: { collection: "posts" } }),
        card("c-2", "core/count", { config: { collection: "pages" } }),
      ],
    });
    await user.click(screen.getByRole("button", { name: "Add Count" }));
    expect(onAdd).toHaveBeenCalledWith(
      "core/count",
      { collection: "posts" },
      true
    );
  });

  it("sends focus back to the search when the row it was on no longer offers Add", async () => {
    const user = userEvent.setup();
    // The dashboard's side: the draft gains the card in the same click, as the editor's does.
    function Dashboard() {
      const [placements, setPlacements] = useState<WidgetPlacement[]>([]);
      return (
        <AddWidgetPanel
          {...props({
            placements,
            onAdd: widgetId => {
              setPlacements(current => [...current, card("t", widgetId)]);
              return { title: BY_ID.get(widgetId)?.title ?? widgetId };
            },
          })}
        />
      );
    }
    render(<Dashboard />, { wrapper });
    await user.click(screen.getByRole("button", { name: "Add Team activity" }));
    expect(row("core/team-activity")).toHaveTextContent("On dashboard");
    await waitFor(() => expect(search()).toHaveFocus());
    expect(live()).toHaveTextContent("Added Team activity.");
  });

  it("says when the dashboard is full and nothing was added", async () => {
    const user = userEvent.setup();
    renderPanel({ onAdd: vi.fn(() => null) });
    await user.click(screen.getByRole("button", { name: "Add Note" }));
    expect(live()).toHaveTextContent(
      `Your dashboard holds the most cards it can (${MAX_PLACEMENTS}, counting removed ones). Nothing was added.`
    );
  });
});

describe("searching", () => {
  it("keeps the rows whose name, one line or plugin holds the words, ignoring case", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(search(), "MARKDOWN");
    expect(rowIds()).toEqual(["add-panel-row-core/note"]);
    await user.clear(search());
    await user.type(search(), "who changed");
    expect(rowIds()).toEqual(["add-panel-row-core/team-activity"]);
    await user.clear(search());
    await user.type(search(), "seo");
    expect(rowIds()).toEqual(["add-panel-row-seo/score"]);
    expect(search()).toHaveAccessibleDescription("1 widget");
  });

  it("says when nothing matches", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(search(), "zzz");
    expect(screen.getByTestId("add-panel-none")).toHaveTextContent(
      "No widget matches. Try another word."
    );
    expect(search()).toHaveAccessibleDescription("0 widgets");
  });

  it("announces the count once typing pauses, and never for the list it opens on", async () => {
    const user = userEvent.setup();
    renderPanel();
    await new Promise(resolve => setTimeout(resolve, 700));
    expect(live()).toHaveTextContent("");
    await user.type(search(), "note");
    // Not at once: each keystroke would interrupt the last.
    expect(live()).toHaveTextContent("");
    await waitFor(() => expect(live()).toHaveTextContent("1 widget."), {
      timeout: 2000,
    });
  });

  it("says nothing while the list loads, then the count of a search typed before it landed", async () => {
    const user = userEvent.setup();
    const all = renderPanel({
      gallery: { read: undefined, isError: false, retry: vi.fn() },
    });
    await user.type(search(), "note");
    await new Promise(resolve => setTimeout(resolve, 700));
    // Not "0 widgets": nothing has been counted yet.
    expect(live()).toHaveTextContent("");
    all.rerender(
      <AddWidgetPanel {...all} gallery={{ ...all.gallery, read: READ }} />
    );
    await waitFor(() => expect(live()).toHaveTextContent("1 widget."), {
      timeout: 2000,
    });
  });

  it("opens afresh: an earlier search is gone, and nothing is said", async () => {
    const user = userEvent.setup();
    const all = renderPanel();
    await user.type(search(), "note");
    all.rerender(<AddWidgetPanel {...all} open={false} />);
    all.rerender(<AddWidgetPanel {...all} open />);
    expect(search()).toHaveValue("");
    expect(rowIds()).toHaveLength(4);
    expect(live()).toHaveTextContent("");
  });
});
