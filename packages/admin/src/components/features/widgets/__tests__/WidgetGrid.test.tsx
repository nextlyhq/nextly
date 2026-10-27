/**
 * The grid: what it collects, what it hides, how wide each cell is, and how
 * much it says out loud.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DASHBOARD_LAYOUT_KEY } from "@admin/hooks/queries/useDashboardLayout";
import { protectedApi } from "@admin/lib/api/protectedApi";
import {
  clearRegistry,
  registerComponents,
} from "@admin/lib/plugins/component-registry";
import type { AdminBranding } from "@admin/types/branding";

import { coreDraws } from "../outcome";
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
 * An archetype core cannot draw in THIS release, derived rather than named.
 *
 * Several cases below need a widget nothing can render — to prove the grid does
 * not spend a query on it, does not claim freshness for it, and still counts it
 * as failed. Naming one (`list`, until it gained a body) makes those cases go
 * quietly wrong the day that archetype lands: they keep passing while testing
 * something else entirely. Asking the renderer table keeps them pointed at
 * whatever is genuinely undrawn.
 */
// Listed here rather than imported: `nextly/config` publishes the archetype
// VOCABULARY as a type only, and is deliberately almost free of runtime values.
// The names are stable; which of them core can draw is the part that moves, and
// that is asked of `coreDrawsArchetype` below.
const HOST_DRAWN_ARCHETYPES = ["metric", "table", "list", "text", "actions"];

// Every name above draws now, so the archetype nothing can render is one THIS
// release does not know: what an admin meets when its server is newer and
// declares a card from a later vocabulary. That is the realistic shape of
// "undrawable" from here on, and the cases below test the grid's conduct
// toward it -- no query spent, no freshness claimed, counted as failed.
const NEWER_CORE_ARCHETYPE = "sparkline";

const UNDRAWABLE = [...HOST_DRAWN_ARCHETYPES, NEWER_CORE_ARCHETYPE].find(
  // A declaration carrying a query, so what is being asked is "can core draw
  // this archetype at all", not "is this particular widget under-declared".
  archetype =>
    !coreDraws({ archetype, query: { select: ["title"], op: "list" } })
);

it("has an archetype core cannot draw, which several cases below need", () => {
  // Stated as its own case so that if the renderer table ever admits a name it
  // does not know, this fails with a sentence instead of leaving the cases
  // below silently vacuous.
  expect(UNDRAWABLE).toBe(NEWER_CORE_ARCHETYPE);
});

