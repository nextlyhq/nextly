/**
 * Which of a reader's cards that hide while empty answer empty for them: only
 * declared cards that hide while empty are asked, each by its own answer
 * (`cardAnswersEmpty`), all in one read, ahead of the dashboard's own batch.
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
import type { WidgetPlacement } from "../domains/widgets/layout";
import type { ReadCaller } from "../services/dashboard/readable-resources";

import { cardsAnsweredEmpty } from "./cards-answered-empty";

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
        card("core/quiet-busy"),
        card("core/quiet-a"),
      ],
      new AbortController().signal,
      "load-1"
    );
    expect(hidden).toEqual(["core/quiet-b", "core/quiet-a"]);
    // A card that shows its empty state, and one with no declaration, are
    // never answered here: only a card that would leave the page is.
    expect(cardAnswersEmpty).toHaveBeenCalledTimes(3);
    expect(refreshContentSources).toHaveBeenCalledTimes(1);
  });

  it("asks ahead of the dashboard's own batch, for the read's own load, as the reader, with the read's one instant and signal", async () => {
    cardAnswersEmpty.mockResolvedValue(true);
    const signal = new AbortController().signal;
    await cardsAnsweredEmpty(
      auth,
      reader,
      [card("core/quiet-a"), card("core/quiet-b")],
      signal,
      "load-7"
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

  it("asks nothing, and reads no source, when no card hides while empty", async () => {
    const hidden = await cardsAnsweredEmpty(
      auth,
      reader,
      [card("core/count")],
      new AbortController().signal,
      "load-1"
    );
    expect(hidden).toEqual([]);
    expect(refreshContentSources).not.toHaveBeenCalled();
    expect(cardAnswersEmpty).not.toHaveBeenCalled();
  });
});
