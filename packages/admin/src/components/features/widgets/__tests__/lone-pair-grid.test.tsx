/**
 * The pair that shares a row of the default dashboard, drawn by the grid: while Upcoming
 * releases hides because it has nothing to say, Needs attention is drawn across the row, and
 * nothing is saved; with both on show, or on a dashboard the reader arranged, each keeps its
 * own width.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const ATTENTION = "core/needs-attention";
const RELEASES = "core/upcoming-releases";

/** A list card that hides while its answer is empty, up to the full row wide. */
const listCard = (id: string, source: string, w: number) => ({
  id,
  title: id,
  archetype: "list",
  size: { default: { w, h: 4 }, min: { w: 4, h: 4 }, max: { w: 12, h: 8 } },
  query: { source, op: "list", select: ["title"], limit: 5 },
  hidesWhenEmpty: true,
});

const branding = {
  widgets: [
    listCard(ATTENTION, "collection:attention", 8),
    listCard(RELEASES, "collection:releases", 4),
  ],
} as unknown as AdminBranding;

/** The pair as a layout read answers it, from `source`. */
function layoutRead(
  source: DashboardLayoutResponse["source"]
): DashboardLayoutResponse {
  return {
    placements: [
      { id: ATTENTION, widgetId: ATTENTION, w: 8, h: 4, removed: false },
      { id: RELEASES, widgetId: RELEASES, w: 4, h: 4, removed: false },
    ],
    widgets: {
      [ATTENTION]: { allowsSeveral: false },
      [RELEASES]: { allowsSeveral: false },
    },
    available: [],
    defaultPlacements: [],
    // Widgets the layout read cannot answer ahead: each card leaves while its own answer is empty.
    hiddenWhenAnswerEmpty: [ATTENTION, RELEASES],
    version: source === "own" ? 2 : 0,
    source,
    scope: "tok",
    audience: "aud",
  };
}

/** Each source's rows: the attention card always has one; the releases card has `releases`. */
function answerWith(releases: string[]): void {
  api.post.mockImplementation((_url, body) =>
    Promise.resolve({
      results: (body as { queries: { source: string }[] }).queries.map(
        query => ({
          ok: true,
          result: {
            op: "list",
            items:
              query.source === "collection:releases"
                ? releases.map(title => ({ title }))
                : [{ title: "Three unpublished changes" }],
          },
        })
      ),
    })
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

const cell = (id: string) => screen.getByTestId(`widget-cell-${id}`);

/** Resolves once the releases card has been taken off the dashboard for being empty. */
async function releasesHidden(): Promise<void> {
  await waitFor(() =>
    expect(cell(RELEASES).querySelector("[data-hidden-empty]")).not.toBeNull()
  );
}

beforeEach(() => {
  stubDashboardWidth(1440);
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  unstubDashboardWidth();
});

describe("the pair on the default dashboard", () => {
  it("draws Needs attention across the row while Upcoming releases hides, and saves nothing", async () => {
    api.get.mockResolvedValue(layoutRead("default"));
    answerWith([]);
    renderGrid();
    await releasesHidden();
    // Twelve columns at every band, the eight-column class gone.
    await waitFor(() =>
      expect(cell(ATTENTION)).not.toHaveClass(
        "@min-[1024px]/dashboard:col-span-8"
      )
    );
    expect(cell(ATTENTION)).toHaveClass("col-span-12");
    // Drawn, never stored: no layout write was made.
    expect(api.put).not.toHaveBeenCalled();
  });

  it("keeps each at its own width while both are on show", async () => {
    api.get.mockResolvedValue(layoutRead("default"));
    answerWith(["Spring launch"]);
    renderGrid();
    expect(await screen.findByText("Spring launch")).toBeInTheDocument();
    expect(cell(ATTENTION)).toHaveClass("@min-[1024px]/dashboard:col-span-8");
    expect(cell(RELEASES)).toHaveClass("@min-[1024px]/dashboard:col-span-4");
  });
});

describe("the pair on a dashboard the reader arranged", () => {
  it("keeps Needs attention at the width they saved while Upcoming releases hides", async () => {
    // The control for the case above: the same answers, an arrangement of the reader's own.
    api.get.mockResolvedValue(layoutRead("own"));
    answerWith([]);
    renderGrid();
    await releasesHidden();
    expect(cell(ATTENTION)).toHaveClass("@min-[1024px]/dashboard:col-span-8");
  });
});
