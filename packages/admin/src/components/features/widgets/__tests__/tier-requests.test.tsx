/**
 * The dashboard's requests follow each card's tier, and a resize asks again only for a card
 * that now draws more.
 *
 * Every card's first query is sized for the tier its card will be drawn at, so no request
 * leaves before the dashboard has a width. Afterwards a resize is not a new question for the
 * batch: a card that rose into a tier drawing more rows asks again on its own, and a card that
 * shrank keeps the answer it has.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { protectedApi } from "@admin/lib/api/protectedApi";
import { clearRegistry } from "@admin/lib/plugins/component-registry";
import type { AdminBranding } from "@admin/types/branding";

import { WidgetGrid } from "../WidgetGrid";

import {
  resizeDashboard,
  stubDashboardWidth,
  unstubDashboardWidth,
} from "./dashboard-width";

let mockBranding: AdminBranding | undefined;

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => mockBranding,
  useBrandingStatus: () => ({
    isPending: false,
    isUnavailable: false,
    isBrandingUnavailable: false,
  }),
}));
vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: () => ({ hasPermission: () => false }),
}));
vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: { post: vi.fn() },
}));

/** A list card asking eight rows of a collection, declared at `size`. */
function listCard(id: string, source: string, size: string) {
  return {
    id,
    title: id,
    archetype: "list",
    defaultSize: size,
    query: { source, op: "list", select: ["title"], limit: 8 },
  };
}

// `lg` is drawn at a half, `full` at full width.
const HALF = listCard("acme/half", "collection:posts", "lg");
const FULL = listCard("acme/full", "collection:pages", "full");

/** The widget queries each batch request sent, in order. */
function sentQueries(): Array<Array<{ source: string; limit?: number }>> {
  return vi
    .mocked(protectedApi.post)
    .mock.calls.filter(([url]) => url === "/dashboard/query")
    .map(
      ([, body]) =>
        (body as { queries: Array<{ source: string; limit?: number }> }).queries
    );
}

function renderGrid() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: 0 } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<WidgetGrid />, { wrapper: Wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockBranding = {
    plugins: [{ name: "@acme", collections: [], widgets: [HALF, FULL] }],
  } as unknown as AdminBranding;
  // Each query answered with an empty list, one slot per query asked.
  vi.mocked(protectedApi.post).mockImplementation((_url, body) =>
    Promise.resolve({
      results: (body as { queries: unknown[] }).queries.map(() => ({
        ok: true,
        result: { op: "list", items: [] },
      })),
    })
  );
});

afterEach(() => {
  clearRegistry();
  mockBranding = undefined;
  unstubDashboardWidth();
});

describe("the requests a dashboard sends as it is sized", () => {
  it("asks nothing before the dashboard has a width", async () => {
    stubDashboardWidth(0);
    renderGrid();
    // Long enough for a request to have left if one were going to.
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(sentQueries()).toEqual([]);

    resizeDashboard(1200);
    await waitFor(() => expect(sentQueries()).toHaveLength(1));
  });

  it("sizes each card's first query for the tier it is drawn at", async () => {
    // On 680 px the half spans six tracks and is 328 px wide: small, three rows asked as four.
    // The full card is 680 px wide: medium, eight rows asked as nine.
    stubDashboardWidth(680);
    renderGrid();
    await waitFor(() => expect(sentQueries()).toHaveLength(1));
    const [first] = sentQueries();
    expect(first.find(q => q.source === "collection:posts")?.limit).toBe(4);
    expect(first.find(q => q.source === "collection:pages")?.limit).toBe(9);
  });

  it("asks again for the card that rose, alone, and for nothing when it shrinks", async () => {
    stubDashboardWidth(680);
    renderGrid();
    await waitFor(() => expect(sentQueries()).toHaveLength(1));

    // 720 px: the half is 348 px wide and medium now, drawing eight rows where four were
    // fetched. The full card stays medium.
    resizeDashboard(720);
    await waitFor(() => expect(sentQueries()).toHaveLength(2));
    // 🔴 One card's question, not the dashboard's: a batch that re-keyed on the tier would
    // send both cards again here.
    expect(sentQueries()[1]).toEqual([
      expect.objectContaining({ source: "collection:posts", limit: 9 }),
    ]);

    // Back to 680 px: the half shrinks to small and draws a prefix of what it holds.
    resizeDashboard(680);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(sentQueries()).toHaveLength(2);
  });
});
