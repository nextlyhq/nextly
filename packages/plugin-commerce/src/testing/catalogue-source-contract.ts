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
     * A counted or one-off item with stock left, whose figure goes down when a
     * sale is reported. Required when the source hears stock reports: it is
     * how the suite sees a repeated report applied once, which the
     * listener's own confirmation cannot show.
     */
    readonly soldFrom?: string;
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
 *   `fixtures.soldFrom` is not given.
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
      const lines = [
        { reference: fixtures.unknown, quantity: 1 },
        { reference: fixtures.listed, quantity: 2 },
        ...(fixtures.onRequest
          ? [{ reference: fixtures.onRequest, quantity: 1 }]
          : []),
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
      const listed = priced[1];
      expectContract(
        listed.found && listed.price.kind === "listed",
        "a listed item has its price"
      );
      if (listed.found && listed.price.kind === "listed") {
        expectContract(
          listed.price.unitPrice.currency === options.currency,
          "a price is in the store's currency"
        );
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

  const probe = await options.create();

  if (probe.list) {
    add("lists every item a page at a time, each once", async source => {
      const list = source.list?.bind(source);
      expectContract(list !== undefined, "the source lists");
      const seen = new Set<string>();
      let cursor: string | null = null;
      // A bound on pages, so a source whose cursor never ends fails the case
      // instead of hanging it.
      for (let page = 0; page < 1000; page++) {
        const answer = await list({ limit: 2, cursor });
        expectContract(
          answer.items.length <= 2,
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
      }
      expectContract(cursor === null, "the listing ends");
      const known = [fixtures.listed, fixtures.onRequest, fixtures.soldFrom];
      for (const reference of known) {
        if (reference === undefined) continue;
        expectContract(
          seen.has(reference),
          `the listing includes ${reference}`
        );
      }
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
          before > 0,
          `the fixture item ${soldFrom} has stock left`
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
      "refuses a stock report that reuses another report's operation id",
      async source => {
        const stock = source.stock;
        expectContract(stock !== undefined, "the source hears stock reports");
        const operationId = unique("op");
        await stock.report({
          operationId,
          kind: "hold",
          reference: fixtures.listed,
          quantity: 1,
          orderReference: unique("order"),
        });
        const error = await expectRefusal(
          () =>
            stock.report({
              operationId,
              kind: "release",
              reference: fixtures.listed,
              quantity: 1,
              orderReference: unique("order"),
            }),
          "a different report under a used operation id is refused"
        );
        expectContract(
          NextlyError.isCode(error, "COMMERCE_OPERATION_KEY_REUSED"),
          `the refusal is COMMERCE_OPERATION_KEY_REUSED, not ${describeError(error)}`
        );
      }
    );
  }

  return cases;
}

async function available(
  source: CatalogueSource,
  reference: string
): Promise<number> {
  const [item] = (await source.find({ references: [reference] })).map(asItem);
  expectContract(item !== undefined, `the fixture item ${reference} exists`);
  expectContract(
    item.stock.kind !== "untracked",
    `the fixture item ${reference} has counted stock`
  );
  return item.stock.available;
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
