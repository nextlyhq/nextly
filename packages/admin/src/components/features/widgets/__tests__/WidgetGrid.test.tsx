/**
 * The grid: what it collects, what it hides, how wide each cell is, and how
 * much it says out loud.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useEffect, useState, type JSX, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DASHBOARD_LAYOUT_KEY } from "@admin/hooks/queries/useDashboardLayout";
import { protectedApi } from "@admin/lib/api/protectedApi";
import {
  clearRegistry,
  registerComponents,
} from "@admin/lib/plugins/component-registry";
import type { AdminBranding } from "@admin/types/branding";

import { useCardCollapsed } from "../frame/collapse";
import { GRID_CLASS } from "../sizes";
import { WidgetGrid } from "../WidgetGrid";

import { stubDashboardWidth, unstubDashboardWidth } from "./dashboard-width";

let mockBranding: AdminBranding | undefined;
let mockBrandingStatus: {
  isPending: boolean;
  isUnavailable: boolean;
  isBrandingUnavailable: boolean;
} = { isPending: false, isUnavailable: false, isBrandingUnavailable: false };
let granted: string[] = [];

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => mockBranding,
  useBrandingStatus: () => mockBrandingStatus,
}));
vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: () => ({
    hasPermission: (p: string) => granted.includes(p),
  }),
}));
vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: { post: vi.fn() },
}));
// The batch answered as the `protectedApi.post` mock above describes it; see `batch-over-post`.
vi.mock("@admin/hooks/queries/widget-query-stream", async () =>
  (
    await import("@admin/hooks/queries/__tests__/batch-over-post")
  ).streamOverPost()
);

function renderGrid() {
  const client = new QueryClient({
    // `retry` is a DEFAULT and the hook sets `retry: 2` on the query itself,
    // which wins -- so turning it off here only makes these tests look like it
    // had. What is disabled is the BACKOFF, where the seconds go: the attempts
    // still run, in milliseconds, so a rejected batch settles inside the
    // default `waitFor` window instead of timing out and reading as a card
    // that never recovered.
    defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: 0 } },
  });
  // These cases are about the DECLARED cards, which the grid draws when no
  // arrangement could be read. So the layout read starts out failed, as it
  // would after an outage; a read still in flight draws no card at all, which
  // `arrangement-first.test.tsx` covers. Not retried on mount, which would
  // report the read as pending again until the retry failed.
  client.setQueryDefaults(DASHBOARD_LAYOUT_KEY, { retryOnMount: false });
  client
    .getQueryCache()
    .build(client, { queryKey: DASHBOARD_LAYOUT_KEY })
    .setState({
      status: "error",
      error: new Error("layout unavailable"),
      data: undefined,
      fetchStatus: "idle",
    });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, ...render(<WidgetGrid />, { wrapper: Wrapper }) };
}

/**
 * An archetype this release does not know: what an admin meets when its server is newer and
 * declares a card from a later vocabulary. The card is asked for like any other, and says it is
 * not rendered yet.
 */
const UNDRAWABLE = "sparkline";

/**
 * Branding carrying `widgets` as the registry publishes them, each written as
 * briefly as a case needs: one naming a component and no archetype is drawn
 * by that component, and one naming no title is titled by its id.
 */
function brandingWith(widgets: unknown[]): AdminBranding {
  return brandingWithRegistered(
    widgets.map(widget => {
      const brief = widget as { id: string; archetype?: string };
      return { archetype: "custom", title: brief.id, ...brief };
    })
  );
}

/** Branding carrying REGISTERED widgets and no plugin contribution at all. */
function brandingWithRegistered(widgets: unknown[]): AdminBranding {
  return {
    plugins: [{ name: "@acme", collections: [] }],
    widgets,
  } as unknown as AdminBranding;
}

beforeEach(() => {
  // jsdom lays nothing out; the grid asks nothing until its dashboard has a width.
  stubDashboardWidth();
  granted = [];
  vi.clearAllMocks();
  // Every card answered with data of nothing in particular, so a card drawn by its own component
  // draws; a case about what a card shows answers its own.
  vi.mocked(protectedApi.post).mockImplementation(async (_path, body) => ({
    results: (body as { queries: unknown[] }).queries.map(() => ({
      ok: true,
      result: { op: "data", data: null },
    })),
  }));
});

afterEach(() => {
  unstubDashboardWidth();
  clearRegistry();
  mockBranding = undefined;
  vi.restoreAllMocks();
});

