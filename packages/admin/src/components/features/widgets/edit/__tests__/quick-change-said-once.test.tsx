/**
 * A quick setting's change is said once: by the toast that offers its Undo, in a polite live
 * region, and not by the grid's own live region as well, so a screen reader hears it one time.
 * Drawn with the real toaster, so what is counted is what the page holds.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@nextlyhq/ui";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MAX_QUERIES_PER_REQUEST } from "nextly/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DASHBOARD_HEADING_ID } from "@admin/components/features/dashboard/WelcomeHeader";
import { protectedApi } from "@admin/lib/api/protectedApi";
import { registerCoreComponent } from "@admin/lib/plugins/component-registry-internal";
import type { AdminBranding } from "@admin/types/branding";
import type {
  DashboardLayoutResponse,
  WidgetPlacement,
} from "@admin/types/dashboard/widgets";

import { WidgetGrid } from "../../WidgetGrid";
import {
  stubDashboardWidth,
  unstubDashboardWidth,
} from "../../__tests__/dashboard-width";

let mockBranding: AdminBranding | undefined;
let layoutResponse: DashboardLayoutResponse | undefined;

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => mockBranding,
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

function Body() {
  return <p>Body</p>;
}
registerCoreComponent("core#SaidOnceBody", Body);

/** Resizable from 3 by 2 up to 12 by 6. */
const RESIZABLE = {
  default: { w: 4, h: 3 },
  min: { w: 3, h: 2 },
  max: { w: 12, h: 6 },
};

/** Two cards: one with a quick setting, and one with no settings that never declared `dismissible`. */
function branding(): AdminBranding {
  return {
    widgets: [
      {
        id: "core/styled",
        title: "Styled",
        archetype: "custom",
        size: RESIZABLE,
        component: "core#SaidOnceBody",
        settings: [
          {
            name: "accent",
            type: "select",
            label: "Accent",
            quick: true,
            defaultValue: "plain",
            options: [
              { label: "Plain", value: "plain" },
              { label: "Bold", value: "bold" },
              { label: "Soft", value: "soft" },
            ],
          },
        ],
      },
      {
        id: "core/plain",
        title: "Plain",
        archetype: "custom",
        size: RESIZABLE,
        component: "core#SaidOnceBody",
      },
    ],
  } as unknown as AdminBranding;
}

function layout(): DashboardLayoutResponse {
  return {
    placements: [
      {
        id: "p1",
        widgetId: "core/styled",
        w: 4,
        h: 3,
        removed: false,
        config: { accent: "soft" },
      },
      { id: "p2", widgetId: "core/plain", w: 4, h: 3, removed: false },
    ],
    widgets: {},
    available: [],
    defaultPlacements: [],
    version: 7,
    source: "own",
    // A row of dismissals at most: the reader still follows the default.
    arranged: false,
    scope: "tok",
    audience: "aud",
  };
}

function renderGrid() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, gcTime: 0 },
      mutations: { retry: 0, retryDelay: 0 },
    },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <h1 id={DASHBOARD_HEADING_ID} tabIndex={-1}>
        Welcome
      </h1>
      {children}
    </QueryClientProvider>
  );
  return render(
    <>
      <WidgetGrid />
      <Toaster />
    </>,
    { wrapper: Wrapper }
  );
}

/** Every live region on the page whose text holds `sentence`. */
function regionsSaying(sentence: string): Element[] {
  return Array.from(document.querySelectorAll("[aria-live]")).filter(region =>
    region.textContent?.includes(sentence)
  );
}

beforeEach(() => {
  stubDashboardWidth();
  vi.clearAllMocks();
  mockBranding = branding();
  layoutResponse = layout();
  api.get.mockImplementation(() => Promise.resolve(layoutResponse));
  // The stand-in APPLIES the write, so the next read answers with it.
  api.put.mockImplementation((_path: string, body: unknown) => {
    const write = body as { placements: WidgetPlacement[] };
    layoutResponse = {
      ...(layoutResponse as DashboardLayoutResponse),
      placements: write.placements,
      version: (layoutResponse?.version ?? 0) + 1,
    };
    return Promise.resolve({ message: "ok", item: {} });
  });
});

