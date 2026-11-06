/**
 * Which of a reader's cards that hide while empty answer empty for them: only
 * declared cards that hide while empty are asked, each by its own answer
 * (`cardAnswersEmpty`), all in one read, ahead of the dashboard's own batch.
 * The widgets of the other channels that hide while empty are not asked: their
 * cards leave by their own answer, and are named for the admin to say so.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cardAnswersEmpty,
  cardBatchFor,
  refreshContentSources,
  declaredWidget,
} = vi.hoisted(() => ({
  cardAnswersEmpty: vi.fn(),
  cardBatchFor: vi.fn(),
  refreshContentSources: vi.fn(),
  declaredWidget: vi.fn(),
}));
vi.mock("./widget-cards", () => ({ cardAnswersEmpty }));
vi.mock("./widget-query", () => ({ cardBatchFor }));
vi.mock("../domains/widgets/content-sources", () => ({
  refreshContentSources,
}));
vi.mock("../domains/widgets/declaration/declared-widgets", () => ({
  declaredWidget,
}));

import type { AuthContext } from "../auth/middleware";
import type { CanonicalWidget } from "../domains/widgets/canonical";
import type { WidgetPlacement } from "../domains/widgets/layout";
import { readAheadState } from "../domains/widgets/read-ahead-handover";
import type { ReadCaller } from "../services/dashboard/readable-resources";

import {
  cardsAnsweredEmpty,
  hiddenWhenAnswerEmpty,
  type AheadOfTheBatch,
} from "./cards-answered-empty";

const auth = { userId: "user-1" } as unknown as AuthContext;
const reader = { user: { id: "user-1" } } as unknown as ReadCaller;
const batch = { auth, caller: reader };

const card = (widgetId: string): WidgetPlacement => ({
  id: widgetId,
  widgetId,
  w: 6,
  h: 3,
  removed: false,
});

/** A declared widget of core's, hiding while empty or not. */
const declared = (hidesWhenEmpty: boolean) => ({
  owner: "core",
  declaration: hidesWhenEmpty ? { hidesWhenEmpty: true } : {},
  display: {},
});

/** A widget the reader may see, as the layout read resolves it, hiding while empty or not. */
const canonical = (id: string, hidesWhenEmpty: boolean): CanonicalWidget =>
  ({
    id,
    ...(hidesWhenEmpty ? { hidesWhenEmpty: true } : {}),
  }) as CanonicalWidget;

/**
 * The widgets of every card the cases place: declared ones of core's, as their summaries carry
 * `hidesWhenEmpty`, and two of the other channels, `legacy/quiet` hiding while empty.
 */
const WIDGETS: readonly CanonicalWidget[] = [
  canonical("core/quiet-a", true),
  canonical("core/quiet-b", true),
  canonical("core/quiet-busy", true),
  canonical("core/count", false),
  canonical("legacy/list", false),
  canonical("legacy/quiet", true),
];

/** The layout read's own ask: a 1,200 px dashboard, under the load `token` names. */
function aheadOf(
  token: string,
  signal: AbortSignal = new AbortController().signal
): AheadOfTheBatch {
  return {
    widgets: WIDGETS,
    dashboardWidth: 1200,
    signal,
    readAheadToken: token,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  cardBatchFor.mockReturnValue(batch);
  refreshContentSources.mockResolvedValue(true);
  declaredWidget.mockImplementation((id: string) => {
    if (id.startsWith("core/quiet")) return declared(true);
    if (id === "core/count") return declared(false);
    return undefined;
  });
});