/**
 * Live regions the GRID owns, excluding the one dnd-kit contributes.
 *
 * dnd-kit's `DndContext` renders exactly one hidden `role="status"` region of
 * its own, and it is not optional: it is what narrates pick up, move over, drop
 * and cancel to a screen reader, which is the whole reason a drag is usable
 * without sight. Counting it would make "the grid announces once" and
 * "the drag announces at all" mutually exclusive.
 *
 * Excluded BY ITS OWN ID rather than by loosening the count to two. A bare
 * `toHaveLength(2)` would keep passing if the grid grew a second announcer of
 * its own and dnd-kit's disappeared, which is the pair of mistakes this
 * invariant exists to catch.
 */
/**
 * A `POST /dashboard/query` mock that answers the card it was ASKED for.
 *
 * Positional fixtures — an array of results lined up with the widgets as
 * declared — encode the batch's ORDER into every test that uses one. The batch
 * is built in a stable identity order rather than in display order, so that
 * moving a card cannot change the query key and re-issue every request; the
 * order is therefore an implementation detail, and a fixture that depends on it
 * fails for a reason that has nothing to do with what it is testing.
 *
 * Keyed by the widget each card is asked for, so each widget gets its own
 * number however the batch is arranged. A widget the caller did not name comes
 * back as a failed slot rather than as a silent zero, so a test that mis-names
 * one is told.
 */
function mockCountsByWidget(counts: Record<string, number>): void {
  vi.mocked(protectedApi.post).mockImplementation(async (_path, body) => {
    const queries = (body as { queries: Array<{ widget: string }> }).queries;
    return {
      results: queries.map(query =>
        query.widget in counts
          ? { ok: true, result: { op: "count", total: counts[query.widget] } }
          : { ok: false, error: `no fixture for ${query.widget}` }
      ),
    };
  });
}

function gridLiveRegions(container: HTMLElement): Element[] {
  return [
    ...container.querySelectorAll(
      '[aria-live], [role="status"], [role="alert"]'
    ),
  ].filter(node => !node.id.startsWith("DndLiveRegion"));
}