afterEach(() => {
  unstubDashboardWidth();
});

describe("a quick setting's change, saved at rest", () => {
  it("reaches exactly one live region, the toast's polite one", async () => {
    renderGrid();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Styled" }));
    const popover = await screen.findByRole("dialog", {
      name: "Quick settings for Styled",
    });
    await user.click(within(popover).getByRole("combobox", { name: "Accent" }));
    await user.click(await screen.findByRole("option", { name: "Bold" }));

    const sentence = "Styled: Accent set to Bold.";
    // The toast says it, with its Undo beside it.
    await screen.findByText(sentence);
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    const regions = regionsSaying(sentence);
    expect(regions).toHaveLength(1);
    expect(regions[0]).toHaveAttribute("aria-live", "polite");
    // And the grid's own region, which says the dashboard's other news, says nothing of it.
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("widget-grid-live")).not.toHaveTextContent(
      sentence
    );
  });
});

describe("a quick change to a card asked in a later request than the dashboard's first", () => {
  // Past `MAX_QUERIES_PER_REQUEST` the batch is split into requests that each answer at their
  // own time. Each card asks a count; the last card's Collection names what it counts, so a new
  // one asks its request again under a new question.
  const others = Array.from({ length: MAX_QUERIES_PER_REQUEST }, (_, i) => ({
    id: `core/n${String(i).padStart(2, "0")}`,
    title: `Count ${i}`,
    archetype: "custom",
    size: RESIZABLE,
    component: "core#SaidOnceBody",
    query: { source: "collection:posts", op: "count" },
  }));
  const counting = {
    id: "core/counting",
    title: "Counting",
    archetype: "custom",
    size: RESIZABLE,
    component: "core#SaidOnceBody",
    query: { op: "count" },
    settings: [{ name: "collection", type: "collection", label: "Collection" }],
  };
  const source = (collection: string, label: string) => ({
    collection,
    label,
    lifecycle: false,
    fields: [],
  });

  beforeEach(() => {
    // Only the clock is faked, so each request's answer time is the one the case sets.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000);
    mockBranding = {
      widgets: [...others, counting],
      widgetSources: [source("posts", "Posts"), source("pages", "Pages")],
    } as unknown as AdminBranding;
    layoutResponse = {
      ...layout(),
      // Placed after every other card, so it is asked in the last request, alone.
      placements: [
        ...others.map(widget => ({
          id: widget.id,
          widgetId: widget.id,
          w: 4,
          h: 3,
          removed: false,
        })),
        {
          id: "zz-counting",
          widgetId: counting.id,
          w: 4,
          h: 3,
          removed: false,
          config: { collection: "posts" },
        },
      ],
    };
    api.post.mockImplementation((_path: string, body: unknown) =>
      Promise.resolve({
        results: (body as { queries: unknown[] }).queries.map(() => ({
          ok: true,
          result: { op: "count", total: 1 },
        })),
      })
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is said as shown, with Undo, once that card's own request answers, though the first has not since", async () => {
    renderGrid();
    const user = userEvent.setup();
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    // The card is titled by the collection it counts.
    await user.click(await screen.findByRole("button", { name: "Posts" }));
    const popover = await screen.findByRole("dialog", {
      name: "Quick settings for Posts",
    });
    // The first request answered at 1 000 and is not asked again; the card's own request
    // answers again later.
    vi.setSystemTime(5_000);
    await user.click(
      within(popover).getByRole("combobox", { name: "Collection" })
    );
    await user.click(await screen.findByRole("option", { name: "Pages" }));

    expect(
      await screen.findByText(/Collection set to Pages\.$/)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
  });
});
