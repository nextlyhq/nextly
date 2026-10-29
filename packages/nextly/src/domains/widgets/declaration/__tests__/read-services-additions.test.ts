/**
 * The read services' later additions, each checked and run as every read is:
 *
 * - `find(…, { total: true })` answers how many the same read matched;
 * - `groupBy` says when groups were left out or its counts are floors;
 * - `count(…, { window })` counts the entries in a range's window, or the one
 *   as long before it, and refuses a `dateField` that is not a date field
 *   every reader may read, as `timeseries` does;
 * - `describe` answers the collection as a widget's reads may use it.
 *
 * Each also through a binding that answers its collection "nothing there": the
 * check still runs first, and the answer is the empty collection's.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { executeWidgetQuery } from "../../execute";
import { rangeWindow, type WidgetQuery } from "../../query";
import type { WidgetResult } from "../../result";
import { clearSources, registerSource } from "../../sources";
import { bindReadServices } from "../read-services";

// What answers the query is the executor's business, tested on its own; here it stands in, so
// what the services hand it is what is observed.
vi.mock("../../execute", () => ({ executeWidgetQuery: vi.fn() }));
const executed = vi.mocked(executeWidgetQuery);

const person = { user: { id: "reader" } } as never;
const prepare = vi.fn(async (query: unknown) => query as WidgetQuery);
/** The batch's instant the card was handed. */
const NOW = new Date(Date.UTC(2026, 9, 22, 12));

function services(answersNothing?: (slug: string) => boolean) {
  return bindReadServices({
    caller: person,
    prepare,
    signal: new AbortController().signal,
    now: NOW,
    ...(answersNothing === undefined ? {} : { answersNothing }),
  });
}

/** A binding that answers every collection "nothing there". */
const nothing = () => services(() => true);

beforeEach(() => {
  vi.clearAllMocks();
  clearSources();
  registerSource({
    id: "collection:orders",
    label: "Orders",
    kind: "collection",
    lifecycleStatus: true,
    titleField: "ref",
    supports: ["count", "list", "groupBy", "timeseries"],
    fields: [
      { name: "ref", type: "string", label: "Reference" },
      {
        name: "state",
        type: "string",
        label: "State",
        choices: [{ value: "paid", label: "Paid" }],
        groupable: false,
      },
      { name: "notes", type: "string", presentable: false },
      { name: "createdAt", type: "date" },
      { name: "paidAt", type: "date", label: "Paid at" },
      // A read rule could refuse it to some reader: never offered, never a window.
      { name: "secretAt", type: "date", offered: false },
      { name: "secret", type: "string", offered: false },
    ],
  });
  registerSource({
    id: "collection:guarded_title",
    label: "Guarded",
    kind: "collection",
    titleField: "hidden",
    supports: ["count", "list"],
    fields: [{ name: "hidden", type: "string", offered: false }],
  });
});

