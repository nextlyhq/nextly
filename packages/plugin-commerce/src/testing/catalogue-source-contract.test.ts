import { describe, expect, it } from "vitest";

import type {
  CatalogueItem,
  CatalogueSource,
} from "../contracts/catalogue-source";
import { money } from "../money/money";

import { catalogueSourceContract } from "./catalogue-source-contract";
import { runContractCases, type ContractCase } from "./contract-case";
import { createInMemoryCatalogueSource } from "./in-memory-catalogue-source";

const items: CatalogueItem[] = [
  {
    reference: "drill-press",
    name: "Drill press",
    sku: "DP-1",
    price: { kind: "listed", unitPrice: money(129_900, "USD") },
    stock: { kind: "counted", available: 4 },
  },
  {
    reference: "used-lathe",
    name: "Used lathe",
    price: { kind: "listed", unitPrice: money(850_000, "USD") },
    stock: { kind: "one-off", available: 1 },
  },
  {
    reference: "custom-rig",
    name: "Custom rig",
    price: { kind: "on-request" },
    stock: { kind: "untracked" },
  },
];

function suiteFor(
  breakIt: (source: CatalogueSource) => CatalogueSource = s => s
): Promise<ContractCase[]> {
  return catalogueSourceContract({
    currency: "USD",
    fixtures: {
      listed: "drill-press",
      onRequest: "custom-rig",
      unknown: "no-such-item",
      soldFrom: "drill-press",
    },
    create: () =>
      breakIt(createInMemoryCatalogueSource({ currency: "USD", items }).source),
  });
}

describe("the catalogue contract suite against the in-memory source", async () => {
  const cases = await suiteFor();
  for (const c of cases) it(c.name, c.run);

  it("includes the listing and stock cases, since the source offers both", () => {
    const names = cases.map(c => c.name).join("\n");
    expect(names).toMatch(/lists every item/);
    expect(names).toMatch(/records a stock report once/);
  });
});

describe("the catalogue contract suite catches a broken source", () => {
  async function failingCases(
    breakIt: (s: CatalogueSource) => CatalogueSource
  ) {
    const run = await runContractCases(await suiteFor(breakIt));
    return run.failed.map(f => f.name);
  }

  it("fails a source that answers an unknown reference with a placeholder", async () => {
    const failed = await failingCases(s => ({
      ...s,
      find: async input =>
        input.references.map(reference => ({
          reference,
          name: reference,
          price: { kind: "on-request" as const },
          stock: { kind: "untracked" as const },
        })),
    }));
    expect(failed).toContain(
      "finds items by reference, and leaves out a reference it does not know"
    );
  });

  it("fails a source that answers priced lines out of order", async () => {
    const failed = await failingCases(s => ({
      ...s,
      price: async input => [...(await s.price(input))].reverse(),
    }));
    expect(failed).toContain(
      "prices lines for checkout, one answer per line in the order asked"
    );
  });

  it("fails a source that records a repeated stock report twice", async () => {
    const failed = await failingCases(s => {
      const stock = s.stock;
      if (!stock) return s;
      let n = 0;
      return {
        ...s,
        stock: {
          report: input =>
            stock.report({
              ...input,
              operationId: `${input.operationId}-${++n}`,
            }),
          confirm: async input => ({
            recorded: (
              await stock.confirm({ operationId: `${input.operationId}-1` })
            ).recorded,
          }),
        },
      };
    });
    expect(failed).toContain(
      "records a stock report once when its answer is lost and it is repeated"
    );
  });

  it("fails a source whose listing repeats an item across pages", async () => {
    const failed = await failingCases(s => {
      const list = s.list;
      if (!list) return s;
      return {
        ...s,
        list: async input => {
          const page = await list(input);
          return {
            ...page,
            items: [...page.items, ...page.items].slice(0, input.limit),
          };
        },
      };
    });
    expect(failed).toContain("lists every item a page at a time, each once");
  });

  it("passes every case for the unbroken source, so the failures above are the breaks", async () => {
    expect(await failingCases(s => s)).toEqual([]);
  });
});
