import { randomUUID } from "node:crypto";

import { NextlyError } from "@nextlyhq/plugin-sdk";

import {
  assertCatalogueSource,
  catalogueItemSchema,
  pricedLineSchema,
  type CatalogueItem,
  type CatalogueSource,
  type PricedLine,
} from "../contracts/catalogue-source";

import {
  expectContract,
  expectRefusal,
  ContractViolation,
  type ContractCase,
} from "./contract-case";

/** @experimental */
export interface CatalogueSourceContractOptions {
  /** A fresh source for each case, holding at least the fixture items below. */
  create(): CatalogueSource | Promise<CatalogueSource>;
  /** The store's currency. */
  readonly currency: string;
  readonly fixtures: {
    /** An item with a listed price. */
    readonly listed: string;
    /** An item priced on request, when the source has any. */
    readonly onRequest?: string;
    /** A reference the source does not know. */
    readonly unknown: string;
    /**
     * A counted item with at least two units left, whose figure goes down
     * when a sale is reported. Required when the source hears stock reports:
     * it is how the suite sees a repeated report applied once, which the
     * listener's own confirmation cannot show. Two units at least, because
     * with one a sale applied twice stops at zero just as one sale does.
     */
    readonly soldFrom?: string;
    /**
     * An item made to order or on backorder, for a source that sells any, and
     * the most one line may ask for, as the source holds it: such an item
     * holds no stock and caps each line instead, so the cap the source
     * reports is the cap a cart enforces.
     */
    readonly toOrder?: {
      readonly reference: string;
      readonly maxPerLine: number;
    };
    /**
     * Every reference the source holds, for a source that lists. Given, the
     * listing must hold exactly these; left out, the listing case checks only
     * that the named fixtures are listed, and is named for that.
     */
    readonly catalogue?: readonly string[];
    /**
     * A search the listing narrows by: a query that finds one item and leaves
     * out another. Required when the source lists, so its search is exercised.
     */
    readonly search?: {
      readonly query: string;
      readonly finds: string;
      readonly skips: string;
    };
  };
}

/**
 * The catalogue contract's test suite. Every catalogue source runs it in its
 * own tests:
 *
 * ```ts
 * for (const c of await catalogueSourceContract(options)) it(c.name, c.run);
 * ```
 *
 * The cases for listing and for stock reports exist only when the source
 * offers them, so none of them passes without checking anything. A stock
 * report's answer is lost once and the report repeated, as commerce does on a
 * retry; the source must record it once.
 *
 * @experimental
 * @throws `ContractViolation` for a source that hears stock reports when
 *   `fixtures.soldFrom` is not given, or that lists when `fixtures.search` is
 *   not given.
 */
