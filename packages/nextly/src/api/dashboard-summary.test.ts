/**
 * The summary route's own decisions, with every read it makes stood in: that
 * each part is answered within a card's time budget, so one that never
 * settles fails alone and the line still answers; that the dashboard's cards
 * are read within the same budget, so a layout that throws or stalls is one
 * unknown part; that a widget placed more than once is judged card by card
 * until one is shown, so a hidden first card does not hide the widget's part;
 * and that a card that could not be judged leaves its part unknown, not
 * hidden. What each source counts, and the
 * request path itself, are the integration test's
 * (`__tests__/dashboard-summary.integration.test.ts`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { declaredWidget } from "../domains/widgets/declaration/declared-widgets";
import { executeWidgetQuery } from "../domains/widgets/execute";
import { NextlyError } from "../errors/nextly-error";

import { getDashboardSummary } from "./dashboard-summary";
import { cardShownTo } from "./widget-cards";
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
vi.mock("./widget-cards", () => ({ cardShownTo: vi.fn() }));
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
  vi.mocked(cardShownTo).mockResolvedValue("shown");
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
    vi.mocked(cardShownTo).mockImplementation(async (_declared, placement) =>
      placement.id === "c2" ? "shown" : "hidden"
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
    expect(vi.mocked(cardShownTo)).toHaveBeenCalledOnce();
  });

  it("gives no part and no failure when no card of the widget is shown", async () => {
    placed("c1", "c2");
    vi.mocked(cardShownTo).mockResolvedValue("hidden");

    const body = await (await request()).json();

    expect(
      body.parts.some((part: { kind: string }) => part.kind === "widget")
    ).toBe(false);
    expect(body.failed).toBe(0);
    expect(count).not.toHaveBeenCalled();
    expect(vi.mocked(cardShownTo)).toHaveBeenCalledTimes(2);
  });

  it("fails a widget's part when a card of it could not be judged and none is shown", async () => {
    // The batch draws that card as failed: the part is unknown, so the line
    // cannot say all caught up past it.
    placed("c1", "c2");
    vi.mocked(cardShownTo).mockImplementation(async (_declared, placement) =>
      placement.id === "c1" ? "failed" : "hidden"
    );

    const body = await (await request()).json();

    expect(
      body.parts.some((part: { kind: string }) => part.kind === "widget")
    ).toBe(false);
    expect(body.failed).toBe(1);
    expect(count).not.toHaveBeenCalled();
  });

  it("counts the card shown even when an earlier one could not be judged", async () => {
    // The control for the case above: a failed judgement does not stand for
    // the widget while a later card of it is shown.
    placed("c1", "c2");
    vi.mocked(cardShownTo).mockImplementation(async (_declared, placement) =>
      placement.id === "c1" ? "failed" : "shown"
    );

    const body = await (await request()).json();

    expect(body.parts).toContainEqual(
      expect.objectContaining({ kind: "widget", card: "c2", count: 3 })
    );
    expect(body.failed).toBe(0);
  });
});

describe("GET /api/dashboard/summary, when the dashboard's cards cannot be read", () => {
  const attention = {
    kind: "attention",
    count: 2,
    link: "releases?reason=overdue",
  };

  it("fails one part and still answers the rest when the layout throws", async () => {
    vi.mocked(askableCards).mockRejectedValue(new Error("layout store down"));

    const response = await request();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ parts: [attention], failed: 1 });
  });

  it("fails one part, at its budget, and still answers the rest when the layout never answers", async () => {
    vi.useFakeTimers();
    vi.mocked(askableCards).mockImplementation(() => new Promise(() => {}));
    let answered = false;
    const responding = request().then(response => {
      answered = true;
      return response;
    });

    await vi.advanceTimersByTimeAsync(SLOT_TIMEOUT_MS + 1);

    expect(answered).toBe(true);
    expect(await (await responding).json()).toEqual({
      parts: [attention],
      failed: 1,
    });
  });

  it("gives no part and no failure for a reader the layout refuses", async () => {
    // The control: a refusal is no dashboard to count for, not an outage.
    vi.mocked(askableCards).mockRejectedValue(NextlyError.forbidden());

    expect(await (await request()).json()).toEqual({
      parts: [attention],
      failed: 0,
    });
  });
});
