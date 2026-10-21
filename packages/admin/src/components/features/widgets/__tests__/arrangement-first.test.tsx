/**
 * The dashboard knows which cards a person has before it draws or fetches any.
 *
 * The declared widgets are known from the workspace payload the moment the
 * page mounts; the person's arrangement arrives with the layout read after.
 * Drawing the declared cards in the meantime, and asking for their data, drew
 * a dashboard the person may not have -- in another order, at other widths,
 * with cards they removed -- and then redrew it, which is the jump a reader
 * sees and the layout shift that measures it.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DASHBOARD_LAYOUT_KEY } from "@admin/hooks/queries/useDashboardLayout";
import { protectedApi } from "@admin/lib/api/protectedApi";
import type { AdminBranding } from "@admin/types/branding";
import type { DashboardLayoutResponse } from "@admin/types/dashboard/widgets";

import { WidgetGrid } from "../WidgetGrid";

import { stubDashboardWidth, unstubDashboardWidth } from "./dashboard-width";

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => branding,
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
  protectedApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
// The batch answered as the `protectedApi.post` mock above describes it; see `batch-over-post`.
vi.mock("@admin/hooks/queries/widget-query-stream", async () =>
  (
    await import("@admin/hooks/queries/__tests__/batch-over-post")
  ).streamOverPost()
);

const api = vi.mocked(protectedApi);

/** Two data widgets, each fetching its own count. */
const branding = {
  widgets: ["posts", "orders"]
    .map(name => ({
      id: `acme/${name}`,
      title: `${name} count`,
      archetype: "metric",
      defaultSize: "sm",
      query: { source: `collection:${name}`, op: "count" },
    }))
    .concat([
      {
        // Declared at half width, so a card sized from its declaration and one
        // sized from an arrangement that widens it ask for different rows.
        id: "acme/recent",
        title: "recent list",
        archetype: "list",
        defaultSize: "lg",
        query: {
          source: "collection:recent",
          op: "list",
          select: ["title"],
          limit: 8,
        },
      } as never,
    ]),
} as unknown as AdminBranding;

/** This person's arrangement: only the orders card. */
const arrangement: DashboardLayoutResponse = {
  placements: [
    { id: "p-orders", widgetId: "acme/orders", width: "third", removed: false },
  ],
  widgets: {
    "acme/orders": {
      allowedWidths: ["quarter", "third", "half", "twoThirds", "full"],
      defaultWidth: "third",
      allowsSeveral: false,
    },
  },
  available: ["acme/posts"],
  defaultPlacements: [],
  version: 2,
  source: "own",
  scope: "tok",
  audience: "aud",
};

/** The sources every widget query asked for so far, across every batch. */
function askedSources(): string[] {
  return api.post.mock.calls.flatMap(([, body]) =>
    ((body as { queries?: { source: string }[] }).queries ?? []).map(
      query => query.source
    )
  );
}

function renderGrid(client: QueryClient) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<WidgetGrid />, { wrapper: Wrapper });
}

function newClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: 0 } },
  });
}

beforeEach(() => {
  // A measured dashboard, so a card's first query is not held for a width.
  stubDashboardWidth(1200);
  vi.clearAllMocks();
  api.post.mockResolvedValue({
    results: [{ ok: true, result: { op: "count", total: 7 } }],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  unstubDashboardWidth();
});

describe("before the arrangement is known", () => {
  it("draws no card and asks for no card's data", async () => {
    // A layout read that has not answered.
    api.get.mockReturnValue(new Promise(() => undefined));
    renderGrid(newClient());
    expect(
      await screen.findByRole("status", { name: /loading your dashboard/i })
    ).toBeInTheDocument();
    // 🔴 The separating case: both widgets are declared and could be drawn,
    // and drawing the declared set is exactly what a page that did not wait
    // would do.
    expect(screen.queryByTestId(/^widget-cell-/)).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("draws and fetches only the person's own cards once it arrives", async () => {
    let answer: (value: DashboardLayoutResponse) => void = () => undefined;
    api.get.mockReturnValue(
      new Promise<DashboardLayoutResponse>(resolve => {
        answer = resolve;
      })
    );
    renderGrid(newClient());
    await screen.findByRole("status", { name: /loading your dashboard/i });
    answer(arrangement);
    expect(
      await screen.findByTestId("widget-cell-acme/orders")
    ).toBeInTheDocument();
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    // The declared posts card is not in this arrangement: never drawn, never
    // asked about.
    expect(screen.queryByTestId("widget-cell-acme/posts")).toBeNull();
    expect(askedSources()).toEqual(["collection:orders"]);
    expect(
      screen.queryByRole("status", { name: /loading your dashboard/i })
    ).toBeNull();
  });
});

describe("a return visit in the same session", () => {
  it("draws the cached arrangement at once, while it is read again behind it", async () => {
    const client = newClient();
    client.setQueryData(DASHBOARD_LAYOUT_KEY, arrangement);
    // Marked stale, so mounting reads the layout again; that read never
    // answers here, and the cards must not wait for it.
    await client.invalidateQueries({ queryKey: DASHBOARD_LAYOUT_KEY });
    api.get.mockReturnValue(new Promise(() => undefined));
    renderGrid(client);
    expect(screen.getByTestId("widget-cell-acme/orders")).toBeInTheDocument();
    expect(
      screen.queryByRole("status", { name: /loading your dashboard/i })
    ).toBeNull();
    await waitFor(() => expect(askedSources()).toEqual(["collection:orders"]));
  });
});

describe("when the arrangement cannot be read", () => {
  it("draws the declared default rather than nothing", async () => {
    api.get.mockRejectedValue(new Error("layout unavailable"));
    renderGrid(newClient());
    expect(
      await screen.findByTestId("widget-cell-acme/posts")
    ).toBeInTheDocument();
    expect(screen.getByTestId("widget-cell-acme/orders")).toBeInTheDocument();
  });
});

describe("the first request a card makes", () => {
  it("is sized for the width its arrangement gives it, not its declared one", async () => {
    // On 680 px a half card is 328 px wide, small: three rows, asked as four. This person's
    // arrangement draws the same card full width, 680 px, medium: eight rows, asked as nine.
    // 🔴 A grid that sized from the declaration while the arrangement was on its way would ask
    // four first. The declared fallback (a FAILED read) cannot tell the two apart, so this is
    // the case that does.
    unstubDashboardWidth();
    stubDashboardWidth(680);
    api.get.mockResolvedValue({
      ...arrangement,
      placements: [
        {
          id: "p-recent",
          widgetId: "acme/recent",
          width: "full",
          removed: false,
        },
      ],
      widgets: {
        "acme/recent": {
          allowedWidths: ["third", "half", "twoThirds", "full"],
          defaultWidth: "half",
          allowsSeveral: false,
        },
      },
      available: [],
    });
    api.post.mockImplementation((_url, body) =>
      Promise.resolve({
        results: (body as { queries: unknown[] }).queries.map(() => ({
          ok: true,
          result: { op: "list", items: [] },
        })),
      })
    );
    renderGrid(newClient());
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [, firstBody] = api.post.mock.calls[0];
    const first = (
      firstBody as { queries: { source: string; limit?: number }[] }
    ).queries.find(query => query.source === "collection:recent");
    expect(first?.limit).toBe(9);
  });
});
