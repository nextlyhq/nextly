/**
 * The dashboard asks for no card before it has a width.
 *
 * Every card's first ask carries the size it will be drawn at, which its widget's `load` is
 * handed, so no request leaves before the dashboard has a width to predict each card's tier
 * from. That a card resized or crossing a tier asks again alone is `declared-card-asks`'s.
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
// The batch answered as the `protectedApi.post` mock above describes it; see `batch-over-post`.
vi.mock("@admin/hooks/queries/widget-query-stream", async () =>
  (
    await import("@admin/hooks/queries/__tests__/batch-over-post")
  ).streamOverPost()
);

/** A declared list card, `w` columns wide, answered on the server by its card id. */
function listCard(id: string, w: number) {
  return { id, title: id, archetype: "list", size: { default: { w, h: 4 } } };
}

const HALF = listCard("acme/half", 6);
const FULL = listCard("acme/full", 12);

/** The cards each batch request asked for, in order. */
function sentQueries(): unknown[][] {
  return vi
    .mocked(protectedApi.post)
    .mock.calls.filter(([url]) => url === "/dashboard/query")
    .map(([, body]) => (body as { queries: unknown[] }).queries);
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
    widgets: [HALF, FULL],
  } as unknown as AdminBranding;
  // Each card answered with an empty list, one slot per card asked.
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
});