describe("WidgetGrid — collection and gating", () => {
  it("renders nothing when the registry publishes no widget", () => {
    mockBranding = {
      plugins: [{ name: "@acme", collections: [] }],
    } as unknown as AdminBranding;
    renderGrid();
    // Only the dashboard's measured container, holding nothing: it is drawn in every case, so the
    // width measured on it survives the first declarations arriving.
    expect(screen.getByTestId("dashboard-container")).toBeEmptyDOMElement();
  });

  it("renders nothing when every contributed widget is denied", () => {
    registerComponents({ "@acme/admin#Secret": () => <div>secret</div> });
    mockBranding = brandingWith([
      {
        id: "secret",
        component: "@acme/admin#Secret",
        requiredPermission: "manage-secret",
      },
    ]);
    renderGrid();
    // Only the dashboard's measured container, holding nothing: it is drawn in every case, so the
    // width measured on it survives the first declarations arriving.
    expect(screen.getByTestId("dashboard-container")).toBeEmptyDOMElement();
  });

  it("shows a permitted widget and hides a denied one", async () => {
    granted = ["read-stats"];
    registerComponents({
      "@acme/admin#Stats": () => <div>stats widget</div>,
      "@acme/admin#Secret": () => <div>secret widget</div>,
    });
    mockBranding = brandingWith([
      {
        id: "stats",
        component: "@acme/admin#Stats",
        requiredPermission: "read-stats",
      },
      {
        id: "secret",
        component: "@acme/admin#Secret",
        requiredPermission: "manage-secret",
      },
    ]);
    renderGrid();
    expect(await screen.findByText("stats widget")).toBeInTheDocument();
    expect(screen.queryByText("secret widget")).not.toBeInTheDocument();
  });

  it("draws a throwing component's error once, and never remounts the component card beside it", async () => {
    // 🔴 The grid hands each card its answer afresh on every render. Keyed on a
    // new object each time, a component that threw was caught, re-rendered the
    // grid by reporting the failure, met a "new" answer, drew and threw again
    // until React stopped it ("Maximum update depth exceeded"), and every
    // component card remounted whenever the grid re-rendered.
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let draws = 0;
    let mounts = 0;
    const Throws = (): JSX.Element => {
      draws += 1;
      throw new Error("boom");
    };
    const Counts = (): JSX.Element => {
      useEffect(() => {
        mounts += 1;
      }, []);
      return <p>counted body</p>;
    };
    registerComponents({
      "@acme/admin#Throws": Throws,
      "@acme/admin#Counts": Counts,
    });
    mockBranding = brandingWithRegistered(
      ["throws", "counts"].map(name => ({
        id: `acme/${name}`,
        title: name,
        archetype: "custom",
        size: { default: { w: 6, h: 3 } },
        component: `@acme/admin#${name[0].toUpperCase()}${name.slice(1)}`,
      }))
    );
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [
        { ok: true, result: { op: "data", data: 1 } },
        { ok: true, result: { op: "data", data: 2 } },
      ],
    });

    renderGrid();

    const failed = await screen.findByRole("region", { name: "throws" });
    await waitFor(() => expect(failed).toHaveAttribute("data-state", "error"));
    expect(screen.getByText("counted body")).toBeInTheDocument();
    // Settled, and stays settled: no further draws once the error is shown.
    const drawn = draws;
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(draws).toBe(drawn);
    // React draws a throwing component again once before giving up on it; a
    // loop draws it until the update limit.
    expect(draws).toBeLessThanOrEqual(4);
    expect(mounts).toBe(1);
    expect(
      errors.mock.calls.some(call =>
        String(call[0]).includes("Maximum update depth")
      )
    ).toBe(false);
  });

  it("asks a card core answers on the server at the size it is drawn at and its predicted tier", async () => {
    // A full-width card on a 1,200 px dashboard is large, and a card of three columns on it is
    // 288 px wide, small: the tier its widget's `load` is handed, beside the card's grid size.
    mockBranding = brandingWithRegistered([
      {
        id: "acme/big",
        title: "Big",
        archetype: "metric",
        size: { default: { w: 12, h: 4 } },
      },
      {
        id: "acme/narrow",
        title: "Narrow",
        archetype: "metric",
        size: { default: { w: 3, h: 3 } },
      },
    ]);
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [
        { ok: true, result: { op: "count", total: 1 } },
        { ok: true, result: { op: "count", total: 2 } },
      ],
    });

    renderGrid();

    await waitFor(() => expect(protectedApi.post).toHaveBeenCalled());
    const sent = (
      vi.mocked(protectedApi.post).mock.calls[0][1] as { queries: unknown[] }
    ).queries;
    expect(sent).toHaveLength(2);
    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          widget: "acme/big",
          size: { w: 12, h: 4, tier: "large" },
        }),
        expect.objectContaining({
          widget: "acme/narrow",
          size: { w: 3, h: 3, tier: "small" },
        }),
      ])
    );
  });

  it("renders a widget the registry publishes", () => {
    mockBranding = brandingWithRegistered([
      {
        id: "acme/revenue",
        title: "Revenue",
        archetype: "metric",
        size: { default: { w: 3, h: 3 } },
      },
    ]);
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [{ ok: true, result: { op: "count", total: 42 } }],
    });

    renderGrid();
    return waitFor(() => {
      expect(screen.getByTestId("widget-cell-acme/revenue")).toHaveTextContent(
        "42"
      );
    });
  });

  it("gives the page a freshness from the cards' answers, and no card its own", async () => {
    // No card says when its data arrived; the page's one line is told the oldest answer on
    // show, from the cards that took part.
    mockBranding = brandingWith([
      { id: "acme/posts", title: "Posts", archetype: "metric" },
    ]);
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [{ ok: true, result: { op: "count", total: 3 } }],
    });

    renderGrid();

    await waitFor(() =>
      expect(screen.getByTestId("widget-metric-value")).toHaveTextContent("3")
    );
    expect(document.querySelectorAll("time")).toHaveLength(0);
    await waitFor(() =>
      expect(screen.getByLabelText("Dashboard widgets")).toHaveAttribute(
        "data-answered-at"
      )
    );
  });

  it("draws a contributed widget that ships NO component at all", async () => {
    // Tier 1 end to end: the widget declares an archetype, ships no UI code,
    // and the host draws the card from the answer its `load` gave.
    mockBranding = brandingWith([
      {
        id: "acme/posts",
        title: "Published posts",
        archetype: "metric",
        size: { default: { w: 3, h: 3 } },
      },
    ]);
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [{ ok: true, result: { op: "count", total: 42 } }],
    });

    renderGrid();

    // The card, drawn by core from the answer -- not a plugin component, and
    // not the "archetype is not rendered yet" refusal.
    await waitFor(() =>
      expect(screen.getByTestId("widget-metric-value")).toHaveTextContent("42")
    );
    expect(screen.getByText("Published posts")).toBeInTheDocument();
    // Asked for by its card id, the placement a widget's own id names by default.
    expect(vi.mocked(protectedApi.post).mock.calls[0][1]).toEqual({
      queries: [
        expect.objectContaining({ widget: "acme/posts", card: "acme/posts" }),
      ],
    });
  });

  it("draws a LIST widget end to end, from declaration to rows", async () => {
    // The second host-drawn archetype, through the whole path: a declaration
    // with no component, its card batched, the `list` arm of the response
    // validated, and the rows drawn from the fields the answer describes.
    mockBranding = brandingWith([
      {
        id: "acme/recent",
        title: "Recent posts",
        archetype: "list",
        size: { default: { w: 4, h: 5 } },
      },
    ]);
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [
        {
          ok: true,
          result: {
            op: "list",
            items: [
              { title: "First post", slug: "first-post" },
              { title: "Second post", slug: "second-post" },
            ],
            // The fields the answer's rows carry, described as the server answers them.
            fields: [{ name: "title" }, { name: "slug" }],
          },
        },
      ],
    });

    renderGrid();

    await waitFor(() =>
      expect(screen.getAllByTestId("entity-row")).toHaveLength(2)
    );
    expect(screen.getByText("First post")).toBeInTheDocument();
    expect(screen.getAllByTestId("entity-row-meta")[1]).toHaveTextContent(
      "second-post"
    );
    // And the card was asked for by its id, at the size it is drawn at, which its `load` reads.
    expect(vi.mocked(protectedApi.post).mock.calls[0][1]).toEqual({
      queries: [
        expect.objectContaining({
          widget: "acme/recent",
          card: "acme/recent",
          size: expect.objectContaining({ w: 4, h: 5 }),
        }),
      ],
    });
  });

  it("draws a TABLE end to end, headed by the columns the server described", async () => {
    // The whole path for the third host-drawn archetype: a declaration with no
    // component, its card batched, the `list` arm validated with its column
    // descriptions intact, and the headings taken from those -- which is what
    // keeps a field the reader may not see out of the header row. A full-width
    // card on a 1200 px dashboard is large, the tier that draws its rows as a
    // table.
    stubDashboardWidth(1200, { cardWidth: 1200 });
    mockBranding = brandingWith([
      {
        id: "acme/posts",
        title: "Recent posts",
        archetype: "table",
        size: { default: { w: 12, h: 3 } },
      },
    ]);
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [
        {
          ok: true,
          result: {
            op: "list",
            items: [{ title: "First post", publishedAt: "yesterday" }],
            fields: [
              { name: "title", label: "Title" },
              { name: "publishedAt", label: "Published at" },
            ],
          },
        },
      ],
    });

    renderGrid();

    await waitFor(() =>
      expect(screen.getByTestId("list-card-table")).toBeInTheDocument()
    );
    expect(
      screen.getByRole("columnheader", { name: "Published at" })
    ).toBeInTheDocument();
    expect(screen.getByText("First post")).toBeInTheDocument();
    // The label reached the browser through the batch parser, which rebuilds a
    // list result from the fields it names -- so this also proves the
    // descriptions survive that boundary.
    expect(screen.queryByText("publishedAt")).not.toBeInTheDocument();
  });

  it("gates a registered widget on its permission like any other", () => {
    mockBranding = brandingWithRegistered([
      {
        id: "acme/secret",
        title: "Secret",
        archetype: "metric",
        size: { default: { w: 3, h: 3 } },
        requiredPermission: "read-secrets",
      },
    ]);
    renderGrid();
    // Only the dashboard's measured container, holding nothing: it is drawn in every case, so the
    // width measured on it survives the first declarations arriving.
    expect(screen.getByTestId("dashboard-container")).toBeEmptyDOMElement();
    expect(protectedApi.post).not.toHaveBeenCalled();
  });

  it("draws the REGISTERED definition when a widget is both contributed and registered", () => {
    registerComponents({ "@acme/admin#Panel": () => <div>panel body</div> });
    mockBranding = {
      plugins: [
        {
          name: "@acme",
          collections: [],
          widgets: [{ id: "shared", component: "@acme/admin#Panel" }],
        },
      ],
      widgets: [
        {
          id: "shared",
          title: "Shared",
          archetype: "metric",
          size: { default: { w: 3, h: 3 } },
        },
      ],
    } as unknown as AdminBranding;
    renderGrid();
    expect(screen.getAllByTestId("widget-cell-shared")).toHaveLength(1);
    // The registry is the single place that knows which widgets exist in a
    // running app, so the registered definition is what the card is drawn
    // from, never a contribution beside it.
    expect(screen.getByText("Shared")).toBeInTheDocument();
    expect(screen.queryByText("panel body")).not.toBeInTheDocument();
    // And its card is what reaches the batch.
    expect(protectedApi.post).toHaveBeenCalledWith("/dashboard/query", {
      queries: [expect.objectContaining({ widget: "shared", card: "shared" })],
    });
  });

  it("names a blank title's widget instead of drawing an unnamed landmark", () => {
    // `title: "   "` passes a nullish fallback and leaves the card region's
    // `aria-labelledby` pointing at an empty heading.
    registerComponents({ "@acme/admin#Blank": () => <div>blank body</div> });
    mockBranding = brandingWith([
      { id: "acme/untitled", title: "   ", component: "@acme/admin#Blank" },
    ]);

    renderGrid();
    expect(
      screen.getByRole("region", { name: "acme/untitled" })
    ).toBeInTheDocument();
  });

  it("shows a widget that declares no permission at all", async () => {
    registerComponents({ "@acme/admin#Open": () => <div>open widget</div> });
    mockBranding = brandingWith([
      { id: "open", component: "@acme/admin#Open" },
    ]);
    renderGrid();
    expect(await screen.findByText("open widget")).toBeInTheDocument();
  });
});

