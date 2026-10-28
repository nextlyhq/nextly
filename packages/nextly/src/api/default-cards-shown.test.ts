/**
 * Which cards of a default a person would not be shown: only declared cards
 * are asked, each by its own rules (`cardIsShownTo`), all in one read with one
 * instant and each owner's own share scope, after the content sources are
 * current; a card of any other shape is never asked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { cardIsShownTo, cardBatchFor, refreshContentSources, declaredWidget } =
  vi.hoisted(() => ({
    cardIsShownTo: vi.fn(),
    cardBatchFor: vi.fn(),
    refreshContentSources: vi.fn(),
    declaredWidget: vi.fn(),
  }));
vi.mock("./widget-cards", () => ({ cardIsShownTo }));
vi.mock("./widget-query", () => ({ cardBatchFor }));
vi.mock("../domains/widgets/collection-widgets", () => ({
  refreshContentSources,
}));
vi.mock("../domains/widgets/declaration/declared-widgets", () => ({
  declaredWidget,
}));

import type { AuthContext } from "../auth/middleware";
import type { WidgetPlacement } from "../domains/widgets/layout";
import type { ReadCaller } from "../services/dashboard/readable-resources";

import { defaultCardsNotShown } from "./default-cards-shown";

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

/** A declared widget of `owner`, as the store keeps one. */
const declared = (owner: string) => ({ owner, declaration: {}, display: {} });

beforeEach(() => {
  vi.clearAllMocks();
  cardBatchFor.mockReturnValue(batch);
  refreshContentSources.mockResolvedValue(true);
  declaredWidget.mockImplementation((id: string) =>
    id.startsWith("acme/") ? declared('plugin "@acme/shop"') : undefined
  );
});

describe("the cards of a default a person is not shown", () => {
  it("are the declared cards whose own rules say no, each asked once", async () => {
    cardIsShownTo.mockImplementation(
      async (_declared, placement: WidgetPlacement) =>
        placement.widgetId !== "acme/quiet"
    );
    const notShown = await defaultCardsNotShown(
      auth,
      reader,
      [card("core/team"), card("acme/quiet"), card("acme/loud")],
      new AbortController().signal
    );
    expect([...notShown]).toEqual(["acme/quiet"]);
    // A card of any other shape has no rule of its own to ask.
    expect(cardIsShownTo).toHaveBeenCalledTimes(2);
    expect(cardBatchFor).toHaveBeenCalledWith(auth, reader);
    expect(refreshContentSources).toHaveBeenCalledTimes(1);
  });

  it("asks every card with the read's one instant, its signal, and its owner's share scope", async () => {
    cardIsShownTo.mockResolvedValue(true);
    const signal = new AbortController().signal;
    await defaultCardsNotShown(
      auth,
      reader,
      [card("acme/a"), card("acme/b")],
      signal
    );
    const [first, second] = cardIsShownTo.mock.calls.map(call => call[3]);
    expect(first.signal).toBe(signal);
    expect(first.now).toBe(second.now);
    expect(first.scope).toBeDefined();
    expect(cardIsShownTo.mock.calls[0][2]).toBe(batch);
  });

  it("asks nothing, and reads no source, for a default with no declared card", async () => {
    const notShown = await defaultCardsNotShown(
      auth,
      reader,
      [card("core/team")],
      new AbortController().signal
    );
    expect(notShown.size).toBe(0);
    expect(cardIsShownTo).not.toHaveBeenCalled();
    expect(refreshContentSources).not.toHaveBeenCalled();
  });
});