export async function catalogueSourceContract(
  options: CatalogueSourceContractOptions
): Promise<ContractCase[]> {
  const { fixtures } = options;
  const unique = (label: string) => `${label}-${randomUUID()}`;
  const cases: ContractCase[] = [];
  const add = (
    name: string,
    run: (source: CatalogueSource) => Promise<void> | void
  ) =>
    cases.push({
      name,
      async run() {
        await run(await options.create());
      },
    });

  add("declares a valid id and the methods it offers", source => {
    try {
      assertCatalogueSource(source);
    } catch (error) {
      throw new ContractViolation(
        `the source's declaration is refused: ${describeError(error)}`
      );
    }
  });

  add(
    "finds items by reference, and leaves out a reference it does not know",
    async source => {
      const asked = [fixtures.listed, fixtures.unknown, fixtures.listed];
      const items = (await source.find({ references: asked })).map(asItem);
      const references = items.map(i => i.reference);
      expectContract(
        references.includes(fixtures.listed),
        "a known item is found"
      );
      expectContract(
        !references.includes(fixtures.unknown),
        "an unknown reference is left out"
      );
      expectContract(
        new Set(references).size === references.length,
        "an item asked for twice is answered once"
      );
      expectContract(
        references.every(r => asked.includes(r)),
        "only items asked for are answered"
      );
    }
  );

  add(
    "prices lines for checkout, one answer per line in the order asked",
    async source => {
      // The listed item is asked for twice, with different quantities: two
      // lines of one cart, each answered in its own place.
      const lines = [
        { reference: fixtures.unknown, quantity: 1 },
        { reference: fixtures.listed, quantity: 2 },
        ...(fixtures.onRequest
          ? [{ reference: fixtures.onRequest, quantity: 1 }]
          : []),
        { reference: fixtures.listed, quantity: 3 },
      ];
      const priced = (
        await source.price({ currency: options.currency, lines })
      ).map(asLine);
      expectContract(priced.length === lines.length, "one answer per line");
      priced.forEach((line, index) => {
        expectContract(
          line.reference === lines[index].reference &&
            line.quantity === lines[index].quantity,
          `answer ${index} is for line ${index}`
        );
      });
      expectContract(
        priced[0].found === false,
        "an unknown reference is answered as not found"
      );
      for (const listed of [priced[1], priced[priced.length - 1]]) {
        expectContract(
          listed.found && listed.price.kind === "listed",
          "a listed item has its price, on each line that asks for it"
        );
        if (listed.found && listed.price.kind === "listed") {
          expectContract(
            listed.price.unitPrice.currency === options.currency,
            "a price is in the store's currency"
          );
        }
      }
      if (fixtures.onRequest) {
        const onRequest = priced[2];
        expectContract(
          onRequest.found && onRequest.price.kind === "on-request",
          "an item priced on request has no price"
        );
      }
    }
  );

  const toOrder = fixtures.toOrder?.reference;
  const cap = fixtures.toOrder?.maxPerLine;
  if (toOrder !== undefined && cap !== undefined) {
    add(
      "reports an item sold to order, with the most a line may ask for",
      async source => {
        const [item] = (await source.find({ references: [toOrder] })).map(
          asItem
        );
        expectContract(
          item !== undefined,
          `the fixture item ${toOrder} exists`
        );
        expectContract(
          item.stock.kind === "to-order",
          `${toOrder} is sold to order with a per-line cap, not ${item.stock.kind}`
        );
        expectContract(
          item.stock.maxPerLine === cap,
          `${toOrder}'s cap is ${String(cap)}, not ${String(item.stock.maxPerLine)}`
        );
        const [line] = (
          await source.price({
            currency: options.currency,
            lines: [{ reference: toOrder, quantity: 1 }],
          })
        ).map(asLine);
        expectContract(
          line.found &&
            line.stock.kind === "to-order" &&
            line.stock.maxPerLine === cap,
          "pricing reports the same kind and cap as finding"
        );
      }
    );
  }

  const probe = await options.create();

  if (probe.list) {
    const search = fixtures.search;
    if (search === undefined) {
      throw new ContractViolation(
        "a source that lists needs fixtures.search, a query that finds one item and leaves out another"
      );
    }
    const catalogue = fixtures.catalogue;
    add(
      catalogue !== undefined
        ? "lists every item a page at a time, each once"
        : "lists the named fixtures a page at a time, each once",
      async source => {
        const seen = await listAll(source, 2);
        if (catalogue !== undefined) expectSameReferences(seen, catalogue);
        // Every named fixture is listed either way, the item sold to order
        // among them, so a source that lists only some kinds of item fails
        // however the whole catalogue was given, or if it was not.
        const named = [
          fixtures.listed,
          fixtures.onRequest,
          fixtures.soldFrom,
          fixtures.toOrder?.reference,
        ];
        for (const reference of named) {
          if (reference === undefined) continue;
          expectContract(
            seen.has(reference),
            `the listing includes ${reference}`
          );
        }
      }
    );
    add("narrows the listing to a search, a page at a time", async source => {
      // One item a page, so a search that matches more than one pages too.
      const found = await listAll(source, 1, search.query);
      expectContract(
        found.has(search.finds),
        `the search "${search.query}" finds ${search.finds}`
      );
      expectContract(
        !found.has(search.skips),
        `the search "${search.query}" leaves out ${search.skips}`
      );
    });
  }

  if (probe.stock) {
    const soldFrom = fixtures.soldFrom;
    if (soldFrom === undefined) {
      throw new ContractViolation(
        "a source that hears stock reports needs fixtures.soldFrom, an item whose stock a sale lowers"
      );
    }
    add(
      "records a stock report once when its answer is lost and it is repeated",
      async source => {
        const stock = source.stock;
        expectContract(stock !== undefined, "the source hears stock reports");
        const before = await available(source, soldFrom);
        expectContract(
          before >= 2,
          `the fixture item ${soldFrom} holds at least two units, so one sale and two differ (it holds ${before})`
        );
        const report = {
          operationId: unique("op"),
          kind: "sale" as const,
          reference: soldFrom,
          quantity: 1,
          orderReference: unique("order"),
        };
        await stock.report(report); // the answer is lost
        await stock.report(report);
        const confirmed = await stock.confirm({
          operationId: report.operationId,
        });
        expectContract(
          confirmed.recorded === true,
          "a recorded report is confirmed"
        );
        const unknown = await stock.confirm({ operationId: unique("op") });
        expectContract(
          unknown.recorded === false,
          "a report never made is not confirmed"
        );
        const after = await available(source, soldFrom);
        expectContract(
          after === before - 1,
          `a sale reported twice lowers stock once (${before} before, ${after} after)`
        );
      }
    );

    add(
      "records a hold and its release once each when their answers are lost and they are repeated",
      async source => {
        const stock = source.stock;
        expectContract(stock !== undefined, "the source hears stock reports");
        const before = await available(source, soldFrom);
        const orderReference = unique("order");
        const hold = {
          operationId: unique("op"),
          kind: "hold" as const,
          reference: soldFrom,
          quantity: 1,
          orderReference,
        };
        const release = {
          ...hold,
          operationId: unique("op"),
          kind: "release" as const,
        };
        for (const report of [hold, release]) {
          await stock.report(report); // the answer is lost
          const once = await available(source, soldFrom);
          await stock.report(report);
          const repeated = await available(source, soldFrom);
          // Looked at after each repeat, not only at the end, where a hold and
          // a release each applied twice would still cancel out.
          expectContract(
            repeated === once,
            `the repeated ${report.kind} changed nothing (${once} after the first, ${repeated} after the repeat)`
          );
          expectContract(
            (await stock.confirm({ operationId: report.operationId })).recorded,
            `the ${report.kind} is confirmed`
          );
        }
        // A hold and its release cancel out whether or not this source counts
        // holds in its own figure, so one applied twice shows here.
        const after = await available(source, soldFrom);
        expectContract(
          after === before,
          `a hold and its release leave the stock as it was (${before} before, ${after} after)`
        );
      }
    );

    add(
      "refuses a stock report that reuses another report's operation id",
      async source => {
        const stock = source.stock;
        expectContract(stock !== undefined, "the source hears stock reports");
        const operationId = unique("op");
        await stock.report({
          operationId,
          kind: "hold",
          reference: soldFrom,
          quantity: 1,
          orderReference: unique("order"),
        });
        // The refused report is a sale, which would lower the watched item's
        // stock, so a source that applies it before refusing is caught.
        const before = await available(source, soldFrom);
        expectContract(
          before > 0,
          `the fixture item ${soldFrom} has stock left`
        );
        const error = await expectRefusal(
          () =>
            stock.report({
              operationId,
              kind: "sale",
              reference: soldFrom,
              quantity: 1,
              orderReference: unique("order"),
            }),
          "a different report under a used operation id is refused"
        );
        expectContract(
          NextlyError.isCode(error, "COMMERCE_OPERATION_KEY_REUSED"),
          `the refusal is COMMERCE_OPERATION_KEY_REUSED, not ${describeError(error)}`
        );
        const after = await available(source, soldFrom);
        expectContract(
          after === before,
          `a refused report changes no stock (${before} before, ${after} after)`
        );
      }
    );
  }

  return cases;
}

