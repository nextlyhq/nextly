/**
 * The by-card half of the batch: a card asked for by widget and card id is answered only when it
 * is one this caller was handed, from its declaration, as the person asking; every other card gets
 * the one "unavailable" answer, byte for byte.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createBatchScope } from "../domains/widgets/batch-scope";
import { NextlyError } from "../errors/nextly-error";
import * as loggerModule from "../observability/logger";
import { declaredWidget } from "../domains/widgets/declaration/declared-widgets";
import { executeWidgetQuery } from "../domains/widgets/execute";
import type { WidgetQuery } from "../domains/widgets/query";

import { cardIsShownTo, prepareCards } from "./widget-cards";
import { askableCards } from "./widget-layout";
import {
  answerReadyQueries,
  failedSlot,
  SLOT_TIMEOUT_MS,
  type ReadyCardData,
} from "./widget-slots";

// What this module decides is observed; what it stands on is stood in: the caller's handed cards
// (the layout read's own lookup), the declarations, and the query executor a read service runs.
vi.mock("./widget-layout", () => ({ askableCards: vi.fn() }));
// Partial: the declarations are stood in for, and the rest of the module stays real.
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
const gatedLoad = vi.fn(async () => ({ total: 1 }));
const readsLoad = vi.fn(async () => ({ total: 2 }));
const needsLoad = vi.fn(async () => ({ total: 3 }));
const maybeLoad = vi.fn(async () => ({ total: 4 }));
const accessPredicate = vi.fn((_input: { user: unknown }): unknown => true);
const showsPredicate = vi.fn((_input: unknown): unknown => true);
const declarations: Record<string, unknown> = {
  "acme/orders": {
    owner: "plugin @acme/shop",
    display: "metric",
    declaration: {
      id: "acme/orders",
      size: { default: { w: 12, h: 3 } },
      settings: { items: { type: "number", default: 5 } },
      load: ordersFunction,
      view: "figure",
      isEmpty: (data: { total: number }) => data.total === 0,
    },
  },
  // Declared, but not a widget this caller could place: what only the write's gate refuses.
  "acme/secret": {
    owner: "plugin @acme/shop",
    display: "metric",
    declaration: {
      id: "acme/secret",
      size: { default: { w: 12, h: 3 } },
      load: async () => ({ total: 1 }),
      view: "figure",
    },
  },
  // Each rule decided before load runs, one widget apiece.
  "acme/gated": {
    owner: "plugin @acme/shop",
    display: "metric",
    declaration: {
      id: "acme/gated",
      size: { default: { w: 12, h: 3 } },
      access: (input: { user: unknown }) => accessPredicate(input),
      load: gatedLoad,
      view: "figure",
    },
  },
  "acme/reads": {
    owner: "plugin @acme/shop",
    collections: { orders: "shop_orders" },
    display: "metric",
    declaration: {
      id: "acme/reads",
      size: { default: { w: 12, h: 3 } },
      access: { collections: ["orders", "customers"] },
      load: readsLoad,
      view: "figure",
    },
  },
  // Gated on permissions, any of several and all of several: judged when the card is handed, by
  // the requiredPermission each was published as, so nothing here asks again.
  "acme/any-of": {
    owner: "plugin @acme/shop",
    display: "metric",
    declaration: {
      id: "acme/any-of",
      size: { default: { w: 12, h: 3 } },
      access: { anyOf: ["read-orders", "update-orders"] },
      load: gatedLoad,
      view: "figure",
    },
  },
  "acme/all-of": {
    owner: "plugin @acme/shop",
    display: "metric",
    declaration: {
      id: "acme/all-of",
      size: { default: { w: 12, h: 3 } },
      access: { allOf: ["read-orders", { anyOf: ["update-orders"] }] },
      load: gatedLoad,
      view: "figure",
    },
  },
  "acme/needs": {
    owner: "plugin @acme/shop",
    display: "metric",
    declaration: {
      id: "acme/needs",
      size: { default: { w: 12, h: 3 } },
      settings: { collection: { type: "collection" } },
      load: needsLoad,
      view: "figure",
    },
  },
  "acme/maybe": {
    owner: "plugin @acme/shop",
    display: "metric",
    declaration: {
      id: "acme/maybe",
      size: { default: { w: 12, h: 3 } },
      settings: { items: { type: "number", defaultValue: 5 } },
      shows: (input: unknown) => showsPredicate(input),
      load: maybeLoad,
      view: "figure",
    },
  },
  "acme/throws": {
    owner: "plugin @acme/shop",
    display: "metric",
    declaration: {
      id: "acme/throws",
      size: { default: { w: 12, h: 3 } },
      load: async () => {
        throw new Error("the row for customer 42 at secret@example.com");
      },
      view: "figure",
    },
  },
  // A needed setting with no value, and a `shows` that would say no: which one decides?
  "acme/needs-maybe": {
    owner: "plugin @acme/shop",
    display: "metric",
    declaration: {
      id: "acme/needs-maybe",
      size: { default: { w: 12, h: 3 } },
      settings: { collection: { type: "collection" } },
      shows: (input: unknown) => showsPredicate(input),
      load: needsLoad,
      view: "figure",
    },
  },
  // Throws the core error type a plugin can import, with its own words in it.
  "acme/raises": {
    owner: "plugin @acme/shop",
    display: "metric",
    declaration: {
      id: "acme/raises",
      size: { default: { w: 12, h: 3 } },
      load: async () => {
        throw new NextlyError({
          code: "INTERNAL_ERROR",
          publicMessage: "Customer 42 at secret@example.com owes 9000",
          logMessage: "row secret@example.com",
          logContext: { row: "secret@example.com" },
        });
      },
      view: "figure",
    },
  },
  "acme/dated": {
    owner: "plugin @acme/shop",
    display: "metric",
    declaration: {
      id: "acme/dated",
      size: { default: { w: 12, h: 3 } },
      load: async () => ({ total: 3, at: new Date(0) }),
      view: "figure",
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  // Their implementations too, which clearing keeps: a test that makes either say no must not
  // leave it saying no for the next.
  accessPredicate.mockImplementation(() => true);
  showsPredicate.mockImplementation(() => true);
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
        "c-gated",
        { id: "c-gated", widgetId: "acme/gated", w: 12, h: 3, removed: false },
      ],
      [
        "c-reads",
        { id: "c-reads", widgetId: "acme/reads", w: 12, h: 3, removed: false },
      ],
      [
        "c-any-of",
        {
          id: "c-any-of",
          widgetId: "acme/any-of",
          w: 12,
          h: 3,
          removed: false,
        },
      ],
      [
        "c-all-of",
        {
          id: "c-all-of",
          widgetId: "acme/all-of",
          w: 12,
          h: 3,
          removed: false,
        },
      ],
      [
        "c-needs",
        { id: "c-needs", widgetId: "acme/needs", w: 12, h: 3, removed: false },
      ],
      [
        "c-maybe",
        { id: "c-maybe", widgetId: "acme/maybe", w: 12, h: 3, removed: false },
      ],
      [
        "c-throws",
        {
          id: "c-throws",
          widgetId: "acme/throws",
          w: 12,
          h: 3,
          removed: false,
        },
      ],
      [
        "c-dated",
        { id: "c-dated", widgetId: "acme/dated", w: 12, h: 3, removed: false },
      ],
      [
        "c-raises",
        {
          id: "c-raises",
          widgetId: "acme/raises",
          w: 12,
          h: 3,
          removed: false,
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
      "acme/gated",
      "acme/reads",
      "acme/any-of",
      "acme/all-of",
      "acme/needs",
      "acme/maybe",
      "acme/throws",
      "acme/dated",
      "acme/raises",
      "acme/gone",
    ]),
  });
  // Answers the op it is asked, as a source must.
  vi.mocked(executeWidgetQuery).mockImplementation(async query =>
    query.op === "count"
      ? { op: "count", total: 1 }
      : { op: "list", items: [{ id: "row" }] }
  );
  accessPredicate.mockImplementation(() => true);
  showsPredicate.mockImplementation(() => true);
  check.mockImplementation(async (raw: unknown) => raw as WidgetQuery);
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
        { widget: "acme/maybe", card: "c-orders" },
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
    // And the checked query runs as the person asking, never as the system.
    expect(vi.mocked(executeWidgetQuery).mock.calls[0]?.[1]).toBe(person);
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

  it("reads the caller's cards once for the batch, and not at all for a batch of queries", async () => {
    await prepareCards(
      [
        { widget: "acme/orders", card: "c-orders" },
        { widget: "acme/maybe", card: "c-maybe" },
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

/** One card's answer, as the batch asks for it. */
async function answered(widget: string): Promise<unknown> {
  const prepared = await prepareCards(
    [{ widget, card: `c-${widget.slice(5)}` }],
    batch
  );
  return (prepared.get(0) as { answer: Function }).answer({
    signal: new AbortController().signal,
    scope: createBatchScope().forOwner("plugin @acme/shop"),
    now: new Date(Date.UTC(2026, 9, 22)),
  });
}

