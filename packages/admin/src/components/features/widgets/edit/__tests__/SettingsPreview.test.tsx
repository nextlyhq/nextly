/**
 * The settings panel's preview, drawn: at the tier the card's real width gives it, scaled down to
 * the panel when the card is wider, and saying "No entries match these filters", with a way to
 * clear them, while the panel's filters match nothing.
 *
 * Every element measures 480 pixels here, the panel's own width, which is what a preview that
 * measured itself would read its tier from.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { protectedApi } from "@admin/lib/api/protectedApi";
import type {
  DashboardWidget,
  WidgetSlot,
} from "@admin/types/dashboard/widgets";

import { gridBounds } from "../../__tests__/grid-bounds";
import { rowsDrawn } from "../../frame/tier";
import { NO_FILTER_MATCH, SettingsPreview } from "../SettingsPreview";

vi.mock("@admin/components/shared/preview/useMeasuredWidth", () => ({
  useMeasuredWidth: () => 480,
}));
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({
    widgetSources: [
      {
        collection: "posts",
        label: "Posts",
        lifecycle: false,
        fields: [{ name: "title", type: "string", label: "Title" }],
      },
    ],
  }),
  useBrandingStatus: () => ({
    isPending: false,
    isUnavailable: false,
    isBrandingUnavailable: false,
  }),
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

const WIDGET: DashboardWidget = {
  id: "core/recent",
  title: "Recent posts",
  archetype: "list",
  size: gridBounds(3, 4),
  settings: [
    { name: "collection", type: "collection", label: "Collection" },
    { name: "where", type: "filter", label: "Filter", of: "collection" },
  ],
};

const ROWS: WidgetSlot = {
  ok: true,
  result: { op: "list", items: [{ title: "First" }, { title: "Second" }] },
};
const NONE: WidgetSlot = { ok: true, result: { op: "list", items: [] } };

beforeEach(() => {
  vi.clearAllMocks();
  // Whatever the preview asks matches nothing.
  vi.mocked(protectedApi.post).mockImplementation((_url, body) =>
    Promise.resolve({
      results: (body as { queries: unknown[] }).queries.map(() => NONE),
    })
  );
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function preview(props: {
  draft?: Record<string, unknown>;
  slot?: WidgetSlot;
  w: number;
  cardWidth: number;
  onClearFilters?: () => void;
}) {
  render(
    <SettingsPreview
      widget={WIDGET}
      placementId="p1"
      stored={undefined}
      draft={props.draft ?? {}}
      ownTitle=""
      shown={{ slot: props.slot ?? ROWS, updatedAt: null, isFetching: false }}
      size={{ w: props.w, h: 4 }}
      cardWidth={props.cardWidth}
      onClearFilters={props.onClearFilters ?? (() => {})}
    />,
    { wrapper }
  );
  const box = screen.getByTestId("settings-preview");
  return {
    box,
    tier: box.querySelector("[data-tier]")?.getAttribute("data-tier"),
  };
}

describe("the preview's size", () => {
  it("draws a full-width card at the large tier its width gives it, scaled to the panel", () => {
    // 🔴 Measured inside the panel, the card would read the panel's 480 px: medium.
    const { box, tier } = preview({ w: 12, cardWidth: 1200 });
    expect(tier).toBe("large");
    expect(box).toHaveAttribute("data-scale", "0.4");
    expect(box.style.width).toBe("1200px");
  });

  it("draws a narrow card at its own small tier, unscaled", () => {
    const { box, tier } = preview({ w: 3, cardWidth: 300 });
    expect(tier).toBe("small");
    expect(box).toHaveAttribute("data-scale", "1");
  });

  it("draws the card's own held answer by the size it was fetched at, so its one row more is not drawn", () => {
    // The card grew from three rows to six and still shows the answer its three rows asked for:
    // the rows those three draw, and one more, the sign that more exist.
    const fetched = { tier: "medium" as const, h: 3 };
    const held = rowsDrawn(fetched, undefined);
    // Six rows have room for every row that answer holds, so drawn by the card's own size the one
    // more would be a row.
    expect(rowsDrawn({ tier: "medium", h: 6 }, undefined)).toBeGreaterThan(
      held + 1
    );
    const answer: WidgetSlot = {
      ok: true,
      result: {
        op: "list",
        items: Array.from({ length: held + 1 }, (_, index) => ({
          title: `Entry ${index + 1}`,
        })),
      },
    };
    render(
      <SettingsPreview
        widget={WIDGET}
        placementId="p1"
        stored={{ collection: "posts" }}
        draft={{ collection: "posts" }}
        ownTitle=""
        shown={{
          slot: answer,
          updatedAt: null,
          isFetching: true,
          answerSize: fetched,
        }}
        size={{ w: 6, h: 6 }}
        cardWidth={600}
        onClearFilters={() => {}}
      />,
      { wrapper }
    );
    const box = screen.getByTestId("settings-preview");
    // The question is the card's own, so the card's answer is what is drawn, and nothing is asked.
    expect(box).toHaveTextContent("Entry 1");
    expect(within(box).getAllByTestId("entity-row")).toHaveLength(held);
    expect(within(box).queryByText(`Entry ${held + 1}`)).toBeNull();
    expect(protectedApi.post).not.toHaveBeenCalled();
  });

  it("asks a changed question at the size and the tier it draws the card at", async () => {
    // 🔴 The tier is the one the card's real width gives it, large, not the panel's medium: what
    // the widget's `load` is handed is the size the preview shows.
    preview({ w: 12, cardWidth: 1200, draft: { collection: "posts" } });
    await waitFor(() => expect(protectedApi.post).toHaveBeenCalledTimes(1), {
      timeout: 3000,
    });
    const [, body] = vi.mocked(protectedApi.post).mock.calls[0] ?? [];
    expect((body as { queries: unknown[] }).queries).toEqual([
      expect.objectContaining({ size: { w: 12, h: 4, tier: "large" } }),
    ]);
  });
});

describe("the preview while the panel's filters match nothing", () => {
  it("says so, with Clear filters, rather than an empty card", async () => {
    const onClearFilters = vi.fn();
    preview({
      w: 6,
      cardWidth: 600,
      draft: { collection: "posts", where: { title: { equals: "nothing" } } },
      onClearFilters,
    });
    expect(
      await screen.findByText(NO_FILTER_MATCH, {}, { timeout: 3000 })
    ).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: "Clear filters" })
    );
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it("says so too for a filter its widget sets by default, which the stored settings leave out", async () => {
    // Stored settings hold only what departs from a default, so a default filter is absent from
    // them while the card still reads by it.
    const filteredByDefault: DashboardWidget = {
      ...WIDGET,
      settings: [
        { name: "collection", type: "collection", label: "Collection" },
        {
          name: "where",
          type: "filter",
          label: "Filter",
          of: "collection",
          defaultValue: { title: { equals: "nothing" } },
        },
      ],
    };
    render(
      <SettingsPreview
        widget={filteredByDefault}
        placementId="p1"
        stored={{ collection: "posts" }}
        draft={{ collection: "posts" }}
        ownTitle=""
        shown={{ slot: NONE, updatedAt: null, isFetching: false }}
        size={{ w: 6, h: 4 }}
        cardWidth={600}
        onClearFilters={() => {}}
      />,
      { wrapper }
    );
    expect(await screen.findByText(NO_FILTER_MATCH)).toBeTruthy();
  });

  it("leaves a card empty for another reason to say so in its own words", async () => {
    // The control: no filter in the panel, and the card's own answer is empty.
    const { box } = preview({ w: 6, cardWidth: 600, slot: NONE });
    // The card is drawn empty, so the absence below is the filter rule's, not a card never drawn.
    expect(box.querySelector("[data-state]")).toHaveAttribute(
      "data-state",
      "empty"
    );
    expect(screen.queryByText(NO_FILTER_MATCH)).toBeNull();
  });
});