/**
 * Every reference a listing hands out, read page by page until the last and
 * held to the listing's rules on the way: a page holds at most the limit,
 * each item is listed once, every page before the last holds an item, and a
 * cursor is handed out once. No bound on the number of pages, so a catalogue
 * of any size passes; the listing still always ends or fails, since every
 * page but the last adds an item never listed before and a cursor handed out
 * twice is a loop.
 */
async function listAll(
  source: CatalogueSource,
  limit: number,
  search?: string
): Promise<Set<string>> {
  const list = source.list?.bind(source);
  expectContract(list !== undefined, "the source lists");
  const seen = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const answer = await list({ limit, cursor, ...(search ? { search } : {}) });
    expectContract(
      answer.items.length <= limit,
      "a page holds at most the limit"
    );
    for (const item of answer.items.map(asItem)) {
      expectContract(
        !seen.has(item.reference),
        `${item.reference} is listed once`
      );
      seen.add(item.reference);
    }
    cursor = answer.nextCursor;
    if (cursor === null) break;
    expectContract(
      answer.items.length > 0,
      "a page before the last holds at least one item"
    );
    expectContract(
      !cursors.has(cursor),
      "a cursor is handed out once, so the listing moves forward"
    );
    cursors.add(cursor);
  } while (cursor !== null);
  return seen;
}

/** The listing holds exactly the catalogue given: none left out, none extra. */
function expectSameReferences(
  seen: ReadonlySet<string>,
  catalogue: readonly string[]
): void {
  const expected = new Set(catalogue);
  for (const reference of expected) {
    expectContract(seen.has(reference), `the listing includes ${reference}`);
  }
  for (const reference of seen) {
    expectContract(
      expected.has(reference),
      `the listing holds only the catalogue's items, not ${reference}`
    );
  }
}

async function available(
  source: CatalogueSource,
  reference: string
): Promise<number> {
  const [item] = (await source.find({ references: [reference] })).map(asItem);
  expectContract(item !== undefined, `the fixture item ${reference} exists`);
  const { stock } = item;
  expectContract(
    stock.kind === "counted" || stock.kind === "one-off",
    `the fixture item ${reference} has counted stock`
  );
  return stock.available;
}

function asItem(answer: unknown): CatalogueItem {
  const parsed = catalogueItemSchema.safeParse(answer);
  if (!parsed.success) {
    throw new ContractViolation(
      `an item is outside the contract: ${parsed.error.issues.map(i => i.message).join("; ")}`
    );
  }
  return parsed.data;
}

function asLine(answer: unknown): PricedLine {
  const parsed = pricedLineSchema.safeParse(answer);
  if (!parsed.success) {
    throw new ContractViolation(
      `a priced line is outside the contract: ${parsed.error.issues.map(i => i.message).join("; ")}`
    );
  }
  return parsed.data;
}

function describeError(error: unknown): string {
  if (NextlyError.is(error)) return String(error.code);
  return error instanceof Error ? error.message : String(error);
}
