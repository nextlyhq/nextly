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
import { render, screen, waitFor } from "@testing-library/react";
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

  it("keeps the answer it has when the larger one fails, and does not ask for it again", async () => {
    // The batch answers both cards; the half's own re-ask, once it rises, is refused.
    vi.mocked(protectedApi.post).mockImplementation((_url, body) => {
      const queries = (body as { queries: unknown[] }).queries;
      return Promise.resolve({
        results: queries.map(() =>
          queries.length === 1
            ? { ok: false, error: "The read failed.", code: "internal" }
            : { ok: true, result: { op: "list", items: [{ title: "Kept" }] } }
        ),
      });
    });
    stubDashboardWidth(680);
    renderGrid();
    await waitFor(() => expect(screen.getAllByText("Kept")).toHaveLength(2));

    resizeDashboard(720);
    await waitFor(() => expect(sentQueries()).toHaveLength(2));
    // Long enough for the refusal to land, and for a repeat to have left if one were going to.
    await new Promise(resolve => setTimeout(resolve, 100));
    // 🔴 The smaller answer is still drawn: a resize during a failure is not an error.
    expect(screen.getAllByText("Kept")).toHaveLength(2);
    // And the failed tier is not asked again on its own, round after round.
    expect(sentQueries()).toHaveLength(2);
  });

  it("marks the card busy while it is asked again for its new tier", async () => {
    // The half's own re-ask is held open; the card keeps its answer on screen meanwhile, and
    // says it is reading again, as it would for any refetch.
    let release: () => void = () => {};
    vi.mocked(protectedApi.post).mockImplementation((_url, body) => {
      const queries = (body as { queries: unknown[] }).queries;
      const answer = {
        results: queries.map(() => ({
          ok: true,
          result: { op: "list", items: [{ title: "Kept" }] },
        })),
      };
      if (queries.length > 1) return Promise.resolve(answer);
      return new Promise(resolve => (release = () => resolve(answer)));
    });
    stubDashboardWidth(680);
    renderGrid();
    await waitFor(() => expect(screen.getAllByText("Kept")).toHaveLength(2));

    resizeDashboard(720);
    await waitFor(() => expect(sentQueries()).toHaveLength(2));
    const body = () =>
      document.querySelector(
        '[data-card-id="acme/half"] [data-testid="widget-card-body"]'
      );
    await waitFor(() => expect(body()).toHaveAttribute("aria-busy", "true"));
    expect(screen.getAllByText("Kept")).toHaveLength(2);
    release();
    await waitFor(() =>
      expect(body()).not.toHaveAttribute("aria-busy", "true")
    );
  });

  it("draws a kept smaller answer at its own tier after the card grew", async () => {
    // The half is fetched at small, three rows and the one more; its re-ask for medium is
    // refused. It keeps the small answer, and counts it at small: three rows and More exist,
    // never the extra row drawn as a fourth item.
    vi.mocked(protectedApi.post).mockImplementation((_url, body) => {
      const queries = (
        body as { queries: Array<{ source: string; limit?: number }> }
      ).queries;
      return Promise.resolve({
        results: queries.map(query =>
          queries.length === 1
            ? { ok: false, error: "The read failed.", code: "internal" }
            : {
                ok: true,
                result: {
                  op: "list",
                  items: Array.from({ length: query.limit ?? 0 }, (_, i) => ({
                    title: `${query.source} ${i + 1}`,
                  })),
                },
              }
        ),
      });
    });
    stubDashboardWidth(680);
    renderGrid();
    const half = () =>
      document.querySelector<HTMLElement>('[data-card-id="acme/half"]');
    await waitFor(() =>
      expect(half()?.textContent).toContain("collection:posts 3")
    );

    resizeDashboard(720);
    await waitFor(() => expect(sentQueries()).toHaveLength(2));
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(
      half()?.querySelectorAll('[data-testid="widget-list-row"]')
    ).toHaveLength(3);
    expect(half()?.textContent).toContain("More exist");
  });

  it("asks a custom widget's query as declared, at any tier", async () => {
    // A plugin's own component draws a custom card from the raw answer, with no tier and no
    // row slicer, so its query is never sized: the rows it asked for are the rows it gets.
    mockBranding = {
      plugins: [
        {
          name: "@acme",
          collections: [],
          widgets: [
            {
              id: "acme/custom",
              title: "acme/custom",
              archetype: "custom",
              component: "@acme/admin#Custom",
              defaultSize: "lg",
              query: {
                source: "collection:posts",
                op: "list",
                select: ["title"],
                limit: 8,
              },
            },
          ],
        },
      ],
    } as unknown as AdminBranding;
    stubDashboardWidth(680);
    renderGrid();
    await waitFor(() => expect(sentQueries()).toHaveLength(1));
    expect(sentQueries()[0]).toEqual([
      expect.objectContaining({ source: "collection:posts", limit: 8 }),
    ]);
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
