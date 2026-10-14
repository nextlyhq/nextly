import {
  NextlyError,
  type QueryOptions,
  type ServiceOpts,
} from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import type { CatalogueItem } from "../contracts/catalogue-source";
import { money } from "../money/money";

import {
  createProductsSource,
  type ProductsSourceOptions,
} from "./products-source";

/** A stored products entry, as the collection service answers with one. */
interface Stored {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  [field: string]: unknown;
}

/** One `listEntries` call the source made. */
interface Call {
  slug: string;
  query: QueryOptions | undefined;
  opts: ServiceOpts | undefined;
}

/** A sellable, untracked product listed at 10.00, with `over` on top. */
function product(id: string, over: Record<string, unknown> = {}): Stored {
  return {
    id,
    name: `Product ${id}`,
    sku: null,
    price: 1_000,
    stockKind: "untracked",
    stockCount: null,
    maxPerLine: null,
    sellable: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  };
}

function records(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error("and/or takes a list");
  return value.filter(
    (v): v is Record<string, unknown> => typeof v === "object" && v !== null
  );
}

/**
 * One operator, as the database answers it. An operator the fake does not
 * know is refused: the real service drops one it does not know and runs the
 * wider query, so a misspelt operator would otherwise pass here and widen the
 * read there.
 */
const OPERATORS: Record<
  string,
  (actual: unknown, expected: unknown) => boolean
> = {
  equals: (actual, expected) => actual === expected,
  in: (actual, expected) =>
    Array.isArray(expected) && expected.includes(actual),
  greater_than: (actual, expected) =>
    typeof actual === "string" &&
    typeof expected === "string" &&
    actual > expected,
  contains: (actual, expected) =>
    typeof actual === "string" &&
    typeof expected === "string" &&
    actual.toLowerCase().includes(expected.toLowerCase()),
};

function applies(operator: string, actual: unknown, expected: unknown) {
  const test = OPERATORS[operator];
  if (!test) {
    throw new Error(`the fake does not answer the operator ${operator}`);
  }
  return test(actual, expected);
}

function matches(row: Stored, where: Record<string, unknown> = {}): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === "and") return records(condition).every(w => matches(row, w));
    if (key === "or") return records(condition).some(w => matches(row, w));
    if (typeof condition !== "object" || condition === null) {
      throw new Error(`the fake takes an operator object for ${key}`);
    }
    return Object.entries(condition).every(([operator, expected]) =>
      applies(operator, row[key], expected)
    );
  });
}

/** A page size the managed service serves: 1 to 500, 10 when none is asked for. */
function pageLimit(limit: number | undefined): number {
  const size = limit ?? 10;
  if (!Number.isInteger(size) || size < 1 || size > 500) {
    throw new Error(`the service does not serve a page of ${size}`);
  }
  return size;
}

/** Rows in the order asked for, or as stored when none is. */
function sorted(
  rows: Stored[],
  sort: { field: string; direction?: string } | undefined
): Stored[] {
  if (!sort) return rows;
  const sign = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = String(a[sort.field]);
    const y = String(b[sort.field]);
    return x < y ? -sign : x > y ? sign : 0;
  });
}

