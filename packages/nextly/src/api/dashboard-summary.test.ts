/**
 * The summary route's own decisions, with every read it makes stood in: that
 * each part is answered within a card's time budget, so one that never
 * settles fails alone and the line still answers; and that a widget placed
 * more than once is judged card by card until one is shown, so a hidden first
 * card does not hide the widget's part. What each source counts, and the
 * request path itself, are the integration test's
 * (`__tests__/dashboard-summary.integration.test.ts`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { declaredWidget } from "../domains/widgets/declaration/declared-widgets";
import { executeWidgetQuery } from "../domains/widgets/execute";

import { getDashboardSummary } from "./dashboard-summary";
import { cardIsShownTo } from "./widget-cards";
import { askableCards } from "./widget-layout";
import { SLOT_TIMEOUT_MS } from "./widget-slots";

vi.mock("../auth/middleware", () => ({
  requireAuthentication: vi.fn(async () => ({ userId: "reader" })),
  isErrorResponse: vi.fn(() => false),
}));
vi.mock("./authenticated-read", () => ({
  PRIVATE_NO_STORE_HEADERS: { "Cache-Control": "private, no-store" },
  readCaller: vi.fn(async () => ({ user: { id: "reader" } })),
}));
vi.mock("../domains/widgets/content-sources", () => ({
  refreshContentSources: vi.fn(async () => undefined),
}));
vi.mock("../domains/widgets/execute", () => ({ executeWidgetQuery: vi.fn() }));
vi.mock("../domains/releases/releases-widget-source", () => ({
  callerMayReadReleases: vi.fn(async () => false),
}));
vi.mock("../services/dashboard/attention-source", () => ({
  releasesAttentionLink: (reason: string) => `releases?reason=${reason}`,
}));
vi.mock("./widget-layout", () => ({ askableCards: vi.fn() }));
vi.mock("./widget-cards", () => ({ cardIsShownTo: vi.fn() }));
vi.mock("./widget-query", () => ({
  cardBatchFor: vi.fn(() => ({
    auth: {},
    caller: { user: { id: "reader" } },
    check: vi.fn(),
  })),
}));
vi.mock("../domains/widgets/declaration/read-services", () => ({
  bindReadServices: vi.fn(() => ({})),
}));
vi.mock("../domains/widgets/declaration/declared-widgets", () => ({
  declaredWidget: vi.fn(),
}));
vi.mock("../route-handler/auth-handler", () => ({
  getHandlerConfig: vi.fn(() => undefined),
}));

const count = vi.fn<(input: { signal: AbortSignal }) => Promise<number>>();

/** The reader's dashboard: the placements named, each of the one widget. */
function placed(...ids: string[]) {
  vi.mocked(askableCards).mockResolvedValue({
    handed: new Map(
      ids.map(id => [
        id,
        { id, widgetId: "acme/inbox", w: 6, h: 3, removed: false },
      ])
    ),
  } as never);
}

function request() {
  return getDashboardSummary(
    new Request("http://localhost/api/dashboard/summary")
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(executeWidgetQuery).mockResolvedValue({
    op: "groupBy",
    buckets: [{ value: "overdue", count: 2 }],
  });
  vi.mocked(declaredWidget).mockReturnValue({
    owner: "plugin @acme/forms",
    declaration: {
      id: "acme/inbox",
      several: true,
      summary: { label: "new submissions", count },
    },
  } as never);
  vi.mocked(cardIsShownTo).mockResolvedValue(true);
  count.mockResolvedValue(3);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/dashboard/summary, part by part", () => {
  it("fails a widget's part whose count never settles, at its budget, and still answers the rest", async () => {
    vi.useFakeTimers();
    placed("c1");
    count.mockImplementation(() => new Promise(() => {}));
    let answered = false;
    const responding = request().then(response => {
      answered = true;
      return response;
    });

    await vi.advanceTimersByTimeAsync(SLOT_TIMEOUT_MS + 1);

    expect(answered).toBe(true);
    expect(await (await responding).json()).toEqual({
      parts: [
        {
          kind: "attention",
          count: 2,
          link: "releases?reason=overdue",
        },
      ],
      failed: 1,
    });
    // The count is told it was given up on, not merely no longer awaited.
    expect(count.mock.calls[0]?.[0].signal.aborted).toBe(true);
  });

  it("counts a widget whose first card is hidden from the reader, for the card that is shown", async () => {
    placed("c1", "c2");
    vi.mocked(cardIsShownTo).mockImplementation(
      async (_declared, placement) => placement.id === "c2"
    );

    const body = await (await request()).json();

    expect(body.parts).toContainEqual({
      kind: "widget",
      widget: "acme/inbox",
      card: "c2",
      label: "new submissions",
      count: 3,
    });
    expect(count).toHaveBeenCalledOnce();
  });

  it("counts a widget once, for its first card shown, however many cards it has", async () => {
    // The control for the case above: every card shown, the widget counted once.
    placed("c1", "c2");

    const body = await (await request()).json();

    expect(
      body.parts.filter((part: { kind: string }) => part.kind === "widget")
    ).toEqual([
      {
        kind: "widget",
        widget: "acme/inbox",
        card: "c1",
        label: "new submissions",
        count: 3,
      },
    ]);
    expect(vi.mocked(cardIsShownTo)).toHaveBeenCalledOnce();
  });

  it("gives no part and no failure when no card of the widget is shown", async () => {
    placed("c1", "c2");
    vi.mocked(cardIsShownTo).mockResolvedValue(false);

    const body = await (await request()).json();

    expect(
      body.parts.some((part: { kind: string }) => part.kind === "widget")
    ).toBe(false);
    expect(body.failed).toBe(0);
    expect(count).not.toHaveBeenCalled();
    expect(vi.mocked(cardIsShownTo)).toHaveBeenCalledTimes(2);
  });
});
