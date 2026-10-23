/**
 * The reads a declared widget's data function is handed: bound to the person asking, checked and
 * run as a card's own query is, and refused once the card has given up.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import { executeWidgetQuery } from "../../execute";
import type { WidgetQuery } from "../../query";
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

beforeEach(() => {
  vi.clearAllMocks();
  executed.mockImplementation(async query =>
    query.op === "count"
      ? { op: "count", total: 4 }
      : {
          op: "list",
          items: [{ id: "a", at: new Date("2026-01-02T03:04:05.000Z") }],
        }
  );
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