describe("WidgetGrid — sizing", () => {
  /** A component-drawn widget declared `w` columns by `h` rows. */
  const sized = (id: string, w: number, h = 3) => ({
    id,
    component: "@acme/admin#A",
    size: { default: { w, h } },
  });

  it("gives every cell a full-width base span whatever its w", () => {
    registerComponents({ "@acme/admin#A": () => <div>a</div> });
    mockBranding = brandingWith([
      sized("w3", 3),
      sized("w4", 4),
      sized("w6", 6),
      sized("w8", 8),
      sized("w12", 12),
    ]);
    renderGrid();
    for (const id of ["w3", "w4", "w6", "w8", "w12"]) {
      const cell = screen.getByTestId(`widget-cell-${id}`);
      expect(cell.className.split(" ")).toContain("col-span-12");
    }
  });

  it("spans a card's w columns and h rows, its columns by the DASHBOARD's width, not the window", () => {
    registerComponents({ "@acme/admin#A": () => <div>a</div> });
    mockBranding = brandingWith([sized("narrow", 3, 4), sized("wide", 8, 2)]);
    renderGrid();
    const narrow = screen.getByTestId("widget-cell-narrow");
    expect(narrow).toHaveClass(
      "col-span-12",
      "@min-[640px]/dashboard:col-span-6",
      "@min-[1024px]/dashboard:col-span-3"
    );
    expect(narrow.style.gridRow).toBe("span 4 / span 4");
    const wide = screen.getByTestId("widget-cell-wide");
    // Wider than six columns: the whole row in the middle band, so no 640 px class at all.
    expect(wide).toHaveClass("@min-[1024px]/dashboard:col-span-8");
    expect(wide.className).not.toMatch(/@min-\[640px\]/);
    expect(wide.style.gridRow).toBe("span 2 / span 2");
    // The container those classes answer to is the dashboard's own, so a
    // dashboard narrowed by a sidebar draws the band that fits it.
    expect(
      screen
        .getByLabelText("Dashboard widgets")
        .closest(".\\@container\\/dashboard")
    ).toBe(screen.getByTestId("dashboard-container"));
  });

  it("draws a card its body collapsed one row tall, its header the one line, and its own rows again once opened", async () => {
    // A body that collapses itself to one line, as the setup card does, with a control to open it.
    function Collapsible() {
      const [collapsed, setCollapsed] = useState(true);
      useCardCollapsed(collapsed);
      return (
        <button type="button" onClick={() => setCollapsed(open => !open)}>
          {collapsed ? "Expand" : "Collapse"}
        </button>
      );
    }
    registerComponents({ "@acme/admin#A": Collapsible });
    mockBranding = brandingWith([{ ...sized("bar", 12, 3), title: "Bar" }]);
    renderGrid();
    const cell = screen.getByTestId("widget-cell-bar");
    const card = within(cell).getByRole("region");
    // Its body is drawn once its answer arrives, and collapses itself then.
    await within(cell).findByRole("button", { name: "Expand" });
    expect(cell.style.gridRow).toBe("span 1 / span 1");
    expect(card).toHaveAttribute("data-collapsed");
    // Its border, padding and one header-high line make exactly one row.
    expect(card).toHaveClass("py-[15px]");
    // The header is the one line, drawn, so the title names the card on screen and no control in
    // it is hidden yet focusable; no footer takes room under the line.
    expect(within(cell).getByTestId("widget-card-header")).not.toHaveClass(
      "sr-only"
    );
    expect(card).toHaveAccessibleName(/Bar/);
    expect(within(cell).queryByTestId("widget-card-footer")).toBeNull();

    // The must-differ half: opened, the card spans its stored rows and draws its whole frame.
    fireEvent.click(within(cell).getByRole("button", { name: "Expand" }));
    expect(cell.style.gridRow).toBe("span 3 / span 3");
    expect(card).not.toHaveAttribute("data-collapsed");
    expect(card).not.toHaveClass("py-[15px]");
    expect(within(cell).getByTestId("widget-card-footer")).toBeInTheDocument();
  });

  it("lays its cards on twelve columns in rows of 72 px, in order, with the gaps a card's predicted width counts", () => {
    // A card is first asked for at a size predicted with these gaps. A gap in rem would
    // follow the page's root font size and draw cards at another width than predicted.
    registerComponents({ "@acme/admin#A": () => <div>a</div> });
    mockBranding = brandingWith([sized("one", 3)]);
    renderGrid();
    const grid = screen.getByLabelText("Dashboard widgets");
    for (const cls of GRID_CLASS.split(" ")) expect(grid).toHaveClass(cls);
    expect(grid.className).not.toMatch(/dense/);
  });
});