describe("the cards a reader's dashboard is drawn without while empty", () => {
  it("are the cards that hide while empty and answer empty, in order; no other card is asked", async () => {
    cardAnswersEmpty.mockImplementation(
      async (_declared, placement: WidgetPlacement) =>
        placement.widgetId !== "core/quiet-busy"
    );
    const hidden = await cardsAnsweredEmpty(
      auth,
      reader,
      [
        card("core/quiet-b"),
        card("core/count"),
        card("legacy/list"),
        card("legacy/quiet"),
        card("core/quiet-busy"),
        card("core/quiet-a"),
      ],
      aheadOf("load-1")
    );
    expect(hidden).toEqual(["core/quiet-b", "core/quiet-a"]);
    // A card that shows its empty state, and one with no declaration, hiding
    // while empty or not, are never answered here: only a declared card that
    // would leave the page is.
    expect(cardAnswersEmpty).toHaveBeenCalledTimes(3);
    expect(refreshContentSources).toHaveBeenCalledTimes(1);
  });

  it("judges a declared card by its widget's summary, as the layout read resolved it", async () => {
    cardAnswersEmpty.mockResolvedValue(true);
    // Declared and hiding while empty, but not hiding by the summary the
    // reader's widgets carry: drawn, never judged.
    const hidden = await cardsAnsweredEmpty(
      auth,
      reader,
      [card("core/quiet-a")],
      {
        ...aheadOf("load-1"),
        widgets: [canonical("core/quiet-a", false)],
      }
    );
    expect(hidden).toEqual([]);
    expect(cardAnswersEmpty).not.toHaveBeenCalled();
  });

  it("asks each card at the dashboard width the layout read was sent", async () => {
    cardAnswersEmpty.mockResolvedValue(false);
    await cardsAnsweredEmpty(auth, reader, [card("core/quiet-a")], {
      ...aheadOf("load-1"),
      dashboardWidth: 1440,
    });
    // The width, for the card's tier to be read from (`cardAnswersEmpty`).
    expect(cardAnswersEmpty.mock.lastCall?.[4]).toBe(1440);
  });

  it("asks ahead of the dashboard's own batch, for the read's own load, as the reader, with the read's one instant and signal", async () => {
    cardAnswersEmpty.mockResolvedValue(true);
    const signal = new AbortController().signal;
    await cardsAnsweredEmpty(
      auth,
      reader,
      [card("core/quiet-a"), card("core/quiet-b")],
      aheadOf("load-7", signal)
    );
    expect(cardBatchFor).toHaveBeenCalledWith(auth, reader);
    const asked = cardAnswersEmpty.mock.calls;
    // Under the token the layout read was handed, so only the batch that
    // sends it back may take what was read here.
    expect(asked.map(([, , given]) => given)).toEqual([
      { ...batch, readAhead: { side: "ahead", token: "load-7" } },
      { ...batch, readAhead: { side: "ahead", token: "load-7" } },
    ]);
    const [first, second] = asked.map(([, , , input]) => input);
    expect(first.signal).toBe(signal);
    expect(first.now).toBe(second.now);
  });

  it("hands the read's load over once every card it asked has answered, the slowest included", async () => {
    let answerSlow!: (empty: boolean) => void;
    cardAnswersEmpty.mockImplementation(
      (_declared, placement: WidgetPlacement) =>
        placement.widgetId === "core/quiet-b"
          ? new Promise<boolean>(resolve => {
              answerSlow = resolve;
            })
          : Promise.resolve(true)
    );
    const judged = cardsAnsweredEmpty(
      auth,
      reader,
      [card("core/quiet-a"), card("core/quiet-b")],
      aheadOf("load-handover")
    );
    await vi.waitFor(() => expect(cardAnswersEmpty).toHaveBeenCalledTimes(2));
    // The quick card has answered, and read ahead what it reads; the slow one is still being
    // judged, so the load is not handed over and nothing read for it has begun to wait.
    expect(readAheadState("load-handover")).toBe("pending");

    answerSlow(false);
    expect(await judged).toEqual(["core/quiet-a"]);
    // Handed over now, as the layout read's answer is ready: the batch's window starts here.
    expect(readAheadState("load-handover")).toBe("open");
  });

  it("never asks a card the reader removed, which nothing draws", async () => {
    cardAnswersEmpty.mockResolvedValue(true);
    const hidden = await cardsAnsweredEmpty(
      auth,
      reader,
      [{ ...card("core/quiet-a"), removed: true }, card("core/quiet-b")],
      aheadOf("load-1")
    );
    expect(hidden).toEqual(["core/quiet-b"]);
    expect(cardAnswersEmpty).toHaveBeenCalledOnce();
    expect(cardAnswersEmpty.mock.calls[0]?.[1]).toMatchObject({
      widgetId: "core/quiet-b",
    });
  });

  it("asks nothing, and reads no source, when no card hides while empty", async () => {
    const hidden = await cardsAnsweredEmpty(
      auth,
      reader,
      [card("core/count")],
      aheadOf("load-1")
    );
    expect(hidden).toEqual([]);
    expect(refreshContentSources).not.toHaveBeenCalled();
    expect(cardAnswersEmpty).not.toHaveBeenCalled();
  });
});

describe("the widgets whose cards leave the dashboard by their own answer", () => {
  it("are those that hide while empty and have no declaration the layout read could answer", () => {
    // `legacy/quiet` arrives by `registerWidget` or `contributes.admin.widgets`: the layout read
    // cannot answer it, so its card leaves when its own answer, drawn, is empty. The declared
    // ones are judged ahead instead, and the others never leave.
    expect(hiddenWhenAnswerEmpty(WIDGETS)).toEqual(["legacy/quiet"]);
  });
});
