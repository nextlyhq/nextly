/**
 * The dashboard's batch is asked under the token of the layout answer its cards are drawn from.
 *
 * On a focus the layout and the batch are read again side by side, and the batch can start before
 * the fresh layout answer lands. The server hands a card the answer its layout read worked out
 * ahead only to a batch naming that read's token, so a batch asked under the token held before
 * draws a card the fresh layout revealed from an answer that layout never judged. The batch is
 * asked again, once, under the fresh token, and the revealed card is drawn from that answer.
 *
 * And a card the layout read hid is shown by its own batch answer once that holds something, the
 * layout read's verdict unchanged.
 */
import {
  focusManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
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
// The batch answered as the `protectedApi.post` mock describes it, its token posted beside the
// queries; see `batch-over-post`.
vi.mock("@admin/hooks/queries/widget-query-stream", async () =>
  (
    await import("@admin/hooks/queries/__tests__/batch-over-post")
  ).streamOverPost()
);

const api = vi.mocked(protectedApi);

/** One card that leaves the dashboard while empty, counting the orders waiting. */
const branding = {
  widgets: [
    {
      id: "acme/waiting",
      title: "Orders waiting",
      archetype: "metric",
      size: { default: { w: 4, h: 3 } },
      query: { source: "collection:orders", op: "count" },
      hidesWhenEmpty: true,
    },
  ],
} as unknown as AdminBranding;

/** A layout answer placing that card, judged empty or not, under the load `token` names. */
function layoutOf(token: string, empty: boolean): DashboardLayoutResponse {
  return {
    placements: [
      { id: "p-waiting", widgetId: "acme/waiting", w: 4, h: 3, removed: false },
    ],
    widgets: { "acme/waiting": { allowsSeveral: false } },
    available: [],
    defaultPlacements: [],
    version: 1,
    source: "own",
    scope: "tok",
    audience: "aud",
    hiddenWhileEmpty: empty ? ["p-waiting"] : [],
    hiddenWhenAnswerEmpty: [],
    readAheadToken: token,
  };
}

/** The token each batch request was posted with, in order; `undefined` for one with none. */
function postedTokens(): Array<string | undefined> {
  return api.post.mock.calls
    .filter(([url]) => url === "/dashboard/query")
    .map(([, body]) => (body as { readAheadToken?: string }).readAheadToken);
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
  stubDashboardWidth(1200);
  vi.clearAllMocks();
  // The server's answer for the count: under `load-2`, the load whose layout read found an order
  // waiting, the batch is handed that read's answer; asked under any other token, or none, it was
  // read before the order arrived. None waiting is an answer the card's own empty test holds for,
  // as the layout read judged it, so that answer never shows the card it hid.
  api.post.mockImplementation((_url, body) => {
    const { readAheadToken } = body as { readAheadToken?: string };
    const total = readAheadToken === "load-2" ? 3 : 0;
    return Promise.resolve({
      results: [
        {
          ok: true,
          result: { op: "count", total },
          ...(total === 0 ? { empty: true } : {}),
        },
      ],
    });
  });
});

afterEach(() => {
  focusManager.setFocused(undefined);
  vi.restoreAllMocks();
  unstubDashboardWidth();
});

describe("a focus whose layout read lands after the batch was asked again", () => {
  it("asks the batch again, once, under the fresh layout's token, and draws the card it reveals from that answer", async () => {
    // The first visit: nothing waiting, so the card is drawn without, under `load-1`. Any read
    // before the focus below answers the same.
    api.get.mockResolvedValue(layoutOf("load-1", true));
    renderGrid();
    const card = await screen.findByRole("region", { name: "Orders waiting" });
    expect(card).toHaveAttribute("data-hidden-empty");
    await waitFor(() => expect(postedTokens()).toEqual(["load-1"]));

    // The reader comes back to the tab. The layout read is in flight while the batch, refetched on
    // the same focus, is asked under the token the dashboard still holds.
    let land!: (answer: DashboardLayoutResponse) => void;
    api.get.mockReturnValueOnce(
      new Promise<DashboardLayoutResponse>(resolve => {
        land = resolve;
      })
    );
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(postedTokens()).toEqual(["load-1", "load-1"]));

    // The fresh layout lands: an order arrived, so the card is revealed, under `load-2`.
    await act(async () => {
      land(layoutOf("load-2", false));
    });

    // The batch is asked again under the fresh token, once...
    await waitFor(() =>
      expect(postedTokens()).toEqual(["load-1", "load-1", "load-2"])
    );
    // ...and the revealed card shows that answer: the order the layout read found, not the
    // empty count read before it.
    const revealed = screen.getByRole("region", { name: "Orders waiting" });
    await waitFor(() =>
      expect(
        within(revealed).getByTestId("widget-metric-value")
      ).toHaveTextContent("3")
    );
    expect(revealed).not.toHaveAttribute("data-hidden-empty");
    expect(postedTokens()).toEqual(["load-1", "load-1", "load-2"]);
  });
});

describe("a card the layout read found empty", () => {
  it("is shown once its own batch answer holds something, the layout read's verdict unchanged", async () => {
    // Every layout read finds the card empty, under the one load.
    api.get.mockResolvedValue(layoutOf("load-1", true));
    let total = 0;
    api.post.mockImplementation(() =>
      Promise.resolve({
        results: [
          {
            ok: true,
            result: { op: "count", total },
            ...(total === 0 ? { empty: true } : {}),
          },
        ],
      })
    );
    renderGrid();
    const card = await screen.findByRole("region", { name: "Orders waiting" });
    await waitFor(() => expect(postedTokens()).toEqual(["load-1"]));
    // Answered, and its own empty test held: still off the page.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(card).toHaveAttribute("data-hidden-empty");

    // An order arrives, and a focus asks the batch again; the layout read still finds the card
    // empty, so only the card's own answer can show it.
    total = 2;
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(postedTokens()).toEqual(["load-1", "load-1"]));
    const shown = screen.getByRole("region", { name: "Orders waiting" });
    await waitFor(() => expect(shown).not.toHaveAttribute("data-hidden-empty"));
    expect(within(shown).getByTestId("widget-metric-value")).toHaveTextContent(
      "2"
    );
  });
});