describe("WidgetGrid — batching", () => {
  it("asks for every data widget in a single request", async () => {
    mockBranding = brandingWith([
      {
        id: "posts",
        archetype: "metric",
        title: "Posts",
      },
      {
        id: "pages",
        archetype: "metric",
        title: "Pages",
      },
    ]);
    mockCountsByWidget({ posts: 12, pages: 34 });

    renderGrid();
    await waitFor(() =>
      expect(screen.getByTestId("widget-cell-posts")).toHaveTextContent("12")
    );
    expect(screen.getByTestId("widget-cell-pages")).toHaveTextContent("34");
    expect(protectedApi.post).toHaveBeenCalledTimes(1);
  });

  it("does not ask on behalf of a widget the user may not see", async () => {
    granted = ["read-posts"];
    mockBranding = brandingWith([
      {
        id: "posts",
        archetype: "metric",
        title: "Posts",
        requiredPermission: "read-posts",
      },
      {
        id: "secrets",
        archetype: "metric",
        title: "Secrets",
        requiredPermission: "read-secrets",
      },
    ]);
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [{ ok: true, result: { op: "count", total: 1 } }],
    });

    renderGrid();
    await waitFor(() => expect(protectedApi.post).toHaveBeenCalledTimes(1));
    expect(vi.mocked(protectedApi.post).mock.calls[0][1]).toEqual({
      queries: [expect.objectContaining({ widget: "posts" })],
    });
  });

  it("shows one widget's failure in its own card and its neighbour's number in theirs", async () => {
    mockBranding = brandingWith([
      {
        id: "broken",
        archetype: "metric",
        title: "Broken",
      },
      {
        id: "fine",
        archetype: "metric",
        title: "Fine",
      },
    ]);
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [
        { ok: false, error: "Source unavailable." },
        { ok: true, result: { op: "count", total: 9 } },
      ],
    });

    renderGrid();
    await waitFor(() =>
      expect(screen.getByTestId("widget-cell-fine")).toHaveTextContent("9")
    );
    expect(screen.getByTestId("widget-cell-broken")).toHaveTextContent(
      "Source unavailable."
    );
    expect(screen.getByTestId("widget-cell-broken")).toHaveTextContent(
      "Broken"
    );
  });
});

