/**
 * The reads a declared widget's data function is handed: bound to the person asking, checked and
 * run as a card's own query is, and refused once the card has given up.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import { executeWidgetQuery } from "../../execute";
import {
  rangeWindow,
  TIMESERIES_RANGES,
  validateWidgetQuery,
  type WidgetQuery,
} from "../../query";
import { clearSources, registerSource } from "../../sources";
import { bindReadServices } from "../read-services";

// What answers the query is the executor's business, tested on its own; here it stands in, so
// what the services hand it, and as whom, is what is observed.
vi.mock("../../execute", () => ({ executeWidgetQuery: vi.fn() }));
const executed = vi.mocked(executeWidgetQuery);

const person = { user: { id: "reader" } } as never;
const prepare = vi.fn(async (query: unknown) => query as WidgetQuery);
/** The batch's instant the card was handed. */
const NOW = new Date(Date.UTC(2026, 9, 22, 12));

function services(card = new AbortController().signal) {
  return bindReadServices({
    caller: person,
    prepare,
    signal: card,
    now: NOW,
    collections: { orders: "shop_orders" },
  });
}

/**
 * The sources a grouping read's default field is read from, as the batch has them registered by
 * the time a card is answered: the site's orders, renamed and with a draft and published
 * lifecycle, and tags, with none, whose first field with choices is its colour.
 */