/** What the one "not available" answer is, byte for byte, as an unknown card gets it. */
async function unavailableBytes(): Promise<string> {
  const prepared = await prepareCards(
    [{ widget: "acme/orders", card: "c-unknown" }],
    batch
  );
  return JSON.stringify(prepared.get(0));
}

describe("a card's load, judged before it runs", () => {
  it("is not run for a person the widget's predicate refuses, who gets the one not-available answer", async () => {
    accessPredicate.mockImplementation(() => false);
    const answer = (await answered("acme/gated")) as { settled: unknown };
    expect(gatedLoad).not.toHaveBeenCalled();
    expect(JSON.stringify(answer.settled)).toBe(await unavailableBytes());
    // Asked with the person, and nothing else.
    expect(accessPredicate).toHaveBeenCalledWith({ user: { id: "reader" } });
  });

  it("logs a refusal at debug level only, since a person without access is routine", async () => {
    accessPredicate.mockImplementation(() => false);
    const logger = {
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };
    const spy = vi
      .spyOn(loggerModule, "getNextlyLogger")
      .mockReturnValue(
        logger as unknown as ReturnType<typeof loggerModule.getNextlyLogger>
      );
    try {
      await answered("acme/gated");
      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith({
        kind: "declared-widget-access-refused",
        owner: "plugin @acme/shop",
        widget: "acme/gated",
      });
    } finally {
      spy.mockRestore();
    }
  });

  it("is run for a person the predicate admits", async () => {
    // The control for the refusal above: the same widget, the same card.
    await expect(answered("acme/gated")).resolves.toEqual({
      result: { op: "count", total: 1 },
      empty: false,
    });
    expect(gatedLoad).toHaveBeenCalledOnce();
  });

  it("refuses when the predicate throws, and says so in the log", async () => {
    // 🔴 The plugin's own decision about who may see data, which could not be made: no.
    accessPredicate.mockImplementation(() => {
      throw new Error("lookup failed");
    });
    const warn = vi.spyOn(loggerModule, "getNextlyLogger").mockReturnValue({
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    } as unknown as ReturnType<typeof loggerModule.getNextlyLogger>);
    const answer = (await answered("acme/gated")) as { settled: unknown };
    expect(gatedLoad).not.toHaveBeenCalled();
    expect(JSON.stringify(answer.settled)).toBe(await unavailableBytes());
    const logged = vi.mocked(warn.mock.results[0]?.value.warn).mock
      .calls[0]?.[0];
    expect(logged).toMatchObject({
      kind: "declared-widget-refused",
      logContext: {
        owner: "plugin @acme/shop",
        widget: "acme/gated",
        reason: "widget-access-threw",
      },
    });
    warn.mockRestore();
  });

  it("fails the card at its time budget when the predicate never settles, and never runs load", async () => {
    // Judged inside the card's own budget: a predicate that hangs holds its card alone.
    vi.useFakeTimers();
    try {
      accessPredicate.mockImplementation(() => new Promise(() => {}));
      const prepared = await prepareCards(
        [
          { widget: "acme/gated", card: "c-gated" },
          { widget: "acme/orders", card: "c-orders" },
        ],
        batch
      );
      const answering = answerReadyQueries(
        [...prepared.values()].filter(
          (entry): entry is ReadyCardData => "kind" in entry
        ),
        person,
        createBatchScope()
      );
      await vi.advanceTimersByTimeAsync(SLOT_TIMEOUT_MS + 1);
      const slots = await answering;
      expect(slots.get(0)).toMatchObject({
        ok: false,
        error: "This widget took too long to answer",
      });
      expect(gatedLoad).not.toHaveBeenCalled();
      expect(slots.get(1)).toEqual({
        ok: true,
        result: { op: "count", total: 7 },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("is not run for a person who may not read a collection the widget reads, judged by the batch's own check", async () => {
    check.mockImplementation(async (raw: unknown) => {
      if ((raw as { source: string }).source === "collection:customers") {
        throw new Error("forbidden");
      }
      return raw as WidgetQuery;
    });
    const answer = (await answered("acme/reads")) as { settled: unknown };
    expect(readsLoad).not.toHaveBeenCalled();
    expect(JSON.stringify(answer.settled)).toBe(await unavailableBytes());
    // Each collection under the slug the site uses: `orders` was renamed.
    expect(check).toHaveBeenCalledWith({
      source: "collection:shop_orders",
      op: "count",
    });
  });

  it("is run once the person may read every collection it reads", async () => {
    await expect(answered("acme/reads")).resolves.toMatchObject({
      result: { total: 2 },
    });
    expect(readsLoad).toHaveBeenCalledOnce();
  });

  it("is run for a card gated on permissions it was handed, which are not judged a second time", async () => {
    // Handed means the gate held: a card's permission gate is judged where the cards are handed,
    // by its published requiredPermission, and here neither re-judged nor read as collections.
    for (const widget of ["acme/any-of", "acme/all-of"]) {
      await expect(answered(widget), widget).resolves.toMatchObject({
        result: { total: 1 },
      });
    }
    expect(gatedLoad).toHaveBeenCalledTimes(2);
    expect(check).not.toHaveBeenCalled();
  });

  it("is not run while a setting has no value, and the card asks for it", async () => {
    const answer = await answered("acme/needs");
    expect(needsLoad).not.toHaveBeenCalled();
    expect(answer).toEqual({
      settled: {
        ok: false,
        error: "No collection chosen yet",
        code: "needs-setting",
        setting: "collection",
      },
    });
  });

  it("is not run when the widget's shows says no, and the card is left out", async () => {
    showsPredicate.mockImplementation(() => false);
    const answer = await answered("acme/maybe");
    expect(maybeLoad).not.toHaveBeenCalled();
    expect(answer).toEqual({
      settled: { ok: false, error: "Not shown for you", code: "not-shown" },
    });
  });

  it("is run when shows says yes, which is handed what load is", async () => {
    await expect(answered("acme/maybe")).resolves.toMatchObject({
      result: { total: 4 },
    });
    const [shown] = showsPredicate.mock.calls[0] as [Record<string, unknown>];
    const [loaded] = maybeLoad.mock.calls[0] as unknown as [
      Record<string, unknown>,
    ];
    expect(shown).toBe(loaded);
    expect(shown).toMatchObject({
      settings: { items: 5 },
      user: { id: "reader" },
    });
  });
});

describe("a card's load that fails", () => {
  it("treats a NextlyError the plugin threw as the plugin's, keeping none of its words", async () => {
    // 🔴 A NextlyError's message is public by construction, so a plugin's own reached the card
    // and its log context the production log: trusted only when core raised it.
    vi.stubEnv("NODE_ENV", "production");
    let refused: unknown;
    try {
      await answered("acme/raises");
    } catch (error) {
      refused = error;
    }
    vi.unstubAllEnvs();
    const error = refused as NextlyError;
    expect(error.publicMessage).toBe("An unexpected error occurred.");
    expect(error.logContext).toEqual({
      owner: "plugin @acme/shop",
      widget: "acme/raises",
      reason: "widget-load-threw",
    });
    const slot = failedSlot(error);
    expect(slot).toEqual({ ok: false, error: "An unexpected error occurred." });
    expect(JSON.stringify(error.toLogJSON("widget-query"))).not.toContain(
      "secret@example.com"
    );
  });

  it("fails its card, naming owner, widget and reason, and none of what the plugin said in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    let refused: unknown;
    try {
      await answered("acme/throws");
    } catch (error) {
      refused = error;
    }
    vi.unstubAllEnvs();
    expect(refused).toBeInstanceOf(NextlyError);
    const error = refused as NextlyError;
    expect(error.publicMessage).toBe("An unexpected error occurred.");
    expect(error.logContext).toEqual({
      owner: "plugin @acme/shop",
      widget: "acme/throws",
      reason: "widget-load-threw",
    });
    // 🔴 The plugin's error can carry the data it was reading; in production it is not logged.
    expect(JSON.stringify(error.toLogJSON("widget-query"))).not.toContain(
      "secret@example.com"
    );
  });

  it("logs the plugin's own error in development, so an author can see why", async () => {
    vi.stubEnv("NODE_ENV", "development");
    let refused: unknown;
    try {
      await answered("acme/throws");
    } catch (error) {
      refused = error;
    }
    vi.unstubAllEnvs();
    expect(JSON.stringify((refused as NextlyError).logContext)).toContain(
      "secret@example.com"
    );
  });

  it("fails its card when its answer cannot be sent as JSON, naming owner and widget", async () => {
    let refused: unknown;
    try {
      await answered("acme/dated");
    } catch (error) {
      refused = error;
    }
    expect((refused as NextlyError).logContext).toMatchObject({
      reason: "widget-data-answer-refused",
      owner: "plugin @acme/shop",
      widget: "acme/dated",
    });
  });
});

describe("whether a card is shown to the person asking, without its load", () => {
  /** The card of `widget` placed with `config`, asked as the batch asks one. */
  function shown(widget: string, config?: Record<string, unknown>) {
    return cardIsShownTo(
      declarations[widget] as never,
      {
        id: `c-${widget.slice(5)}`,
        widgetId: widget,
        w: 12,
        h: 3,
        removed: false,
        ...(config === undefined ? {} : { config }),
      },
      batch,
      {
        signal: new AbortController().signal,
        scope: createBatchScope().forOwner("plugin @acme/shop"),
        now: new Date(Date.UTC(2026, 9, 22)),
      }
    );
  }

  it("is shown when nothing says otherwise, and its load is never run", async () => {
    await expect(shown("acme/orders", { items: 3 })).resolves.toBe(true);
    expect(ordersFunction).not.toHaveBeenCalled();
  });

  it("is not shown to a person its access refuses, by predicate or by a collection", async () => {
    accessPredicate.mockImplementation(() => false);
    await expect(shown("acme/gated")).resolves.toBe(false);
    accessPredicate.mockImplementation(() => true);
    // The control: the same card, admitted.
    await expect(shown("acme/gated")).resolves.toBe(true);
    check.mockImplementation(async (raw: unknown) => {
      if ((raw as { source: string }).source === "collection:customers") {
        throw new Error("forbidden");
      }
      return raw as WidgetQuery;
    });
    await expect(shown("acme/reads")).resolves.toBe(false);
    expect(gatedLoad).not.toHaveBeenCalled();
    expect(readsLoad).not.toHaveBeenCalled();
  });

  it("is shown while a setting it needs has no value, with shows not asked", async () => {
    // The card asks for that setting itself; left out, the step that fixes it would go too.
    showsPredicate.mockImplementation(() => false);
    await expect(shown("acme/needs-maybe")).resolves.toBe(true);
    expect(showsPredicate).not.toHaveBeenCalled();
    // The control: with the setting given, the same shows decides, and says no.
    await expect(
      shown("acme/needs-maybe", { collection: "orders" })
    ).resolves.toBe(false);
    expect(showsPredicate).toHaveBeenCalledOnce();
    expect(needsLoad).not.toHaveBeenCalled();
  });

  it("is shown only when shows answers true, handed what load would be", async () => {
    await expect(shown("acme/maybe", { items: 3 })).resolves.toBe(true);
    expect(showsPredicate.mock.calls[0]?.[0]).toMatchObject({
      settings: { items: 3 },
      user: { id: "reader" },
    });
    showsPredicate.mockImplementation(() => "yes");
    await expect(shown("acme/maybe")).resolves.toBe(false);
    expect(maybeLoad).not.toHaveBeenCalled();
  });

  it("is not shown when shows throws, which is logged as the widget's", async () => {
    showsPredicate.mockImplementation(() => {
      throw new Error("lookup failed");
    });
    const logger = {
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };
    const spy = vi
      .spyOn(loggerModule, "getNextlyLogger")
      .mockReturnValue(
        logger as unknown as ReturnType<typeof loggerModule.getNextlyLogger>
      );
    try {
      await expect(shown("acme/maybe")).resolves.toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "declared-widget-not-judged",
          logContext: expect.objectContaining({
            owner: "plugin @acme/shop",
            widget: "acme/maybe",
            reason: "widget-shows-threw",
          }),
        })
      );
    } finally {
      spy.mockRestore();
    }
  });

  /** A card judged against a fake clock, its budget run out, and what was logged. */
  async function timedOut(widget: string) {
    vi.useFakeTimers();
    const logger = {
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };
    const spy = vi
      .spyOn(loggerModule, "getNextlyLogger")
      .mockReturnValue(
        logger as unknown as ReturnType<typeof loggerModule.getNextlyLogger>
      );
    try {
      const judging = shown(widget);
      await vi.advanceTimersByTimeAsync(SLOT_TIMEOUT_MS + 1);
      return { shown: await judging, warned: logger.warn.mock.calls };
    } finally {
      spy.mockRestore();
      vi.useRealTimers();
    }
  }

  it("is not shown when shows does not settle within the card's budget, naming shows", async () => {
    showsPredicate.mockImplementation(() => new Promise(() => {}));
    const { shown: answer, warned } = await timedOut("acme/maybe");
    expect(answer).toBe(false);
    expect(warned[0]?.[0]).toMatchObject({
      logContext: {
        owner: "plugin @acme/shop",
        widget: "acme/maybe",
        reason: "widget-judging-timed-out",
        stage: "shows",
      },
    });
  });

  it("names its access as the stage when the access predicate is what does not settle", async () => {
    // The budget bounds the whole judgement; the log says which part of it hung.
    accessPredicate.mockImplementation(() => new Promise(() => {}));
    const { shown: answer, warned } = await timedOut("acme/gated");
    expect(answer).toBe(false);
    expect(warned[0]?.[0]).toMatchObject({
      logContext: { reason: "widget-judging-timed-out", stage: "access" },
    });
  });
});