describe("WidgetGrid — a request that fails outright", () => {
  const twoMetrics = () =>
    brandingWith([
      {
        id: "posts",
        archetype: "metric",
        title: "Posts",
      },
      {
        id: "pages",
        archetype: "metric",
        title: "Pages",
      },
    ]);

  it("shows an error on every card rather than leaving them busy forever", async () => {
    mockBranding = twoMetrics();
    vi.mocked(protectedApi.post).mockRejectedValue(new Error("network down"));

    renderGrid();

    await waitFor(() =>
      expect(screen.getByTestId("widget-cell-posts")).toHaveTextContent(
        /could not be loaded/i
      )
    );
    expect(screen.getByTestId("widget-cell-pages")).toHaveTextContent(
      /could not be loaded/i
    );
    // And no card is still claiming to be working on it.
    for (const body of screen.getAllByTestId("widget-card-body")) {
      expect(body).toHaveAttribute("aria-busy", "false");
    }
  });

  it("keeps each failed card named, so the reader knows which widgets are dark", async () => {
    mockBranding = twoMetrics();
    vi.mocked(protectedApi.post).mockRejectedValue(new Error("network down"));

    renderGrid();

    await waitFor(() =>
      expect(screen.getByTestId("widget-cell-posts")).toHaveTextContent(
        /could not be loaded/i
      )
    );
    expect(screen.getByText("Posts")).toBeInTheDocument();
    expect(screen.getByText("Pages")).toBeInTheDocument();
  });
});

