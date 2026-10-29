/**
 * The dashboard's requests follow each card's size, and a change asks again only for a card
 * that now draws more.
 *
 * Every card's first query is sized for the card it will be drawn as, so no request leaves
 * before the dashboard has a width. A list's rows are counted from the card's height, so a
 * change of width asks nothing, and a card made taller asks again on its own; a card made
 * shorter keeps the answer it has.
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

/** A list card asking `limit` rows of a collection, declared `w` columns wide and `h` rows tall. */
function listCard(id: string, source: string, w: number, limit: number, h = 4) {
  return {
    id,
    title: id,
    archetype: "list",
    size: { default: { w, h } },
    query: { source, op: "list", select: ["title"], limit },
  };
}

// Six columns is drawn at a half, twelve at full width. Four rows tall, each body holds four
// rows: the half asks eight and draws four; the full card asks five and draws four.
const HALF = listCard("acme/half", "collection:posts", 6, 8);
const FULL = listCard("acme/full", "collection:pages", 12, 5);

/** The dashboard with the half drawn `h` rows tall, as a change of its size makes it. */
function halfAt(h: number): AdminBranding {
  return {
    plugins: [
      {
        name: "@acme",
        collections: [],
        widgets: [listCard("acme/half", "collection:posts", 6, 8, h), FULL],
      },
    ],
  } as unknown as AdminBranding;
}

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
  const drawn = render(<WidgetGrid />, { wrapper: Wrapper });
  return {
    ...drawn,
    /** Draws the half `h` rows tall. */
    resizeHalf(h: number) {
      mockBranding = halfAt(h);
      drawn.rerender(<WidgetGrid />);
    },
  };
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

  it("sizes each card's first query for the rows its height holds", async () => {
    // Four rows tall, each body holds four rows, asked as five, whatever its width: the half is
    // small on 680 px and the full card medium.
    stubDashboardWidth(680);
    renderGrid();
    await waitFor(() => expect(sentQueries()).toHaveLength(1));
    const [first] = sentQueries();
    expect(first.find(q => q.source === "collection:posts")?.limit).toBe(5);
    expect(first.find(q => q.source === "collection:pages")?.limit).toBe(5);
  });

  it("asks nothing when the dashboard widens, since a card's rows follow its height", async () => {
    stubDashboardWidth(680);
    renderGrid();
    await waitFor(() => expect(sentQueries()).toHaveLength(1));
    // 1,200 px: both cards are wider, at another tier, and four rows tall still.
    resizeDashboard(1200);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(sentQueries()).toHaveLength(1);
  });

  it("keeps the answer it has when the larger one fails, and does not ask for it again", async () => {
    // The batch answers both cards; the half's own re-ask, once it is taller, is refused.
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
    const grid = renderGrid();
    await waitFor(() => expect(screen.getAllByText("Kept")).toHaveLength(2));

    grid.resizeHalf(6);
    await waitFor(() => expect(sentQueries()).toHaveLength(2));
    // Long enough for the refusal to land, and for a repeat to have left if one were going to.
    await new Promise(resolve => setTimeout(resolve, 100));
    // 🔴 The smaller answer is still drawn: a resize during a failure is not an error.
    expect(screen.getAllByText("Kept")).toHaveLength(2);
    // And the failed size is not asked again on its own, round after round.
    expect(sentQueries()).toHaveLength(2);
  });

  it("marks the card busy while it is asked again for its new size", async () => {
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
    const grid = renderGrid();
    await waitFor(() => expect(screen.getAllByText("Kept")).toHaveLength(2));

    grid.resizeHalf(6);
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

  it("draws a kept smaller answer at its own size after the card grew", async () => {
    // The half is fetched four rows tall, four rows and the one more; its re-ask at six rows
    // tall is refused. It keeps the smaller answer, and counts it at its own size: four rows and
    // a footer saying more exist, never the extra row drawn as a fifth item.
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
    const grid = renderGrid();
    const half = () =>
      document.querySelector<HTMLElement>('[data-card-id="acme/half"]');
    await waitFor(() =>
      expect(half()?.textContent).toContain("collection:posts 4")
    );

    grid.resizeHalf(6);
    await waitFor(() => expect(sentQueries()).toHaveLength(2));
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(half()?.querySelectorAll('[data-testid="entity-row"]')).toHaveLength(
      4
    );
    expect(
      half()?.querySelector('[data-testid="list-card-footer"]')
    ).toHaveTextContent("View all (5+)");
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
              size: { default: { w: 6, h: 4 } },
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

  it("sizes a custom widget's list query when it asks to be, as core's lists are sized", async () => {
    // The opt-in: a component that draws by the card's size is asked the rows it draws and
    // the one more that says more exist, where an unsized custom card above gets exactly 8.
    // Four rows tall, its body holds four rows, and one more.
    mockBranding = {
      plugins: [
        {
          name: "@acme",
          collections: [],
          widgets: [
            {
              id: "acme/sized",
              title: "acme/sized",
              archetype: "custom",
              component: "@acme/admin#Sized",
              size: { default: { w: 6, h: 4 } },
              sizedQuery: true,
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
      expect.objectContaining({ source: "collection:posts", limit: 5 }),
    ]);
  });

  it("asks again for the card made taller at the same width, alone, and for nothing when it shrinks", async () => {
    stubDashboardWidth(680);
    const grid = renderGrid();
    await waitFor(() => expect(sentQueries()).toHaveLength(1));

    // Six rows tall, the half's body holds seven rows where four were fetched.
    grid.resizeHalf(6);
    await waitFor(() => expect(sentQueries()).toHaveLength(2));
    // 🔴 One card's question, not the dashboard's: a batch that re-keyed on the size would
    // send both cards again here. Seven rows of its eight, and the one more.
    expect(sentQueries()[1]).toEqual([
      expect.objectContaining({ source: "collection:posts", limit: 8 }),
    ]);

    // Back to four rows tall: the half draws a prefix of what it holds.
    grid.resizeHalf(4);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(sentQueries()).toHaveLength(2);
  });
});