function registerSources(): void {
  clearSources();
  registerSource({
    id: "collection:shop_orders",
    label: "Orders",
    kind: "collection",
    lifecycleStatus: true,
    supports: ["count", "list", "groupBy", "timeseries"],
    fields: [
      { name: "status", type: "string" },
      { name: "state", type: "string" },
      { name: "createdAt", type: "date" },
      { name: "paidAt", type: "date" },
    ],
  });
  registerSource({
    id: "collection:tags",
    label: "Tags",
    kind: "collection",
    supports: ["count", "groupBy", "timeseries"],
    fields: [
      { name: "title", type: "string" },
      // Has choices, but a read would not group by it: never the default.
      {
        name: "shade",
        type: "string",
        choices: [{ value: "dark", label: "Dark" }],
        groupable: false,
      },
      {
        name: "colour",
        type: "string",
        choices: [
          { value: "red", label: "Red" },
          { value: "blue", label: "Blue" },
        ],
      },
      { name: "createdAt", type: "date" },
    ],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  registerSources();
  executed.mockImplementation(async (query, _caller, options) => {
    switch (query.op) {
      case "count":
        return { op: "count", total: 4 };
      case "groupBy":
        return {
          op: "groupBy",
          // Beside each bucket and the answer, what the `bars` view's shape does not hold.
          buckets: [
            { value: "paid", count: 3, atLeast: false },
            { value: null, count: 1 },
          ],
          truncated: false,
        };
      case "timeseries": {
        // Counted as the executor counts a range: in the interval its window sets.
        const { interval } = rangeWindow(
          query.range ?? "7d",
          options?.now ?? NOW
        );
        return {
          op: "timeseries",
          points: [{ start: "2026-10-22T00:00:00.000Z", count: 2 }],
          interval,
        };
      }
      default:
        return {
          op: "list",
          items: [{ id: "a", at: new Date("2026-01-02T03:04:05.000Z") }],
        };
    }
  });
});

describe("a data function's reads", () => {
  it("ask the site's collection, with only the options a read may carry", async () => {
    // From plain JavaScript a function can pass anything; only `where`, `sort`, `limit` and
    // `select` reach the query, so nothing it passes can choose who reads.
    const loose = {
      where: { state: { equals: "paid" } },
      as: "system",
      user: { id: "admin" },
      overrideAccess: true,
    } as never;
    await services().count("orders", loose);
    expect(prepare).toHaveBeenCalledWith({
      op: "count",
      where: { state: { equals: "paid" } },
      source: "collection:shop_orders",
    });

    await services().find("orders", {
      where: { state: { equals: "paid" } },
      sort: "-createdAt",
      limit: 3,
      select: ["id"],
      overrideAccess: true,
    } as never);
    expect(prepare).toHaveBeenLastCalledWith({
      op: "list",
      where: { state: { equals: "paid" } },
      sort: "-createdAt",
      limit: 3,
      select: ["id"],
      source: "collection:shop_orders",
    });
  });

  it("read as the person asking, whoever the call names", async () => {
    await services().count("orders", { user: { id: "admin" } } as never);
    expect(executed).toHaveBeenCalledTimes(1);
    expect(executed.mock.calls[0]?.[1]).toBe(person);
  });

  it("answer rows as the browser would receive them, so a function may answer them unchanged", async () => {
    const { items } = await services().find("orders");
    expect(items).toEqual([{ id: "a", at: "2026-01-02T03:04:05.000Z" }]);
    expect(await services().count("orders")).toBe(4);
  });

  it("are refused once the card has given up, and never run", async () => {
    const card = new AbortController();
    card.abort();
    await expect(services(card.signal).count("orders")).rejects.toMatchObject({
      logContext: { reason: "widget-read-after-abort" },
    });
    expect(prepare).not.toHaveBeenCalled();
    expect(executed).not.toHaveBeenCalled();
  });

  it("are not run when the card gives up while the query is being checked", async () => {
    const card = new AbortController();
    prepare.mockImplementationOnce(async query => {
      card.abort();
      return query as WidgetQuery;
    });
    await expect(services(card.signal).find("orders")).rejects.toMatchObject({
      logContext: { reason: "widget-read-after-abort" },
    });
    expect(executed).not.toHaveBeenCalled();
  });

  it("measure from the batch's instant, each read with its own copy", async () => {
    const bound = services();
    await bound.count("orders");
    await bound.find("orders");
    const [first, second] = executed.mock.calls.map(call => call[2]?.now);
    expect(first?.getTime()).toBe(NOW.getTime());
    expect(second?.getTime()).toBe(NOW.getTime());
    // A source moving its copy moves neither the card's nor the next read's.
    expect(first).not.toBe(NOW);
    expect(first).not.toBe(second);
  });

  it("stop with the call's own signal too, beside the card's", async () => {
    const own = new AbortController();
    await services().count("orders", { signal: own.signal });
    const handed = executed.mock.calls[0]?.[2]?.signal;
    expect(handed?.aborted).toBe(false);
    own.abort();
    expect(handed?.aborted).toBe(true);
  });

  it("pass on the refusal the card's own query would get", async () => {
    const refused = NextlyError.forbidden({
      logContext: { reason: "a refusal the check made" },
    });
    prepare.mockRejectedValueOnce(refused);
    await expect(services().count("orders")).rejects.toBe(refused);
    expect(executed).not.toHaveBeenCalled();
  });
});

describe("a grouping read", () => {
  it("asks the site's collection for its groups by the field named, with what a read may carry", async () => {
    const answer = await services().groupBy("orders", {
      field: "state",
      where: { state: { not_equals: "void" } },
      limit: 5,
      overrideAccess: true,
    } as never);
    expect(prepare).toHaveBeenCalledWith({
      op: "groupBy",
      groupBy: "state",
      where: { state: { not_equals: "void" } },
      limit: 5,
      source: "collection:shop_orders",
    });
    // Each bucket as the `bars` view draws it, and nothing else of the answer.
    expect(answer).toEqual({
      buckets: [
        { value: "paid", count: 3 },
        { value: null, count: 1 },
      ],
    });
    expect(executed.mock.calls[0]?.[1]).toBe(person);
  });

  it("groups by the collection's own field when it names none: status with a lifecycle, else its first choice field", async () => {
    await services().groupBy("orders");
    expect(prepare).toHaveBeenLastCalledWith(
      expect.objectContaining({
        groupBy: "status",
        source: "collection:shop_orders",
      })
    );
    await services().groupBy("tags");
    expect(prepare).toHaveBeenLastCalledWith(
      expect.objectContaining({ groupBy: "colour", source: "collection:tags" })
    );
  });

  it("names no field for a collection with none to group by, and is refused by the check every read passes", async () => {
    // Refused by the check the card's own query passes, after the person's own, rather than
    // grouped by some field of the read's own choosing.
    const checked = bindReadServices({
      caller: person,
      prepare: async query => validateWidgetQuery(query),
      signal: new AbortController().signal,
      now: NOW,
    });
    // Notes have no lifecycle and no field with choices.
    registerSource({
      id: "collection:notes",
      label: "Notes",
      kind: "collection",
      supports: ["groupBy"],
      fields: [{ name: "title", type: "string" }],
    });
    await expect(checked.groupBy("notes")).rejects.toThrow(/groupBy/);
    // The control: a field named is grouped by.
    await checked.groupBy("notes", { field: "title" });
    expect(executed).toHaveBeenCalledTimes(1);
  });

  it("builds a query the card's own check accepts, with and without a field", async () => {
    const checked = bindReadServices({
      caller: person,
      prepare: async query => validateWidgetQuery(query),
      signal: new AbortController().signal,
      now: NOW,
      collections: { orders: "shop_orders" },
    });
    await checked.groupBy("orders");
    await checked.groupBy("orders", { field: "state", status: "all" });
    expect(executed.mock.calls.map(call => call[0])).toEqual([
      expect.objectContaining({ op: "groupBy", groupBy: "status" }),
      expect.objectContaining({
        op: "groupBy",
        groupBy: "state",
        status: "all",
      }),
    ]);
  });
});

describe("a series read", () => {
  it("asks for the range named, its entries placed by when they were made unless it says", async () => {
    await services().timeseries("orders", {
      range: "30d",
      where: { state: { equals: "paid" } },
      limit: 3,
    } as never);
    // No limit: a range sets how many points are drawn.
    expect(prepare).toHaveBeenCalledWith({
      op: "timeseries",
      dateField: "createdAt",
      range: "30d",
      where: { state: { equals: "paid" } },
      source: "collection:shop_orders",
    });
    await services().timeseries("orders", { range: "7d", dateField: "paidAt" });
    expect(prepare).toHaveBeenLastCalledWith(
      expect.objectContaining({ dateField: "paidAt", range: "7d" })
    );
  });

  it("answers the interval each range is drawn in, the one its window uses", async () => {
    const expected = {
      "7d": "day",
      "30d": "day",
      "90d": "week",
      "12m": "month",
    };
    for (const range of TIMESERIES_RANGES) {
      const answer = await services().timeseries("orders", { range });
      expect(answer.interval, range).toBe(expected[range]);
      expect(answer.interval, range).toBe(rangeWindow(range, NOW).interval);
      expect(answer.points).toEqual([
        { start: "2026-10-22T00:00:00.000Z", count: 2 },
      ]);
    }
  });

  it("answers the interval the run counted in, never one worked out beside it", async () => {
    // A run reporting another interval than the range's: what it reports is what is answered.
    executed.mockResolvedValueOnce({
      op: "timeseries",
      points: [],
      interval: "week",
    });
    expect(
      (await services().timeseries("orders", { range: "7d" })).interval
    ).toBe("week");
    // And an interval no range is drawn in is a fault, not a range's answer.
    executed.mockResolvedValueOnce({
      op: "timeseries",
      points: [],
      interval: "hour",
    });
    await expect(
      services().timeseries("orders", { range: "7d" })
    ).rejects.toMatchObject({
      logContext: { reason: "widget-read-answered-another-op" },
    });
  });

  it("builds a query the card's own check accepts, for every range", async () => {
    const checked = bindReadServices({
      caller: person,
      prepare: async query => validateWidgetQuery(query),
      signal: new AbortController().signal,
      now: NOW,
      collections: { orders: "shop_orders" },
    });
    for (const range of TIMESERIES_RANGES) {
      await checked.timeseries("orders", { range });
    }
    expect(executed).toHaveBeenCalledTimes(TIMESERIES_RANGES.length);
  });

  it("is refused by the person's check, and never run", async () => {
    const refused = NextlyError.forbidden({
      logContext: { reason: "a refusal the check made" },
    });
    prepare.mockRejectedValueOnce(refused);
    await expect(services().timeseries("orders", { range: "7d" })).rejects.toBe(
      refused
    );
    prepare.mockRejectedValueOnce(refused);
    await expect(services().groupBy("orders")).rejects.toBe(refused);
    expect(executed).not.toHaveBeenCalled();
  });
});

describe("the entries a read counts", () => {
  /** The status each read's query names, when asked as `options` says. */
  async function statusesAsked(options: object): Promise<unknown[]> {
    const bound = services();
    await bound.count("orders", options);
    await bound.find("orders", options);
    await bound.groupBy("orders", options);
    await bound.timeseries("orders", { range: "7d", ...options });
    return prepare.mock.calls.map(
      ([query]) => (query as { status?: unknown }).status
    );
  }

  it("are the published ones when the read names none, as a person's query with none reads them", async () => {
    expect(await statusesAsked({})).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("are the published ones when the read says so, asked exactly as a read naming none", async () => {
    // One question sent one way: an explicit "published" would be refused for a collection with
    // no lifecycle, where a read naming none reads every row.
    expect(await statusesAsked({ status: "published" })).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("are all of them, drafts too, when the read asks for all", async () => {
    expect(await statusesAsked({ status: "all" })).toEqual([
      "all",
      "all",
      "all",
      "all",
    ]);
  });

  it("refuse any other status before anything is checked or run", async () => {
    await expect(
      services().count("orders", { status: "draft" } as never)
    ).rejects.toBeInstanceOf(NextlyError);
    expect(prepare).not.toHaveBeenCalled();
    expect(executed).not.toHaveBeenCalled();
  });
});