describe("WidgetGrid — refetching", () => {
  it("marks a data card busy while it refetches, keeping the number visible", async () => {
    mockBranding = brandingWith([
      {
        id: "posts",
        archetype: "metric",
        title: "Posts",
      },
    ]);
    vi.mocked(protectedApi.post).mockResolvedValueOnce({
      results: [{ ok: true, result: { op: "count", total: 12 } }],
    });

    const { client } = renderGrid();
    await waitFor(() =>
      expect(screen.getByTestId("widget-cell-posts")).toHaveTextContent("12")
    );
    expect(screen.getByTestId("widget-card-body")).toHaveAttribute(
      "aria-busy",
      "false"
    );

    // A refetch that never settles: exactly the state a window-focus refresh is
    // in while the request is out.
    vi.mocked(protectedApi.post).mockImplementation(
      () => new Promise(() => {})
    );
    void client.refetchQueries();

    await waitFor(() =>
      expect(screen.getByTestId("widget-card-body")).toHaveAttribute(
        "aria-busy",
        "true"
      )
    );
    // And the reader still has the number they were looking at.
    expect(screen.getByTestId("widget-cell-posts")).toHaveTextContent("12");
  });
});

describe("WidgetGrid — a malformed response member", () => {
  it("colours one card and leaves the page and its neighbour standing", async () => {
    mockBranding = brandingWith([
      {
        id: "broken",
        archetype: "metric",
        title: "Broken",
      },
      {
        id: "fine",
        archetype: "metric",
        title: "Fine",
      },
    ]);
    vi.mocked(protectedApi.post).mockResolvedValue({
      // Shaped as a slot, carrying no result: the renderer used to dereference
      // it and throw into the dashboard's error boundary.
      results: [{ ok: true }, { ok: true, result: { op: "count", total: 5 } }],
    });

    renderGrid();
    await waitFor(() =>
      expect(screen.getByTestId("widget-cell-fine")).toHaveTextContent("5")
    );
    expect(screen.getByTestId("widget-cell-broken")).toHaveTextContent(
      /unreadable/i
    );
    // The grid itself is still on screen, which is the whole point.
    expect(
      screen.getByRole("region", { name: /dashboard widgets/i })
    ).toBeInTheDocument();
  });
});

