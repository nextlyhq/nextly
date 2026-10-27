/**
 * The by-card half of the batch: a card asked for by widget and card id is answered only when it
 * is one this caller was handed, from its declaration, as the person asking; every other card gets
 * the one "unavailable" answer, byte for byte.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createBatchScope } from "../domains/widgets/batch-scope";
import { declaredWidget } from "../domains/widgets/declaration/declared-widgets";
import { executeWidgetQuery } from "../domains/widgets/execute";
import type { WidgetQuery } from "../domains/widgets/query";

import { prepareCards } from "./widget-cards";
import { askableCards } from "./widget-layout";

// What this module decides is observed; what it stands on is stood in: the caller's handed cards
// (the layout read's own lookup), the declarations, and the query executor.
vi.mock("./widget-layout", () => ({ askableCards: vi.fn() }));
// Partial: the declarations are stood in for, and the one checked builder of
// a card's query stays real, since what a card runs is what it judges.
vi.mock(
  "../domains/widgets/declaration/declared-widgets",
  async importOriginal => ({
    ...(await importOriginal<
      typeof import("../domains/widgets/declaration/declared-widgets")
    >()),
    declaredWidget: vi.fn(),
  })
);
vi.mock("../domains/widgets/execute", () => ({ executeWidgetQuery: vi.fn() }));

const person = { user: { id: "reader" } } as never;
const auth = {} as never;
const check = vi.fn(async (raw: unknown) => raw as WidgetQuery);
const batch = { auth, caller: person, check };

const ordersFunction = vi.fn(async () => ({ total: 7 }));
const declarations: Record<string, unknown> = {
  "acme/orders": {
    owner: "plugin @acme/shop",
    declaration: {
      id: "acme/orders",
      size: { default: { w: 12, h: 3 } },
      settings: { items: { type: "number", default: 5 } },
      data: ordersFunction,
      display: "metric",
      empty: { when: (data: { total: number }) => data.total === 0 },
    },
  },
  // Declared, but not a widget this caller could place: what only the write's gate refuses.
  "acme/secret": {
    owner: "plugin @acme/shop",
    declaration: {
      id: "acme/secret",
      size: { default: { w: 12, h: 3 } },
      data: async () => ({ total: 1 }),
      display: "metric",
    },
  },
  "acme/recent": {
    owner: "plugin @acme/shop",
    collections: { orders: "shop_orders" },
    declaration: {
      id: "acme/recent",
      size: { default: { w: 12, h: 3 } },
      settings: { items: { type: "number", default: 5 } },
      data: {
        query: ({ settings }: { settings: { items: number } }) => ({
          collection: "orders",
          op: "list",
          select: ["id"],
          limit: settings.items,
        }),
      },
      display: "list",
    },
  },
  // Plain JavaScript, as no type saw it: a list whose query counts once its
  // card asks for more than the starting number of items.
  "acme/shifty": {
    owner: "plugin @acme/shop",
    declaration: {
      id: "acme/shifty",
      size: { default: { w: 12, h: 3 } },
      settings: { items: { type: "number", default: 5 } },
      data: {
        query: ({ settings }: { settings: { items: number } }) => ({
          collection: "orders",
          op: settings.items > 5 ? "count" : "list",
          select: ["id"],
          limit: settings.items,
        }),
      },
      display: "list",
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(declaredWidget).mockImplementation(id => declarations[id] as never);
  vi.mocked(askableCards).mockResolvedValue({
    handed: new Map([
      [
        "c-orders",
        {
          id: "c-orders",
          widgetId: "acme/orders",
          w: 12,
          h: 3,
          removed: false,
          config: { items: 3 },
        },
      ],
      [
        "c-recent",
        {
          id: "c-recent",
          widgetId: "acme/recent",
          w: 12,
          h: 3,
          removed: false,
          config: { items: 2 },
        },
      ],
      [
        "c-shifty",
        {
          id: "c-shifty",
          widgetId: "acme/shifty",
          w: 12,
          h: 3,
          removed: false,
          config: { items: 9 },
        },
      ],
      [
        "c-gone",
        { id: "c-gone", widgetId: "acme/gone", w: 12, h: 3, removed: false },
      ],
    ]) as never,
    // The widgets this caller could place: the layout write's own gate.
    placeable: new Set([
      "acme/orders",
      "acme/recent",
      "acme/shifty",
      "acme/gone",
    ]),
  });
  // Answers the op it is asked, as a source must.
  vi.mocked(executeWidgetQuery).mockImplementation(async query =>
    query.op === "count"
      ? { op: "count", total: 1 }
      : { op: "list", items: [{ id: "row" }] }
  );
});

describe("a card asked for by widget and card id", () => {
  it("answers every card it cannot answer with one slot, byte for byte", async () => {
    const prepared = await prepareCards(
      [
        { widget: "acme/orders", card: "c-unknown" },
        { widget: "acme/hidden", card: "c-orders" },
        { widget: "acme/gone", card: "c-gone" },
        {
          widget: "acme/orders",
          card: "c-orders",
          source: "collection:orders",
          op: "count",
        },
        // A card handed for one declared widget, asked as another declared widget: refused for the
        // card it is, not for a widget that does not exist.
        { widget: "acme/recent", card: "c-orders" },
        // A preview of a declared widget this caller could not place.
        { widget: "acme/secret", settings: {} },
        // A preview carrying anything beside its widget and settings.
        { widget: "acme/orders", settings: {}, source: "collection:orders" },
      ],
      batch
    );
    const bytes = [0, 1, 2, 3, 4, 5, 6].map(index =>
      JSON.stringify(prepared.get(index))
    );
    // An unknown card, a widget this caller was not handed it for, a widget no longer declared, a
    // mixed entry and another widget's card cannot be told apart.
    expect(new Set(bytes).size).toBe(1);
    expect(prepared.get(0)).toMatchObject({ ok: false, code: "unavailable" });
  });

  it("runs a data function with the card's settings, the person, the card's signal and scope", async () => {
    const prepared = await prepareCards(
      [{ widget: "acme/orders", card: "c-orders" }],
      batch
    );
    const entry = prepared.get(0);
    expect(entry).toMatchObject({
      kind: "data",
      widgetId: "acme/orders",
      owner: "plugin @acme/shop",
    });
    const signal = new AbortController().signal;
    const scope = createBatchScope().forOwner("plugin @acme/shop");
    const now = new Date(Date.UTC(2026, 9, 22));
    const answered = await (entry as { answer: Function }).answer({
      signal,
      scope,
      now,
    });
    expect(answered).toEqual({
      result: { op: "count", total: 7 },
      empty: false,
    });
    const [input] = ordersFunction.mock.calls[0] as unknown as [
      Record<string, unknown>,
    ];
    expect(input).toMatchObject({
      settings: { items: 3 },
      user: { id: "reader" },
      signal,
      scope,
      now,
    });
    // Its reads are the batch's own: checked by the same door as a card's query.
    await (input.services as { count: Function }).count("orders");
    expect(check).toHaveBeenCalledWith({
      op: "count",
      source: "collection:orders",
    });
  });

  it("says when its declared empty test holds, in the same slot", async () => {
    ordersFunction.mockResolvedValueOnce({ total: 0 });
    const prepared = await prepareCards(
      [{ widget: "acme/orders", card: "c-orders" }],
      batch
    );
    const answered = await (prepared.get(0) as { answer: Function }).answer({
      signal: new AbortController().signal,
      scope: createBatchScope().forOwner("plugin @acme/shop"),
      now: new Date(Date.UTC(2026, 9, 22)),
    });
    expect(answered).toEqual({
      result: { op: "count", total: 0 },
      empty: true,
    });
  });

  it("writes a declaration's query from the card's settings, on the site's collection, and checks it first", async () => {
    const prepared = await prepareCards(
      [{ widget: "acme/recent", card: "c-recent" }],
      batch
    );
    const answered = await (prepared.get(0) as { answer: Function }).answer({
      signal: new AbortController().signal,
      scope: createBatchScope().forOwner("plugin @acme/shop"),
      now: new Date(Date.UTC(2026, 9, 22)),
    });
    expect(check).toHaveBeenCalledWith({
      op: "list",
      select: ["id"],
      limit: 2,
      source: "collection:shop_orders",
    });
    expect(vi.mocked(executeWidgetQuery).mock.calls[0]?.[1]).toBe(person);
    // The batch's instant, as a copy the source cannot move for anyone else.
    const handed = vi.mocked(executeWidgetQuery).mock.calls[0]?.[2]?.now;
    expect(handed?.getTime()).toBe(Date.UTC(2026, 9, 22));
    expect(answered).toEqual({
      result: { op: "list", items: [{ id: "row" }] },
      empty: false,
    });
  });

  it("fails a card whose query its display cannot draw, judged for the card's own settings", async () => {
    // 🔴 Startup judged the query its starting settings write, a list. This
    // card's settings write a count, which a list cannot draw: run, it would
    // reach the admin as an answer the card misreads, for good.
    const prepared = await prepareCards(
      [{ widget: "acme/shifty", card: "c-shifty" }],
      batch
    );
    await expect(
      (prepared.get(0) as { answer: Function }).answer({
        signal: new AbortController().signal,
        scope: createBatchScope().forOwner("plugin @acme/shop"),
        now: new Date(Date.UTC(2026, 9, 22)),
      })
    ).rejects.toThrow();
    expect(executeWidgetQuery).not.toHaveBeenCalled();
  });

  it("reads the caller's cards once for the batch, and not at all for a batch of queries", async () => {
    await prepareCards(
      [
        { widget: "acme/orders", card: "c-orders" },
        { widget: "acme/recent", card: "c-recent" },
      ],
      batch
    );
    expect(askableCards).toHaveBeenCalledTimes(1);
    vi.mocked(askableCards).mockClear();
    await prepareCards([{ source: "collection:posts", op: "count" }], batch);
    expect(askableCards).not.toHaveBeenCalled();
  });

  it("previews a placed widget's card with settings of the reader's choosing, resolved as a stored card's", async () => {
    // `acme/orders` is placed and takes one card, and the preview of a change to it must still
    // answer: the gate is "could place", the layout write's own, not "may still add".
    const prepared = await prepareCards(
      [
        {
          widget: "acme/orders",
          settings: { items: 9, notDeclared: "dropped" },
        },
      ],
      batch
    );
    expect(prepared.get(0)).toMatchObject({
      kind: "data",
      widgetId: "acme/orders",
    });
    await (prepared.get(0) as { answer: Function }).answer({
      signal: new AbortController().signal,
      scope: createBatchScope().forOwner("plugin @acme/shop"),
      now: new Date(Date.UTC(2026, 9, 22)),
    });
    const [input] = ordersFunction.mock.calls[0] as unknown as [
      Record<string, unknown>,
    ];
    expect(input.settings).toEqual({ items: 9 });
  });
});
