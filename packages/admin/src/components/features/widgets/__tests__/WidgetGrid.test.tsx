/**
 * The grid: what it collects, what it hides, how wide each cell is, and how
 * much it says out loud.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { protectedApi } from "@admin/lib/api/protectedApi";
import {
  clearRegistry,
  registerComponents,
} from "@admin/lib/plugins/component-registry";
import type { AdminBranding } from "@admin/types/branding";

import { WidgetGrid } from "../WidgetGrid";

let mockBranding: AdminBranding | undefined;
let granted: string[] = [];

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => mockBranding,
}));
vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: () => ({
    hasPermission: (p: string) => granted.includes(p),
  }),
}));
vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: { post: vi.fn() },
}));

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
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, ...render(<WidgetGrid />, { wrapper: Wrapper }) };
}

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
  granted = [];
  vi.clearAllMocks();
  vi.mocked(protectedApi.post).mockResolvedValue({ results: [] });
});

afterEach(() => {
  clearRegistry();
  mockBranding = undefined;
  vi.restoreAllMocks();
});

describe("WidgetGrid — collection and gating", () => {
  it("renders nothing when no plugin contributes a widget", () => {
    mockBranding = {
      plugins: [{ name: "@acme", collections: [] }],
    } as unknown as AdminBranding;
    const { container } = renderGrid();
    expect(container).toBeEmptyDOMElement();
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
    const { container } = renderGrid();
    expect(container).toBeEmptyDOMElement();
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
        defaultSize: "sm",
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
        defaultSize: "sm",
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
        archetype: "list",
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

  it("claims no freshness for a query that never ran", async () => {
    // The widget declares a query, so `widget.query` is truthy -- but its
    // archetype is undrawable, so the grid deliberately left it out of the
    // batch. Reading `widget.query` again to decide the card's freshness gave
    // it an "Updated just now" for a request nothing ever sent, and marked it
    // busy while an unrelated widget refetched.
    mockBranding = brandingWith([
      {
        id: "acme/recent",
        title: "Recent posts",
        archetype: "list",
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

    // The metric card asked and answered, so it carries the batch's timestamp.
    await waitFor(() =>
      expect(screen.getByTestId("widget-metric-value")).toHaveTextContent("3")
    );
    const cells = screen.getAllByTestId(/^widget-cell-/);
    expect(cells).toHaveLength(2);

    // Exactly one freshness line on the page: the widget that took part.
    expect(screen.getAllByTestId("widget-card-freshness")).toHaveLength(1);
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
        archetype: "list",
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
          defaultSize: "sm",
          query: { source: "collection:orders", op: "count" },
        },
      ],
    } as unknown as AdminBranding;
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [
        { ok: true, result: { op: "count", total: 1 } },
        { ok: true, result: { op: "count", total: 2 } },
      ],
    });

    renderGrid();
    await waitFor(() => expect(protectedApi.post).toHaveBeenCalledTimes(1));
    expect(vi.mocked(protectedApi.post).mock.calls[0][1]).toEqual({
      queries: [
        { source: "collection:posts", op: "count" },
        { source: "collection:orders", op: "count" },
      ],
    });
  });

  it("gates a registered widget on its permission like any other", () => {
    mockBranding = brandingWithRegistered([
      {
        id: "acme/secret",
        title: "Secret",
        archetype: "metric",
        defaultSize: "sm",
        requiredPermission: "read-secrets",
        query: { source: "collection:secrets", op: "count" },
      },
    ]);
    const { container } = renderGrid();
    expect(container).toBeEmptyDOMElement();
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
          defaultSize: "sm",
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
  it("gives every cell a full-width base span whatever its size", () => {
    registerComponents({ "@acme/admin#A": () => <div>a</div> });
    mockBranding = brandingWith([
      { id: "small", component: "@acme/admin#A", defaultSize: "sm" },
      { id: "medium", component: "@acme/admin#A", defaultSize: "md" },
      { id: "large", component: "@acme/admin#A", defaultSize: "lg" },
      { id: "xlarge", component: "@acme/admin#A", defaultSize: "xl" },
      { id: "whole", component: "@acme/admin#A", defaultSize: "full" },
    ]);
    renderGrid();
    for (const id of ["small", "medium", "large", "xlarge", "whole"]) {
      const cell = screen.getByTestId(`widget-cell-${id}`);
      expect(cell.className.split(" ")).toContain("col-span-12");
    }
  });

  it("narrows a small widget only at md and lg", () => {
    registerComponents({ "@acme/admin#A": () => <div>a</div> });
    mockBranding = brandingWith([
      { id: "small", component: "@acme/admin#A", defaultSize: "sm" },
    ]);
    renderGrid();
    expect(screen.getByTestId("widget-cell-small")).toHaveClass(
      "col-span-12",
      "md:col-span-6",
      "lg:col-span-3"
    );
  });

  it("honours the deprecated half alias without half-width phones", () => {
    registerComponents({ "@acme/admin#A": () => <div>a</div> });
    mockBranding = brandingWith([
      { id: "halved", component: "@acme/admin#A", size: "half" },
    ]);
    renderGrid();
    const cell = screen.getByTestId("widget-cell-halved");
    expect(cell).toHaveClass("col-span-12", "lg:col-span-6");
    expect(cell.className.split(" ")).not.toContain("col-span-6");
  });

  it("prefers an explicit defaultSize over the deprecated alias", () => {
    registerComponents({ "@acme/admin#A": () => <div>a</div> });
    mockBranding = brandingWith([
      {
        id: "both",
        component: "@acme/admin#A",
        size: "half",
        defaultSize: "sm",
      },
    ]);
    renderGrid();
    expect(screen.getByTestId("widget-cell-both")).toHaveClass("lg:col-span-3");
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
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [
        { ok: true, result: { op: "count", total: 12 } },
        { ok: true, result: { op: "count", total: 34 } },
      ],
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
    expect(
      container.querySelectorAll('[aria-live], [role="status"], [role="alert"]')
    ).toHaveLength(1);
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
        archetype: "list",
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
    // Two queries for three widgets, and the positional keying still lands each
    // result on the widget that asked for it.
    expect(vi.mocked(protectedApi.post).mock.calls[0][1]).toEqual({
      queries: [
        { source: "collection:posts", op: "count" },
        { source: "collection:pages", op: "count" },
      ],
    });
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
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [
        { ok: true, result: { op: "count", total: 1 } },
        { ok: true, result: { op: "count", total: 2 } },
      ],
    });

    const { container } = renderGrid();
    await waitFor(() =>
      expect(screen.getByTestId("widget-cell-posts")).toHaveTextContent("1")
    );
    expect(container.querySelectorAll("[aria-live]")).toHaveLength(1);
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
    vi.mocked(protectedApi.post).mockResolvedValue({
      results: [
        { ok: true, result: { op: "count", total: 1 } },
        { ok: true, result: { op: "count", total: 2 } },
      ],
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