describe("WidgetGrid — accessibility", () => {
  it("keeps ONE live region even when several cards fail at once", async () => {
    // The earlier version of this counted `[aria-live]` only, which the card's
    // `role="alert"` does not set -- so five assertive card regions satisfied
    // "exactly one live region" byte for byte.
    mockBranding = brandingWith([
      {
        id: "one",
        archetype: "metric",
        title: "One",
      },
      {
        id: "two",
        archetype: "metric",
        title: "Two",
      },
      {
        id: "three",
        archetype: "metric",
        title: "Three",
      },
    ]);
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [
        { ok: false, error: "Source unavailable." },
        { ok: false, error: "Source unavailable." },
        { ok: false, error: "Source unavailable." },
      ],
    });

    const { container } = renderGrid();
    await waitFor(() =>
      expect(screen.getAllByTestId("widget-card-error")).toHaveLength(3)
    );
    expect(gridLiveRegions(container)).toHaveLength(1);
  });

  it("counts a card that cannot RENDER as failed, not as updated", async () => {
    // A slot can be `ok` and still unrenderable: a card whose archetype this
    // release does not draw, and a metric handed a list payload, which refuses
    // it. Counting slots said every widget updated while both cards showed an
    // error. The announcement has to describe all three.
    mockBranding = brandingWith([
      {
        id: "listy",
        archetype: UNDRAWABLE,
        title: "Recent",
      },
      {
        id: "mismatched",
        archetype: "metric",
        title: "Mismatched",
      },
      {
        id: "fine",
        archetype: "metric",
        title: "Fine",
      },
    ]);
    // Answered by the widget each card is asked for: the batch is built in a
    // stable identity order rather than in display order, so which goes first
    // is an implementation detail and not what this test is about.
    vi.mocked(protectedApi.post).mockImplementation(async (_path, body) => ({
      results: (body as { queries: Array<{ widget: string }> }).queries.map(
        query =>
          query.widget === "mismatched"
            ? { ok: true, result: { op: "list", items: [] } }
            : { ok: true, result: { op: "count", total: 4 } }
      ),
    }));

    renderGrid();
    await waitFor(() =>
      expect(screen.getByTestId("widget-grid-live")).toHaveTextContent(
        /1 of 3 widgets updated, 2 failed/i
      )
    );
    // Every card is asked for, the one this release cannot draw included.
    const sent = (
      vi.mocked(protectedApi.post).mock.calls[0][1] as {
        queries: Array<{ widget: string }>;
      }
    ).queries;
    expect(sent.map(query => query.widget).sort()).toEqual([
      "fine",
      "listy",
      "mismatched",
    ]);
  });

  it("has exactly ONE live region for the whole grid", async () => {
    mockBranding = brandingWith([
      {
        id: "posts",
        archetype: "metric",
        title: "Posts",
      },
      {
        id: "pages",
        archetype: "metric",
        title: "Pages",
      },
    ]);
    mockCountsByWidget({ posts: 1, pages: 2 });

    const { container } = renderGrid();
    await waitFor(() =>
      expect(screen.getByTestId("widget-cell-posts")).toHaveTextContent("1")
    );
    expect(gridLiveRegions(container)).toHaveLength(1);
  });

  it("announces once for the batch, not once per widget", async () => {
    mockBranding = brandingWith([
      {
        id: "posts",
        archetype: "metric",
        title: "Posts",
      },
      {
        id: "pages",
        archetype: "metric",
        title: "Pages",
      },
    ]);
    mockCountsByWidget({ posts: 1, pages: 2 });

    renderGrid();
    await waitFor(() =>
      expect(screen.getByTestId("widget-grid-live")).toHaveTextContent(
        /2 of 2 widgets updated/i
      )
    );
  });

  it("names how many widgets failed rather than which one, once", async () => {
    mockBranding = brandingWith([
      {
        id: "broken",
        archetype: "metric",
        title: "Broken",
      },
      {
        id: "fine",
        archetype: "metric",
        title: "Fine",
      },
    ]);
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [
        { ok: false, error: "Source unavailable." },
        { ok: true, result: { op: "count", total: 9 } },
      ],
    });

    renderGrid();
    await waitFor(() =>
      expect(screen.getByTestId("widget-grid-live")).toHaveTextContent(
        /1 of 2 widgets updated, 1 failed/i
      )
    );
  });

  it("gives the grid an accessible name", () => {
    registerComponents({ "@acme/admin#A": () => <div>a</div> });
    mockBranding = brandingWith([{ id: "a", component: "@acme/admin#A" }]);
    renderGrid();
    expect(
      screen.getByRole("region", { name: /dashboard widgets/i })
    ).toBeInTheDocument();
  });
});

describe("the grid distinguishes 'nothing to draw' from 'nothing has arrived'", () => {
  beforeEach(() => {
    mockBranding = {};
    mockBrandingStatus = {
      isPending: false,
      isUnavailable: false,
      isBrandingUnavailable: false,
    };
  });

  it("says nothing when the workspace settled and declared no widgets", () => {
    // The genuinely empty case, and the control for the two below: an app with
    // no widgets should render no grid rather than a permanent skeleton.
    renderGrid();
    // Only the dashboard's measured container, holding nothing: it is drawn in every case, so the
    // width measured on it survives the first declarations arriving.
    expect(screen.getByTestId("dashboard-container")).toBeEmptyDOMElement();
  });

  it("holds space while the workspace query is still in flight", () => {
    // Every card on the dashboard now arrives through this query. Treating a
    // PENDING response as "no widgets" blanked the entire page on first paint
    // and on any slow request -- the sections used to mount immediately and
    // draw their own skeletons, so the regression was invisible to every test
    // that supplied widgets.
    mockBrandingStatus = { ...mockBrandingStatus, isPending: true };
    renderGrid();
    expect(screen.getByTestId("widget-grid-loading")).toBeInTheDocument();
  });

  it("says so when the workspace never answered", () => {
    // Distinct from pending, and distinct from empty. Silence here told the
    // reader their dashboard has no content, when what happened is that we
    // could not find out.
    mockBrandingStatus = { ...mockBrandingStatus, isUnavailable: true };
    renderGrid();
    expect(screen.getByTestId("widget-grid-unavailable")).toBeInTheDocument();
  });
});