/** A row with only the selected fields, plus the ones the service always returns. */
function selected(
  row: Stored,
  select: Record<string, unknown> | undefined
): Stored {
  if (!select) return row;
  return {
    ...Object.fromEntries(
      Object.keys(select).map(field => [field, row[field]])
    ),
    id: row.id,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * A stand-in for the collection service holding `rows`, answering
 * `listEntries` as the managed service does: it filters by `where`, orders
 * only when asked to, pages by 1-indexed `page`, keeps only the selected
 * fields and the id, and serves at most 500 rows a page. It records every
 * call so a test can see what the source asked.
 */
function fakeCollections(rows: readonly Stored[]) {
  const calls: Call[] = [];
  const collections: ProductsSourceOptions["collections"] = {
    async listEntries(slug, query, opts) {
      calls.push({ slug, query, opts });
      if (slug !== "products") throw new Error(`no collection ${slug}`);
      const limit = pageLimit(query?.pagination?.limit);
      const page = query?.pagination?.page ?? 1;
      const matching = sorted(
        rows.filter(row => matches(row, query?.where)),
        query?.sort
      );
      const offset = (page - 1) * limit;
      const data = matching
        .slice(offset, offset + limit)
        .map(row => selected(row, query?.select));
      return {
        data,
        pagination: {
          total: matching.length,
          limit,
          offset,
          hasMore: offset + data.length < matching.length,
        },
      };
    },
  };
  return { collections, calls };
}

function sourceOver(rows: readonly Stored[]) {
  const { collections, calls } = fakeCollections(rows);
  const source = createProductsSource({
    collections,
    slug: "products",
    currency: "USD",
  });
  return { source, calls };
}

/** The ids a call asked for with `id: { in: [...] }`, wherever it sits. */
function idsAsked(call: Call): unknown[] {
  const found: unknown[] = [];
  const visit = (where: Record<string, unknown>) => {
    for (const [key, condition] of Object.entries(where)) {
      if (key === "and" || key === "or") records(condition).forEach(visit);
      else if (
        key === "id" &&
        typeof condition === "object" &&
        condition !== null &&
        "in" in condition &&
        Array.isArray(condition.in)
      ) {
        found.push(...condition.in);
      }
    }
  };
  visit(call.query?.where ?? {});
  return found;
}

async function refusal(work: () => Promise<unknown>): Promise<unknown> {
  try {
    await work();
  } catch (error) {
    return error;
  }
  throw new Error("expected a refusal, and the call succeeded");
}

describe("the products source", () => {
  it("maps each stock kind the collection stores to the catalogue's", async () => {
    const { source } = sourceOver([
      product("p-counted", { stockKind: "counted", stockCount: 4 }),
      product("p-one-left", { stockKind: "one-off", stockCount: 3 }),
      product("p-one-gone", { stockKind: "one-off", stockCount: 0 }),
      product("p-untracked", { stockKind: "untracked" }),
      product("p-to-order", { stockKind: "to-order", maxPerLine: 5 }),
      // An entry that names no kind takes the field's default.
      product("p-no-kind", { stockKind: null }),
    ]);

    const items = await source.find({
      references: [
        "p-counted",
        "p-one-left",
        "p-one-gone",
        "p-untracked",
        "p-to-order",
        "p-no-kind",
      ],
    });

    expect(
      Object.fromEntries(items.map(item => [item.reference, item.stock]))
    ).toEqual({
      "p-counted": { kind: "counted", available: 4 },
      // A one-off product is one unit, however many the count says.
      "p-one-left": { kind: "one-off", available: 1 },
      "p-one-gone": { kind: "one-off", available: 0 },
      "p-untracked": { kind: "untracked" },
      "p-to-order": { kind: "to-order", maxPerLine: 5 },
      "p-no-kind": { kind: "untracked" },
    });
  });

  it("lists a price in the store currency, keeps a zero price listed, and gives an empty price on request", async () => {
    const { source } = sourceOver([
      product("p-listed", { price: 129_900 }),
      // Zero is a price, not an absent one: a broken reading of "falsy means
      // on request" would turn a free item into one the buyer must ask about.
      product("p-free", { price: 0 }),
      product("p-ask", { price: null }),
      product("p-ask-unset", { price: undefined }),
    ]);

    const items = await source.find({
      references: ["p-listed", "p-free", "p-ask", "p-ask-unset"],
    });

    expect(
      Object.fromEntries(items.map(item => [item.reference, item.price]))
    ).toEqual({
      "p-listed": { kind: "listed", unitPrice: money(129_900, "USD") },
      "p-free": { kind: "listed", unitPrice: money(0, "USD") },
      "p-ask": { kind: "on-request" },
      "p-ask-unset": { kind: "on-request" },
    });
  });

  it("keeps a product's name and SKU, and leaves an empty SKU out", async () => {
    const { source } = sourceOver([
      product("p-1", { name: "Drill press", sku: "DP-1" }),
      product("p-2", { name: "Lathe", sku: "" }),
      product("p-3", { name: "Bench", sku: null }),
    ]);

    const items = await source.find({ references: ["p-1", "p-2", "p-3"] });

    expect(items).toEqual([
      expect.objectContaining({
        reference: "p-1",
        name: "Drill press",
        sku: "DP-1",
      }),
      expect.not.objectContaining({ sku: expect.anything() }),
      expect.not.objectContaining({ sku: expect.anything() }),
    ]);
    expect(items.map(item => item.name)).toEqual([
      "Drill press",
      "Lathe",
      "Bench",
    ]);
  });

  it("finds by reference, leaves out an unknown and an unsellable product, and asks for each once", async () => {
    const { source, calls } = sourceOver([
      product("p-a"),
      product("p-hidden", { sellable: false }),
      product("p-b"),
    ]);

    const items = await source.find({
      references: ["p-b", "p-unknown", "p-hidden", "p-b", "p-a"],
    });

    expect(items.map(item => item.reference)).toEqual(["p-b", "p-a"]);
    expect(calls).toHaveLength(1);
    expect(idsAsked(calls[0])).toEqual(["p-b", "p-unknown", "p-hidden", "p-a"]);
  });

  it("reads as the system, at depth 0, and only the fields it maps", async () => {
    const { source, calls } = sourceOver([product("p-a")]);

    await source.find({ references: ["p-a"] });

    expect(calls).toHaveLength(1);
    expect(calls[0].slug).toBe("products");
    expect(calls[0].opts).toEqual({ as: "system" });
    expect(calls[0].query?.depth).toBe(0);
    expect(calls[0].query?.select).toEqual({
      name: true,
      sku: true,
      price: true,
      stockKind: true,
      stockCount: true,
      maxPerLine: true,
    });
  });

  it("asks for a long list of references a page the service serves at a time", async () => {
    const ids = Array.from(
      { length: 501 },
      (_, i) => `p-${String(i).padStart(3, "0")}`
    );
    const { source, calls } = sourceOver(ids.map(id => product(id)));

    const items = await source.find({ references: ids });

    expect(items).toHaveLength(501);
    expect(calls.map(call => idsAsked(call).length)).toEqual([500, 1]);
  });

  it("prices one answer per line, in the order asked", async () => {
    const { source, calls } = sourceOver([
      product("p-a", { price: 2_500, stockKind: "counted", stockCount: 7 }),
      product("p-hidden", { sellable: false }),
      product("p-ask", { price: null }),
    ]);

    const priced = await source.price({
      currency: "USD",
      lines: [
        { reference: "p-unknown", quantity: 1 },
        { reference: "p-a", quantity: 2 },
        { reference: "p-hidden", quantity: 1 },
        { reference: "p-ask", quantity: 4 },
        { reference: "p-a", quantity: 3 },
      ],
    });

    const listedA = {
      found: true,
      price: { kind: "listed", unitPrice: money(2_500, "USD") },
      stock: { kind: "counted", available: 7 },
    };
    expect(priced).toEqual([
      { reference: "p-unknown", quantity: 1, found: false },
      { reference: "p-a", quantity: 2, ...listedA },
      { reference: "p-hidden", quantity: 1, found: false },
      {
        reference: "p-ask",
        quantity: 4,
        found: true,
        price: { kind: "on-request" },
        stock: { kind: "untracked" },
      },
      { reference: "p-a", quantity: 3, ...listedA },
    ]);
    expect(calls).toHaveLength(1);
  });

  it("refuses to price in a currency other than the store's, before reading anything", async () => {
    const { source, calls } = sourceOver([product("p-a")]);

    const error = await refusal(() =>
      source.price({
        currency: "EUR",
        lines: [{ reference: "p-a", quantity: 1 }],
      })
    );

    expect(NextlyError.isCode(error, "COMMERCE_CURRENCY_MISMATCH")).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("refuses a line whose quantity is not a whole number above zero", async () => {
    const { source } = sourceOver([product("p-a")]);

    for (const quantity of [0, -1, 1.5]) {
      const error = await refusal(() =>
        source.price({
          currency: "USD",
          lines: [{ reference: "p-a", quantity }],
        })
      );
      expect(NextlyError.isCode(error, "VALIDATION_ERROR")).toBe(true);
    }
  });

  describe("refuses an entry whose stored values are outside the catalogue, rather than reading them as zero", () => {
    const broken: [string, Record<string, unknown>][] = [
      ["a fractional price", { price: 12.5 }],
      ["a price beyond a safe whole number", { price: 2 ** 53 }],
      ["a negative price", { price: -1 }],
      ["a price stored as text", { price: "1999" }],
      [
        "a counted product with no count",
        { stockKind: "counted", stockCount: null },
      ],
      ["a negative count", { stockKind: "counted", stockCount: -1 }],
      ["a fractional count", { stockKind: "counted", stockCount: 1.5 }],
      [
        "a one-off product with no count",
        { stockKind: "one-off", stockCount: null },
      ],
      [
        "a made-to-order product with no line cap",
        { stockKind: "to-order", maxPerLine: null },
      ],
      ["a line cap of zero", { stockKind: "to-order", maxPerLine: 0 }],
      ["a stock kind the collection does not offer", { stockKind: "lots" }],
      ["an empty name", { name: "" }],
    ];

    it.each(broken)("%s", async (_label, over) => {
      const { source } = sourceOver([
        product("p-good"),
        product("p-bad", over),
      ]);

      const reads: [string, () => Promise<unknown>][] = [
        ["find", () => source.find({ references: ["p-good", "p-bad"] })],
        [
          "price",
          () =>
            source.price({
              currency: "USD",
              lines: [{ reference: "p-bad", quantity: 1 }],
            }),
        ],
        ["list", () => source.list?.({ limit: 10 }) ?? Promise.resolve()],
      ];
      for (const [read, work] of reads) {
        const error = await refusal(work);
        expect(
          NextlyError.isCode(error, "COMMERCE_CATALOGUE_ENTRY_INVALID"),
          `${read} refuses with COMMERCE_CATALOGUE_ENTRY_INVALID`
        ).toBe(true);
        expect(NextlyError.is(error) && error.logContext).toMatchObject({
          entry: "p-bad",
        });
      }
    });
  });

  it("lists the catalogue a page at a time in id order, each product once, handing out each cursor once", async () => {
    // Stored out of id order, so a listing that forgot to sort shows here.
    const { source, calls } = sourceOver([
      product("p-c"),
      product("p-a"),
      product("p-hidden", { sellable: false }),
      product("p-e"),
      product("p-b"),
      product("p-d"),
    ]);
    const list = source.list?.bind(source);
    if (!list) throw new Error("the products source lists");

    const pages: string[][] = [];
    const cursors: (string | null)[] = [];
    let cursor: string | null = null;
    do {
      const page = await list({ limit: 2, cursor });
      pages.push(page.items.map(item => item.reference));
      cursors.push(page.nextCursor);
      cursor = page.nextCursor;
    } while (cursor !== null && pages.length < 10);

    expect(pages).toEqual([["p-a", "p-b"], ["p-c", "p-d"], ["p-e"]]);
    expect(cursors[2]).toBeNull();
    expect(new Set(cursors.slice(0, 2)).size).toBe(2);
    expect(calls.every(call => call.query?.depth === 0)).toBe(true);
    expect(calls.every(call => call.opts?.as === "system")).toBe(true);
  });

  it("ends a listing that fills its last page exactly without an empty page after it", async () => {
    const { source } = sourceOver([product("p-a"), product("p-b")]);

    const page = await source.list?.({ limit: 2 });

    expect(page?.items.map(item => item.reference)).toEqual(["p-a", "p-b"]);
    expect(page?.nextCursor).toBeNull();
  });

  it("narrows a listing by name or SKU, whatever the case, and pages through the matches", async () => {
    const { source } = sourceOver([
      product("p-1", { name: "Drill press", sku: "DP-1" }),
      product("p-2", { name: "Lathe", sku: "LT-9" }),
      product("p-3", { name: "Press brake", sku: "PB-2" }),
      product("p-4", { name: "Bench", sku: "PRESS-X" }),
      product("p-5", { name: "Press, retired", sellable: false }),
    ]);
    const list = source.list?.bind(source);
    if (!list) throw new Error("the products source lists");

    const byName: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await list({ limit: 1, cursor, search: "PRESS" });
      byName.push(...page.items.map(item => item.reference));
      cursor = page.nextCursor;
    } while (cursor !== null && byName.length < 10);
    expect(byName).toEqual(["p-1", "p-3", "p-4"]);

    const bySku = await list({ limit: 10, search: "lt-9" });
    expect(bySku.items.map(item => item.reference)).toEqual(["p-2"]);

    // A blank search narrows nothing.
    const blank = await list({ limit: 10, search: "  " });
    expect(blank.items.map(item => item.reference)).toEqual([
      "p-1",
      "p-2",
      "p-3",
      "p-4",
    ]);
  });

  it("refuses a cursor it did not issue", async () => {
    const { source } = sourceOver([product("p-a"), product("p-b")]);
    const issued = (await source.list?.({ limit: 1 }))?.nextCursor;
    expect(typeof issued).toBe("string");

    for (const cursor of ["not-a-cursor", "p-a", `${issued}x`]) {
      const error = await refusal(
        () => source.list?.({ limit: 1, cursor }) ?? Promise.resolve()
      );
      expect(NextlyError.isCode(error, "VALIDATION_ERROR"), cursor).toBe(true);
    }
  });

  it("refuses a page size below one, and asks the service for no more than it serves", async () => {
    const { source, calls } = sourceOver([product("p-a")]);

    for (const limit of [0, -1, 1.5]) {
      const error = await refusal(
        () => source.list?.({ limit }) ?? Promise.resolve()
      );
      expect(NextlyError.isCode(error, "VALIDATION_ERROR"), String(limit)).toBe(
        true
      );
    }
    expect(calls).toHaveLength(0);

    const page = await source.list?.({ limit: 10_000 });
    expect(page?.items.map((item: CatalogueItem) => item.reference)).toEqual([
      "p-a",
    ]);
    expect(calls[0].query?.pagination?.limit).toBe(500);
  });

  it("refuses a store currency that is not a sales currency", () => {
    const { collections } = fakeCollections([]);
    let error: unknown;
    try {
      createProductsSource({ collections, slug: "products", currency: "ZZZ" });
    } catch (caught) {
      error = caught;
    }
    expect(NextlyError.isCode(error, "COMMERCE_UNKNOWN_CURRENCY")).toBe(true);
  });

  it("refuses options it cannot parse as a validation error, never a crash", () => {
    const { collections } = fakeCollections([]);
    // Reached as server code without types would call it.
    const create: { call(options: unknown): unknown } = {
      call: createProductsSource,
    };
    for (const options of [
      null,
      { slug: "products", currency: "USD" },
      { collections, slug: "", currency: "USD" },
      { collections, slug: "products", currency: "USD", cache: true },
    ]) {
      let error: unknown;
      try {
        create.call(options);
      } catch (caught) {
        error = caught;
      }
      expect(
        NextlyError.isCode(error, "VALIDATION_ERROR"),
        JSON.stringify(options)
      ).toBe(true);
    }
    expect(
      create.call({ collections, slug: "products", currency: "USD" })
    ).toMatchObject({ id: expect.any(String) });
  });
});
