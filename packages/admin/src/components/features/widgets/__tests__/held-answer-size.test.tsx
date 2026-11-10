/**
 * A list card that changes density keeps its old answer on screen while the answer for its new
 * density loads, and draws that answer by the density it was fetched at.
 *
 * A size-aware `load` reads one row more than the card draws, the sign that more exist. Drawn by
 * the card's new, denser rows, that one more would read as one more row until the new answer
 * arrived; drawn by what it was fetched at, it stays the sign it is.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { protectedApi } from "@admin/lib/api/protectedApi";
import type { AdminBranding } from "@admin/types/branding";
import type {
  DashboardLayoutResponse,
  WidgetPlacement,
} from "@admin/types/dashboard/widgets";

import { rowsDrawn } from "../frame/tier";
import { WidgetGrid } from "../WidgetGrid";

import { stubDashboardWidth, unstubDashboardWidth } from "./dashboard-width";

let layoutResponse: DashboardLayoutResponse | undefined;

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

const RECENT = "core/recent";

/**
 * A declared list card, half the row wide and three rows high, whose density is a quick setting,
 * default unless the reader chooses compact.
 */
const branding = {
  widgets: [
    {
      id: RECENT,
      title: "Recent",
      archetype: "list",
      size: {
        default: { w: 6, h: 3 },
        min: { w: 3, h: 2 },
        max: { w: 12, h: 6 },
      },
      settings: [
        {
          name: "density",
          type: "select",
          label: "Density",
          quick: true,
          defaultValue: "default",
          options: [
            { label: "Default", value: "default" },
            { label: "Compact", value: "compact" },
          ],
        },
      ],
    },
  ],
} as unknown as AdminBranding;

const PLACED: WidgetPlacement = {
  id: "p1",
  widgetId: RECENT,
  w: 6,
  h: 3,
  removed: false,
};

/** The size a card is asked at, as the batch sends it beside the card. */
type AskedSize = { w: number; h: number; tier: "small" | "medium" | "large" };

/** The rows a card of `size` draws, as its widget's `load` counts them. */
const rowsAt = (size: AskedSize) =>
  rowsDrawn({ tier: size.tier, h: size.h }, undefined);

/** The sizes each card was asked at, in the order asked. */
const askedSizes = () =>
  api.post.mock.calls.flatMap(
    ([, body]) =>
      (body as { queries: { size?: AskedSize }[] }).queries.map(
        query => query.size
      ) ?? []
  );

function renderGrid() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, gcTime: 0 },
      mutations: { retry: 0, retryDelay: 0 },
    },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<WidgetGrid />, { wrapper: Wrapper });
}

beforeEach(() => {
  stubDashboardWidth(1200);
  vi.clearAllMocks();
  layoutResponse = {
    placements: [PLACED],
    widgets: { [RECENT]: { allowsSeveral: false } },
    available: [],
    defaultPlacements: [PLACED],
    version: 3,
    source: "own",
    arranged: true,
    scope: "tok",
    audience: "aud",
  };
  api.get.mockImplementation(() => Promise.resolve(layoutResponse));
  // The server's answer to a write: what was written, under the next version.
  api.put.mockImplementation((_path: string, body: unknown) => {
    const before = layoutResponse as DashboardLayoutResponse;
    layoutResponse = {
      ...before,
      placements: (body as { placements: WidgetPlacement[] }).placements,
      version: before.version + 1,
    };
    return Promise.resolve({ message: "ok", item: {} });
  });
});

afterEach(() => {
  unstubDashboardWidth();
});

describe("a list card whose density changes while its old answer is on screen", () => {
  it("draws that answer by the density it was fetched at, so its one row more is never drawn", async () => {
    // Asked at the default density; once the reader chooses compact, the card's ask for its new
    // density stays on its way, so the card keeps the answer it had.
    api.post.mockImplementation((_url, body) => {
      if (api.put.mock.calls.length > 0) return new Promise(() => {});
      const queries = (body as { queries: { size?: AskedSize }[] }).queries;
      return Promise.resolve({
        results: queries.map(query => ({
          ok: true,
          result: {
            op: "list",
            items: Array.from(
              {
                length: (query.size === undefined ? 5 : rowsAt(query.size)) + 1,
              },
              (_, index) => ({ title: `Entry ${index + 1}` })
            ),
          },
        })),
      });
    });
    renderGrid();
    const user = userEvent.setup();
    const cell = await screen.findByTestId(`widget-cell-${RECENT}`);
    await waitFor(() =>
      expect(within(cell).getAllByTestId("entity-row").length).toBeGreaterThan(
        0
      )
    );
    const [first] = askedSizes();
    if (first === undefined) throw new Error("the card was asked with no size");
    const before = rowsAt(first);
    expect(within(cell).getAllByTestId("entity-row")).toHaveLength(before);

    // Compact rows are shorter: the same card has room for every row the answer on screen holds,
    // the one more included, so drawn by its new density that one more would be a row.
    expect(
      rowsDrawn({ tier: first.tier, h: first.h }, undefined, "compact")
    ).toBeGreaterThanOrEqual(before + 1);
    const asksBefore = api.post.mock.calls.length;
    await user.click(await screen.findByRole("button", { name: "Recent" }));
    const popover = await screen.findByRole("dialog", {
      name: "Quick settings for Recent",
    });
    await user.click(
      within(popover).getByRole("combobox", { name: "Density" })
    );
    await user.click(await screen.findByRole("option", { name: "Compact" }));

    // Saved, and the card asked again for its new density, that answer still on its way: the
    // card keeps the one it had, drawn by the density it was fetched at.
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(
      (
        api.put.mock.calls[0]?.[1] as { placements: WidgetPlacement[] }
      ).placements.find(placement => placement.id === PLACED.id)?.config
    ).toEqual({ density: "compact" });
    await waitFor(() =>
      expect(api.post.mock.calls.length).toBeGreaterThan(asksBefore)
    );
    expect(within(cell).getAllByTestId("entity-row")).toHaveLength(before);
    expect(within(cell).queryByText(`Entry ${before + 1}`)).toBeNull();
  });
});
