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
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<WidgetGrid />, { wrapper: Wrapper });
}

function brandingWith(widgets: unknown[]): AdminBranding {
  return {
    plugins: [{ name: "@acme", collections: [], widgets }],
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

describe("WidgetGrid — accessibility", () => {
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