describe("a list read's total", () => {
  beforeEach(() => {
    executed.mockResolvedValue({
      op: "list",
      items: [{ id: "a" }],
      total: 40,
      atLeast: true,
    } satisfies WidgetResult);
  });

  it("is answered only when the call asks, from the same read as its rows", async () => {
    expect(await services().find("orders")).toEqual({ items: [{ id: "a" }] });
    expect(await services().find("orders", { total: true })).toEqual({
      items: [{ id: "a" }],
      total: 40,
      atLeast: true,
    });
    // One read each: the total is the list's own count, never a second read.
    expect(executed).toHaveBeenCalledTimes(2);
  });

  it("is refused when named as anything but true, before anything is checked", async () => {
    await expect(
      services().find("orders", { total: "yes" } as never)
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(prepare).not.toHaveBeenCalled();
  });

  it("is zero for a collection answered as nothing there, after the read is checked", async () => {
    expect(await nothing().find("orders", { total: true })).toEqual({
      items: [],
      total: 0,
    });
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(executed).not.toHaveBeenCalled();
  });
});

describe("a list read asked for no rows", () => {
  beforeEach(() => {
    executed.mockResolvedValue({
      op: "list",
      items: [{ id: "a" }],
      total: 40,
    } satisfies WidgetResult);
  });

  it("answers no rows, as a card two rows high draws none, and runs nothing for no total", async () => {
    // 🔴 A query runs at one row at the least, so a limit of 0 read as is answered one row
    // the card's frame does not draw (`rowsThatFit` is 0 for it).
    expect(await services().find("orders", { limit: 0 })).toEqual({
      items: [],
    });
    // Checked as any read is, at the one row a query runs at.
    expect(prepare).toHaveBeenCalledWith(
      expect.objectContaining({ op: "list", limit: 1 })
    );
    expect(executed).not.toHaveBeenCalled();
  });

  it("still counts the total it asks for, from the read, with no rows", async () => {
    expect(await services().find("orders", { limit: 0, total: true })).toEqual({
      items: [],
      total: 40,
    });
  });

  it("answers the rows a limit of one asks for, the control", async () => {
    expect(await services().find("orders", { limit: 1 })).toEqual({
      items: [{ id: "a" }],
    });
  });
});

describe("a grouping read's flags", () => {
  it("say when groups were left out and the counts are floors, only when the read says so", async () => {
    executed.mockResolvedValueOnce({
      op: "groupBy",
      buckets: [{ value: "paid", count: 3 }],
      truncated: true,
      atLeast: true,
    });
    expect(await services().groupBy("orders", { field: "state" })).toEqual({
      buckets: [{ value: "paid", count: 3 }],
      truncated: true,
      atLeast: true,
    });
    executed.mockResolvedValueOnce({
      op: "groupBy",
      buckets: [{ value: "paid", count: 3 }],
      truncated: false,
    });
    expect(await services().groupBy("orders", { field: "state" })).toEqual({
      buckets: [{ value: "paid", count: 3 }],
    });
  });

  it("are absent for a collection answered as nothing there, which has no groups", async () => {
    expect(await nothing().groupBy("orders", { field: "state" })).toEqual({
      buckets: [],
    });
    expect(executed).not.toHaveBeenCalled();
  });
});

describe("a count over a window", () => {
  beforeEach(() => {
    executed.mockResolvedValue({ op: "count", total: 9 });
  });

  /** The window a series over `range` is drawn across, from its first instant to the batch's. */
  const span = (range: "7d" | "30d" | "90d" | "12m") => {
    const { start } = rangeWindow(range, NOW);
    return { from: start, to: NOW };
  };

  it("counts the entries created in the window a series over the range is drawn across", async () => {
    expect(await services().count("orders", { window: { range: "30d" } })).toBe(
      9
    );
    const { from } = span("30d");
    expect(prepare).toHaveBeenCalledWith({
      op: "count",
      source: "collection:orders",
      where: {
        and: [
          {
            createdAt: {
              greater_than_equal: from.toISOString(),
              // The batch's instant is a whole second, so the window keeps
              // it: one millisecond past it (MySQL rounds a stored DATETIME).
              less_than: "2026-10-22T12:00:00.001Z",
            },
          },
        ],
      },
    });
  });

  it("counts the window as long that ends where it starts, for previous", async () => {
    await services().count("orders", {
      window: { range: "30d", previous: true },
    });
    const { from, to } = span("30d");
    const length = to.getTime() - from.getTime();
    expect(prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          and: [
            {
              createdAt: {
                greater_than_equal: new Date(
                  from.getTime() - length
                ).toISOString(),
                less_than: from.toISOString(),
              },
            },
          ],
        },
      })
    );
  });

  it("joins the window to the call's own where, by the date field it names", async () => {
    await services().count("orders", {
      where: { state: { equals: "paid" }, and: [{ ref: { equals: "x" } }] },
      window: { range: "7d", dateField: "paidAt" },
      status: "all",
    });
    const { from } = span("7d");
    expect(prepare).toHaveBeenCalledWith({
      op: "count",
      source: "collection:orders",
      status: "all",
      where: {
        state: { equals: "paid" },
        and: [
          { ref: { equals: "x" } },
          {
            paidAt: {
              greater_than_equal: from.toISOString(),
              less_than: "2026-10-22T12:00:00.001Z",
            },
          },
        ],
      },
    });
  });

  it.each([
    ["a field that holds no date", "state"],
    ["a field the collection does not have", "shippedAt"],
    ["a date some reader could be refused", "secretAt"],
  ])("is refused for %s, and never run", async (_case, dateField) => {
    await expect(
      services().count("orders", { window: { range: "30d", dateField } })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(executed).not.toHaveBeenCalled();
  });

  it("is refused before a binding answers nothing there, the same for every reader", async () => {
    // 🔴 Answered as nothing there first, a reader whose collection is empty
    // to them would be told 0 where every other reader is refused.
    await expect(
      nothing().count("orders", {
        window: { range: "30d", dateField: "secretAt" },
      })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it.each([
    ["a range no series is drawn over", { range: "60d" }],
    ["previous as anything but true", { range: "30d", previous: false }],
    ["a dateField that is not a name", { range: "30d", dateField: 3 }],
    ["no object at all", "30d"],
  ])("is refused for %s, before anything is checked", async (_case, window) => {
    await expect(
      services().count("orders", { window } as never)
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(prepare).not.toHaveBeenCalled();
  });

  it("is zero for a collection answered as nothing there", async () => {
    expect(await nothing().count("orders", { window: { range: "30d" } })).toBe(
      0
    );
    expect(executed).not.toHaveBeenCalled();
  });
});

describe("a series read's date field", () => {
  it.each([
    ["a date some reader could be refused", "secretAt"],
    ["a field that holds no date", "state"],
  ])(
    "is refused for %s, before a binding answers nothing there",
    async (_case, dateField) => {
      for (const bound of [services(), nothing()]) {
        await expect(
          bound.timeseries("orders", { range: "7d", dateField })
        ).rejects.toMatchObject({ code: "INVALID_INPUT" });
      }
      expect(executed).not.toHaveBeenCalled();
    }
  );

  it("is accepted for a date every reader may read", async () => {
    executed.mockResolvedValueOnce({
      op: "timeseries",
      points: [],
      interval: "day",
    });
    await expect(
      services().timeseries("orders", { range: "7d", dateField: "paidAt" })
    ).resolves.toEqual({ points: [], interval: "day" });
  });
});

describe("a collection's description", () => {
  it("names its title, its status and every field a reader may read, as a widget's reads may use them", async () => {
    expect(await services().describe("orders")).toEqual({
      title: "ref",
      status: true,
      fields: [
        { name: "ref", type: "string", label: "Reference" },
        {
          name: "state",
          type: "string",
          label: "State",
          choices: [{ value: "paid", label: "Paid" }],
          groupable: false,
        },
        // No label of its own: named from its key, as the admin names it.
        { name: "notes", type: "string", label: "Notes", presentable: false },
        { name: "createdAt", type: "date", label: "Created At" },
        { name: "paidAt", type: "date", label: "Paid at" },
      ],
    });
    // Checked as a read of the collection is, and nothing run.
    expect(prepare).toHaveBeenCalledWith({
      op: "count",
      source: "collection:orders",
    });
    expect(executed).not.toHaveBeenCalled();
  });

  it("names a field the collection gives no label from its key, by the admin's one humaniser", async () => {
    // 🔴 Left without a label, or named by its raw key, a column the admin
    // heads "Created At" would read "createdAt" wherever a widget drew it.
    const described = await services().describe("orders");
    const label = (name: string) =>
      described?.fields.find(field => field.name === name)?.label;
    expect(label("createdAt")).toBe("Created At");
    // The control: a label of the collection's own is kept as written.
    expect(label("paidAt")).toBe("Paid at");
  });

  it("names no title a read rule could refuse", async () => {
    expect(await services().describe("guarded_title")).toEqual({
      status: false,
      fields: [],
    });
  });

  it("is refused as a read of the collection is, for a person who may not read it", async () => {
    prepare.mockRejectedValueOnce(new Error("not this reader's"));
    await expect(services().describe("orders")).rejects.toThrow(
      "not this reader's"
    );
  });

  it("is nothing for a collection answered as nothing there, after the check", async () => {
    expect(await nothing().describe("orders")).toBeUndefined();
    expect(prepare).toHaveBeenCalledTimes(1);
  });
});