function brandingWith(widgets: unknown[]): AdminBranding {
  return {
    plugins: [{ name: "@acme", collections: [], widgets }],
  } as unknown as AdminBranding;
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
  vi.mocked(protectedApi.post).mockResolvedValue({ results: [] });
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
 * A `POST /dashboard/query` mock that answers the query it was ASKED.
 *
 * Positional fixtures — an array of results lined up with the widgets as
 * declared — encode the batch's ORDER into every test that uses one. The batch
 * is built in a stable identity order rather than in display order, so that
 * moving a card cannot change the query key and re-issue every request; the
 * order is therefore an implementation detail, and a fixture that depends on it
 * fails for a reason that has nothing to do with what it is testing.
 *
 * Keyed by source, so each widget gets its own number however the batch is
 * arranged. A source the caller did not name comes back as a failed slot rather
 * than as a silent zero, so a test that mis-names one is told.
 */
function mockCountsBySource(counts: Record<string, number>): void {
  vi.mocked(protectedApi.post).mockImplementation(async (_path, body) => {
    const queries = (body as { queries: Array<{ source: string }> }).queries;
    return {
      results: queries.map(query =>
        query.source in counts
          ? { ok: true, result: { op: "count", total: counts[query.source] } }
          : { ok: false, error: `no fixture for ${query.source}` }
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
  it("renders nothing when no plugin contributes a widget", () => {
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

  it("shows a permitted widget and hides a denied one", () => {
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
    expect(screen.getByText("stats widget")).toBeInTheDocument();
    expect(screen.queryByText("secret widget")).not.toBeInTheDocument();
  });

  it("skips a declaration that describes no body, rather than drawing an empty card", () => {
    // Neither an archetype nor a component: the plugin half is gone, or the
    // declaration was never renderable. A titled card with nothing under it
    // reads as a product bug rather than as a missing plugin.
    registerComponents({ "@acme/admin#Real": () => <div>real body</div> });
    mockBranding = brandingWith([
      { id: "hollow", title: "Hollow" },
      { id: "real", component: "@acme/admin#Real" },
    ]);
    renderGrid();
    expect(screen.queryByTestId("widget-cell-hollow")).not.toBeInTheDocument();
    expect(screen.queryByText("Hollow")).not.toBeInTheDocument();
    // The grid itself survives it.
    expect(screen.getByText("real body")).toBeInTheDocument();
  });

  it("keeps one cell when two plugins ship the same widget id", () => {
    // The id keys a batch result back to its card, so a duplicate would hand
    // both widgets the same slot and one would show the other's number.
    registerComponents({
      "@acme/admin#First": () => <div>first body</div>,
      "@other/admin#Second": () => <div>second body</div>,
    });
    mockBranding = {
      plugins: [
        {
          name: "@acme",
          collections: [],
          widgets: [{ id: "shared", component: "@acme/admin#First" }],
        },
        {
          name: "@other",
          collections: [],
          widgets: [{ id: "shared", component: "@other/admin#Second" }],
        },
      ],
    } as unknown as AdminBranding;
    renderGrid();
    expect(screen.getAllByTestId("widget-cell-shared")).toHaveLength(1);
    expect(screen.getByText("first body")).toBeInTheDocument();
    expect(screen.queryByText("second body")).not.toBeInTheDocument();
  });

  it("renders a widget the app only REGISTERED, with no contribution beside it", () => {
    // The registry is what `registerWidget` writes to, and it is the store this
    // whole system is built around. A widget that reached it without also being
    // declared under `contributes.admin.widgets` was invisible to the grid.
    mockBranding = brandingWithRegistered([
      {
        id: "acme/revenue",
        title: "Revenue",
        archetype: "metric",
        size: { default: { w: 3, h: 3 } },
        query: { source: "collection:orders", op: "count" },
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

  it("draws a contributed widget that ships NO component at all", async () => {
    // Tier 1 end to end, and the thing the contract change exists for: the
    // plugin declares an archetype and a query, ships no UI code, and the host
    // draws the card. `component` was required on every contributed widget
    // until now, so this declaration could not be written -- an author had to
    // name a component core would never resolve.
    mockBranding = brandingWith([
      {
        id: "acme/posts",
        title: "Published posts",
        archetype: "metric",
        size: { default: { w: 3, h: 3 } },
        query: { source: "collection:posts", op: "count" },
      },
    ]);
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [{ ok: true, result: { op: "count", total: 42 } }],
    });

    renderGrid();

    // The card, drawn by core from the query result -- not a plugin component,
    // and not the "archetype is not rendered yet" refusal.
    await waitFor(() =>
      expect(screen.getByTestId("widget-metric-value")).toHaveTextContent("42")
    );
    expect(screen.getByText("Published posts")).toBeInTheDocument();
    expect(vi.mocked(protectedApi.post).mock.calls[0][1]).toEqual({
      queries: [{ source: "collection:posts", op: "count" }],
    });
  });

  it("spends no query on a widget nothing can draw", async () => {
    // A declarative widget naming an archetype core has no renderer for, and
    // shipping no component to draw it instead, resolves to a card reading
    // "not rendered yet". Asking for its data would spend an access-checked
    // read, and one of the batch's limited slots, on a result discarded on
    // arrival -- on every mount and every window focus.
    mockBranding = brandingWith([
      {
        id: "acme/recent",
        title: "Recent posts",
        archetype: UNDRAWABLE,
        query: { source: "collection:posts", op: "list" },
      },
    ]);

    renderGrid();

    // The card is drawn and says why, so the widget is not silently missing.
    await waitFor(() =>
      expect(screen.getByTestId("widget-cell-acme/recent")).toBeInTheDocument()
    );
    expect(screen.getByText(/not rendered yet/i)).toBeInTheDocument();
    // And nothing was asked of the server on its behalf.
    expect(protectedApi.post).not.toHaveBeenCalled();
  });

  it("gives the page a freshness only from the cards whose queries ran", async () => {
    // The widget declares a query, so `widget.query` is truthy -- but its
    // archetype is undrawable, so the grid deliberately left it out of the
    // batch. No card says when its data arrived; the page's one line is told
    // the oldest answer on show, from the cards that took part.
    mockBranding = brandingWith([
      {
        id: "acme/recent",
        title: "Recent posts",
        archetype: UNDRAWABLE,
        query: { source: "collection:posts", op: "list" },
      },
      {
        id: "acme/posts",
        title: "Posts",
        archetype: "metric",
        query: { source: "collection:posts", op: "count" },
      },
    ]);
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [{ ok: true, result: { op: "count", total: 3 } }],
    });

    renderGrid();

    await waitFor(() =>
      expect(screen.getByTestId("widget-metric-value")).toHaveTextContent("3")
    );
    const cells = screen.getAllByTestId(/^widget-cell-/);
    expect(cells).toHaveLength(2);

    // No card says when its data arrived; the grid says when the oldest
    // answer it shows did, for the page.
    expect(document.querySelectorAll("time")).toHaveLength(0);
    await waitFor(() =>
      expect(screen.getByLabelText("Dashboard widgets")).toHaveAttribute(
        "data-answered-at"
      )
    );
  });

  it("DOES spend a query when a component can draw the result", async () => {
    // The control, and the boundary: the same undrawable archetype WITH a
    // component resolves to `custom`, the plugin's component consumes the slot,
    // so the read is wanted. A grid that simply skipped undrawable archetypes
    // would starve it.
    registerComponents({ "@acme/admin#Recent": () => <div>recent body</div> });
    mockBranding = brandingWith([
      {
        id: "acme/recent",
        title: "Recent posts",
        archetype: UNDRAWABLE,
        component: "@acme/admin#Recent",
        query: { source: "collection:posts", op: "list" },
      },
    ]);
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [{ ok: true, result: { op: "list", items: [] } }],
    });

    renderGrid();

    await waitFor(() => expect(protectedApi.post).toHaveBeenCalledTimes(1));
    expect(screen.getByText("recent body")).toBeInTheDocument();
  });

  it("spends no query on a list that selects nothing", async () => {
    // The declaration is refused by the archetype itself, so the card can never
    // be drawn -- but the refusal used to arrive only after the query ran. The
    // grid batched it because `list` had a renderer, the server performed an
    // UNPROJECTED read and shipped whole documents to the browser, and the card
    // threw them away to print the refusal. On every mount and every focus.
    mockBranding = brandingWith([
      {
        id: "acme/recent",
        title: "Recent posts",
        archetype: "list",
        query: { source: "collection:posts", op: "list" },
      },
    ]);

    renderGrid();

    await waitFor(() =>
      expect(screen.getByTestId("widget-cell-acme/recent")).toBeInTheDocument()
    );
    expect(screen.getByText(/selects no fields/i)).toBeInTheDocument();
    expect(protectedApi.post).not.toHaveBeenCalled();
  });

  it("offers no Retry on a card refused before it was asked", async () => {
    // The card never entered the batch, so there is no question to ask again: a Retry there
    // would do nothing at all when pressed.
    mockBranding = brandingWith([
      {
        id: "acme/recent",
        title: "Recent posts",
        archetype: "list",
        query: { source: "collection:posts", op: "list" },
      },
    ]);

    renderGrid();

    await waitFor(() =>
      expect(screen.getByTestId("widget-cell-acme/recent")).toBeInTheDocument()
    );
    // The control: the card IS in its error state, so the absence below is about Retry.
    expect(screen.getByTestId("widget-card-error")).toBeInTheDocument();
    expect(screen.queryByTestId("card-retry")).not.toBeInTheDocument();
  });

  it("keeps a contributed component when the registered list is under-declared", async () => {
    // A widget declared through BOTH channels. The registration names `list`
    // and omits `select`, so core cannot draw it -- and the contributed
    // component is the only thing that can. The fallback fires when core cannot
    // draw, and core reported that it could purely because `list` had an entry
    // in the renderer table.
    registerComponents({ "@acme/admin#Recent": () => <div>plugin rows</div> });
    mockBranding = {
      plugins: [
        {
          name: "@acme",
          collections: [],
          widgets: [{ id: "shared", component: "@acme/admin#Recent" }],
        },
      ],
      widgets: [
        {
          id: "shared",
          title: "Shared",
          archetype: "list",
          size: { default: { w: 4, h: 3 } },
          query: { source: "collection:posts", op: "list" },
        },
      ],
    } as unknown as AdminBranding;
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [{ ok: true, result: { op: "list", items: [] } }],
    });

    renderGrid();

    await waitFor(() =>
      expect(screen.getByText("plugin rows")).toBeInTheDocument()
    );
    expect(screen.queryByText(/selects no fields/i)).not.toBeInTheDocument();
  });

  it("draws a LIST widget end to end, from declaration to rows", async () => {
    // The second host-drawn archetype, through the whole path: a declarative
    // contribution with no component, its query batched, the `list` arm of the
    // response validated, and the rows drawn from the fields it selected.
    mockBranding = brandingWith([
      {
        id: "acme/recent",
        title: "Recent posts",
        archetype: "list",
        size: { default: { w: 4, h: 5 } },
        query: {
          source: "collection:posts",
          op: "list",
          select: ["title", "slug"],
          limit: 5,
        },
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
            // The selected fields, described as the server answers a query that selects them.
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
    // And the select reached the server as declared, so the rows are drawn from
    // fields the query actually asked for.
    expect(vi.mocked(protectedApi.post).mock.calls[0][1]).toEqual({
      queries: [
        {
          source: "collection:posts",
          op: "list",
          select: ["title", "slug"],
          // The five rows its five-row-tall body holds, and one more: the extra row is how a list learns that
          // more exist from a source that does not count its rows.
          limit: 6,
        },
      ],
    });
  });

  it("counts a list's View all by the total the server sent, through the batch", async () => {
    // The server answers a collection list with the read's own count. 🔴 A batch parser that
    // rebuilt the list from its rows and fields alone would drop it, and the footer would fall
    // back to the floor the extra row gives, "View all (6+)", for a list of 42.
    mockBranding = brandingWith([
      {
        id: "acme/recent",
        title: "Recent posts",
        archetype: "list",
        size: { default: { w: 4, h: 5 } },
        query: {
          source: "collection:posts",
          op: "list",
          select: ["title"],
          limit: 5,
        },
      },
    ]);
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [
        {
          ok: true,
          result: {
            op: "list",
            items: Array.from({ length: 6 }, (_, i) => ({
              title: `Post ${i + 1}`,
            })),
            fields: [{ name: "title" }],
            total: 42,
          },
        },
      ],
    });

    renderGrid();

    await waitFor(() =>
      expect(screen.getAllByTestId("entity-row")).toHaveLength(5)
    );
    expect(screen.getByTestId("list-card-footer")).toHaveTextContent(
      "View all (42)"
    );
  });

  it("shows an actions card's empty state when the reader may use none of them", async () => {
    // The declaration is valid and carries shortcuts; the PERMISSION FILTER
    // empties it. A drawability check that re-tested the length could not tell
    // that apart from a widget declaring none, so it reported a malformed
    // widget and made the card's own empty state unreachable.
    mockBranding = brandingWith([
      {
        id: "core/shortcuts",
        title: "Shortcuts",
        archetype: "actions",
        actions: [
          {
            label: "Invite user",
            href: "/admin/users/new",
            requiredPermission: "create-users",
          },
        ],
      },
    ]);

    renderGrid();

    await waitFor(() =>
      expect(
        screen.getByTestId("widget-cell-core/shortcuts")
      ).toBeInTheDocument()
    );
    // The frame's empty state, and the frame says so: a bespoke "nothing here" node inside a
    // card marked ready would keep its freshness line and footer link.
    const cell = screen.getByTestId("widget-cell-core/shortcuts");
    expect(within(cell).getByTestId("card-empty")).toBeInTheDocument();
    expect(cell.querySelector("[data-state]")).toHaveAttribute(
      "data-state",
      "empty"
    );
    expect(
      screen.queryByText(/declares no shortcuts/i)
    ).not.toBeInTheDocument();
  });

  it("draws an actions card through the HOST even when a component is offered", async () => {
    // `actions` is queryless by design, so a drawability test that asked "does
    // it declare a query" called every actions widget undrawable and handed one
    // carrying a component fallback to that component -- bypassing the host
    // renderer and, with it, the per-item permission gating.
    registerComponents({ "@acme/admin#Shortcuts": () => <div>plugin ui</div> });
    mockBranding = brandingWith([
      {
        id: "acme/shortcuts",
        title: "Shortcuts",
        archetype: "actions",
        component: "@acme/admin#Shortcuts",
        actions: [{ label: "New post", href: "/admin/posts/new" }],
      },
    ]);

    renderGrid();

    await waitFor(() =>
      expect(screen.getByTestId("widget-action")).toHaveTextContent("New post")
    );
    expect(screen.queryByText("plugin ui")).not.toBeInTheDocument();
  });

  it("STILL prefers the component when core cannot draw the declaration", async () => {
    // The control for the change above: a metric with no query is genuinely
    // undrawable, and the contributed component remains the only thing that can
    // draw that card. Removing the query test must not have removed this.
    registerComponents({ "@acme/admin#Panel": () => <div>panel body</div> });
    mockBranding = brandingWith([
      {
        id: "acme/queryless",
        title: "Queryless",
        archetype: "metric",
        component: "@acme/admin#Panel",
      },
    ]);

    renderGrid();

    await waitFor(() =>
      expect(screen.getByText("panel body")).toBeInTheDocument()
    );
  });

  it("draws a TABLE end to end, headed by the columns the server described", async () => {
    // The whole path for the third host-drawn archetype: a declaration with no
    // component, its query batched, the `list` arm validated with its column
    // descriptions intact, and the headings taken from those rather than from
    // `select` -- which is what keeps a field the reader may not see out of the
    // header row. A full-width card on a 1200 px dashboard is large, the tier
    // that draws its rows as a table.
    stubDashboardWidth(1200, { cardWidth: 1200 });
    mockBranding = brandingWith([
      {
        id: "acme/posts",
        title: "Recent posts",
        archetype: "table",
        size: { default: { w: 12, h: 3 } },
        query: {
          source: "collection:posts",
          op: "list",
          select: ["title", "publishedAt"],
          limit: 5,
        },
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

  it("puts a registered widget's query in the same batch as a contributed one", async () => {
    mockBranding = {
      plugins: [
        {
          name: "@acme",
          collections: [],
          widgets: [
            {
              id: "contributed",
              archetype: "metric",
              title: "Contributed",
              query: { source: "collection:posts", op: "count" },
            },
          ],
        },
      ],
      widgets: [
        {
          id: "acme/registered",
          title: "Registered",
          archetype: "metric",
          size: { default: { w: 3, h: 3 } },
          query: { source: "collection:orders", op: "count" },
        },
      ],
    } as unknown as AdminBranding;
    mockCountsBySource({
      "collection:posts": 1,
      "collection:pages": 2,
    });

    renderGrid();
    await waitFor(() => expect(protectedApi.post).toHaveBeenCalledTimes(1));
    // The SET, not the sequence. The batch is built in a stable identity order
    // rather than in display order, so that moving a card cannot change the
    // query key and re-issue every request -- which makes the sequence an
    // implementation detail. What this test is about is that both channels land
    // in ONE request, and that survives whatever order they are sent in.
    const sent = (
      vi.mocked(protectedApi.post).mock.calls[0][1] as {
        queries: Array<{ source: string; op: string }>;
      }
    ).queries;
    expect(sent).toHaveLength(2);
    expect(sent).toEqual(
      expect.arrayContaining([
        { source: "collection:posts", op: "count" },
        { source: "collection:orders", op: "count" },
      ])
    );
  });

  it("gates a registered widget on its permission like any other", () => {
    mockBranding = brandingWithRegistered([
      {
        id: "acme/secret",
        title: "Secret",
        archetype: "metric",
        size: { default: { w: 3, h: 3 } },
        requiredPermission: "read-secrets",
        query: { source: "collection:secrets", op: "count" },
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
          query: { source: "collection:posts", op: "count" },
        },
      ],
    } as unknown as AdminBranding;
    renderGrid();
    expect(screen.getAllByTestId("widget-cell-shared")).toHaveLength(1);
    // The registry is the single place that knows which widgets exist in a
    // running app, and `overrideWidget`/`extendWidget` exist so a later plugin
    // can correct an earlier one. Letting the contribution win discarded every
    // such correction -- a tightened `requiredPermission` among them -- so the
    // registered definition is what the card is drawn from.
    expect(screen.getByText("Shared")).toBeInTheDocument();
    expect(screen.queryByText("panel body")).not.toBeInTheDocument();
    // And its query is what reaches the batch.
    expect(protectedApi.post).toHaveBeenCalledWith("/dashboard/query", {
      queries: [{ source: "collection:posts", op: "count" }],
    });
  });

  it("draws the contributed component when a data archetype declares no query", () => {
    // `archetype: "metric"` with no `query` is a legal contribution: the field
    // is optional and boot requires only `id` and `component`. Core cannot draw
    // a metric without a result, no request is made for it, and reading the
    // missing slot as "in flight" left the card busy forever. The component the
    // author actually shipped is right there.
    registerComponents({ "@acme/admin#Panel": () => <div>panel body</div> });
    mockBranding = brandingWith([
      {
        id: "queryless",
        title: "Queryless",
        archetype: "metric",
        component: "@acme/admin#Panel",
      },
    ]);

    renderGrid();
    expect(screen.getByText("panel body")).toBeInTheDocument();
    expect(screen.getByTestId("widget-card-body")).toHaveAttribute(
      "aria-busy",
      "false"
    );
    expect(protectedApi.post).not.toHaveBeenCalled();
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

  it("shows a widget that declares no permission at all", () => {
    registerComponents({ "@acme/admin#Open": () => <div>open widget</div> });
    mockBranding = brandingWith([
      { id: "open", component: "@acme/admin#Open" },
    ]);
    renderGrid();
    expect(screen.getByText("open widget")).toBeInTheDocument();
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

  it("lays its cards on twelve columns in rows of 72 px, in order, with the gaps a card's predicted width counts", () => {
    // A card's first query is sized from a width predicted with these gaps. A gap in rem would
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
        query: { source: "collection:posts", op: "count" },
      },
      {
        id: "pages",
        archetype: "metric",
        title: "Pages",
        query: { source: "collection:pages", op: "count" },
      },
    ]);
    mockCountsBySource({
      "collection:posts": 12,
      "collection:pages": 34,
    });

    renderGrid();
    await waitFor(() =>
      expect(screen.getByTestId("widget-cell-posts")).toHaveTextContent("12")
    );
    expect(screen.getByTestId("widget-cell-pages")).toHaveTextContent("34");
    expect(protectedApi.post).toHaveBeenCalledTimes(1);
  });

  it("issues no request when nothing on the dashboard asks for data", () => {
    registerComponents({ "@acme/admin#A": () => <div>a</div> });
    mockBranding = brandingWith([
      { id: "custom-only", component: "@acme/admin#A" },
    ]);
    renderGrid();
    expect(protectedApi.post).not.toHaveBeenCalled();
  });

  it("does not ask on behalf of a widget the user may not see", async () => {
    granted = ["read-posts"];
    mockBranding = brandingWith([
      {
        id: "posts",
        archetype: "metric",
        title: "Posts",
        requiredPermission: "read-posts",
        query: { source: "collection:posts", op: "count" },
      },
      {
        id: "secrets",
        archetype: "metric",
        title: "Secrets",
        requiredPermission: "read-secrets",
        query: { source: "collection:secrets", op: "count" },
      },
    ]);
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [{ ok: true, result: { op: "count", total: 1 } }],
    });

    renderGrid();
    await waitFor(() => expect(protectedApi.post).toHaveBeenCalledTimes(1));
    expect(vi.mocked(protectedApi.post).mock.calls[0][1]).toEqual({
      queries: [{ source: "collection:posts", op: "count" }],
    });
  });

  it("shows one widget's failure in its own card and its neighbour's number in theirs", async () => {
    mockBranding = brandingWith([
      {
        id: "broken",
        archetype: "metric",
        title: "Broken",
        query: { source: "collection:gone", op: "count" },
      },
      {
        id: "fine",
        archetype: "metric",
        title: "Fine",
        query: { source: "collection:posts", op: "count" },
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
        query: { source: "collection:posts", op: "count" },
      },
      {
        id: "pages",
        archetype: "metric",
        title: "Pages",
        query: { source: "collection:pages", op: "count" },
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
        query: { source: "collection:posts", op: "count" },
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
        query: { source: "collection:posts", op: "count" },
      },
      {
        id: "fine",
        archetype: "metric",
        title: "Fine",
        query: { source: "collection:pages", op: "count" },
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
        query: { source: "collection:a", op: "count" },
      },
      {
        id: "two",
        archetype: "metric",
        title: "Two",
        query: { source: "collection:b", op: "count" },
      },
      {
        id: "three",
        archetype: "metric",
        title: "Three",
        query: { source: "collection:c", op: "count" },
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
    // A slot can be `ok` and still unrenderable: this release draws `metric`
    // and nothing else, and a metric handed a list payload refuses it. Counting
    // slots said every widget updated while both cards showed an error.
    //
    // `listy` is counted as a failure WITHOUT being queried: nothing can draw a
    // `list` result in this release and it ships no component, so the grid does
    // not ask -- which is why only two results come back for three widgets.
    // The announcement still has to describe all three.
    mockBranding = brandingWith([
      {
        id: "listy",
        archetype: UNDRAWABLE,
        title: "Recent",
        query: { source: "collection:posts", op: "list" },
      },
      {
        id: "mismatched",
        archetype: "metric",
        title: "Mismatched",
        query: { source: "collection:posts", op: "count" },
      },
      {
        id: "fine",
        archetype: "metric",
        title: "Fine",
        query: { source: "collection:pages", op: "count" },
      },
    ]);
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [
        { ok: true, result: { op: "list", items: [] } },
        { ok: true, result: { op: "count", total: 4 } },
      ],
    });

    renderGrid();
    await waitFor(() =>
      expect(screen.getByTestId("widget-grid-live")).toHaveTextContent(
        /1 of 3 widgets updated, 2 failed/i
      )
    );
    // Two queries for three widgets -- the undrawable one is never asked -- and
    // the keying still lands each result on the widget that asked for it. The
    // SET rather than the sequence: the batch is built in a stable identity
    // order rather than in display order, so which of the two goes first is an
    // implementation detail and not what this test is about.
    const sent = (
      vi.mocked(protectedApi.post).mock.calls[0][1] as {
        queries: Array<{ source: string; op: string }>;
      }
    ).queries;
    expect(sent).toHaveLength(2);
    expect(sent).toEqual(
      expect.arrayContaining([
        { source: "collection:posts", op: "count" },
        { source: "collection:pages", op: "count" },
      ])
    );
  });

  it("has exactly ONE live region for the whole grid", async () => {
    mockBranding = brandingWith([
      {
        id: "posts",
        archetype: "metric",
        title: "Posts",
        query: { source: "collection:posts", op: "count" },
      },
      {
        id: "pages",
        archetype: "metric",
        title: "Pages",
        query: { source: "collection:pages", op: "count" },
      },
    ]);
    mockCountsBySource({
      "collection:posts": 1,
      "collection:pages": 2,
    });

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
        query: { source: "collection:posts", op: "count" },
      },
      {
        id: "pages",
        archetype: "metric",
        title: "Pages",
        query: { source: "collection:pages", op: "count" },
      },
    ]);
    mockCountsBySource({
      "collection:posts": 1,
      "collection:pages": 2,
    });

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
        query: { source: "collection:gone", op: "count" },
      },
      {
        id: "fine",
        archetype: "metric",
        title: "Fine",
        query: { source: "collection:posts", op: "count" },
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
