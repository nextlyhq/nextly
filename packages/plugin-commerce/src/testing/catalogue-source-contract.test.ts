import { describe, expect, it } from "vitest";

import type {
  CatalogueItem,
  CatalogueSource,
} from "../contracts/catalogue-source";
import { commerceError } from "../errors";
import { money } from "../money/money";

import { catalogueSourceContract } from "./catalogue-source-contract";
import {
  ContractViolation,
  runContractCases,
  type ContractCase,
} from "./contract-case";
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
  {
    reference: "made-to-order-bench",
    name: "Made-to-order bench",
    price: { kind: "listed", unitPrice: money(45_000, "USD") },
    stock: { kind: "to-order", maxPerLine: 99 },
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
      toOrder: { reference: "made-to-order-bench", maxPerLine: 99 },
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

describe("the catalogue contract suite's options", () => {
  it("refuses a source that hears stock reports but names no counted item to watch", async () => {
    // Without one, a report applied twice is invisible: only the listener's
    // own confirmation could be checked.
    await expect(
      catalogueSourceContract({
        currency: "USD",
        fixtures: { listed: "drill-press", unknown: "no-such-item" },
        create: () =>
          createInMemoryCatalogueSource({ currency: "USD", items }).source,
      })
    ).rejects.toBeInstanceOf(ContractViolation);
  });
});

describe("the catalogue contract suite against a large catalogue", () => {
  it("lists every item however many pages it takes", async () => {
    // At two items a page, 2,100 items take 1,050 pages: more than any fixed
    // page bound a suite might pick, which a correct source must still pass.
    const many: CatalogueItem[] = Array.from({ length: 2_100 }, (_, i) => ({
      reference: `part-${i}`,
      name: `Part ${i}`,
      price: { kind: "listed", unitPrice: money(100 + i, "USD") },
      stock: { kind: "untracked" },
    }));
    const cases = await catalogueSourceContract({
      currency: "USD",
      fixtures: {
        listed: "drill-press",
        onRequest: "custom-rig",
        unknown: "no-such-item",
        soldFrom: "drill-press",
      },
      create: () =>
        createInMemoryCatalogueSource({
          currency: "USD",
          items: [...items, ...many],
        }).source,
    });
    const listing = cases.find(c => c.name.startsWith("lists every item"));
    expect(listing).toBeDefined();
    await expect(listing?.run()).resolves.toBeUndefined();
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
      // Each page after the first starts again with the last item of the page
      // before it, as a cursor taken one place too early would.
      let last: CatalogueItem | undefined;
      return {
        ...s,
        list: async input => {
          const page = await list(input);
          const items =
            input.cursor && last ? [last, ...page.items] : page.items;
          last = page.items.at(-1);
          return { ...page, items: items.slice(0, input.limit) };
        },
      };
    });
    expect(failed).toContain("lists every item a page at a time, each once");
  });

  it("fails a source that records a conflicting report before refusing its reused operation id", async () => {
    const failed = await failingCases(s => {
      const stock = s.stock;
      if (!stock) return s;
      const reports = new Map<string, string>();
      let n = 0;
      return {
        ...s,
        stock: {
          report: async input => {
            const report = `${input.kind}:${input.reference}:${input.quantity}:${input.orderReference}`;
            const seen = reports.get(input.operationId);
            reports.set(input.operationId, report);
            if (seen !== undefined && seen !== report) {
              await stock.report({ ...input, operationId: `late-${++n}` });
              throw commerceError("COMMERCE_OPERATION_KEY_REUSED");
            }
            return stock.report(input);
          },
          confirm: input => stock.confirm(input),
        },
      };
    });
    expect(failed).toContain(
      "refuses a stock report that reuses another report's operation id"
    );
  });

  it("fails a source that reports another cap for an item sold to order", async () => {
    const failed = await failingCases(s => {
      const capped = (stock: CatalogueItem["stock"]): CatalogueItem["stock"] =>
        stock.kind === "to-order" ? { kind: "to-order", maxPerLine: 1 } : stock;
      return {
        ...s,
        find: async input =>
          (await s.find(input)).map(item => ({
            ...item,
            stock: capped(item.stock),
          })),
        price: async input =>
          (await s.price(input)).map(line =>
            line.found ? { ...line, stock: capped(line.stock) } : line
          ),
      };
    });
    expect(failed).toContain(
      "reports an item sold to order, with the most a line may ask for"
    );
  });

  it("fails a source that reports an item sold to order as untracked", async () => {
    const failed = await failingCases(s => {
      const untrack = (
        stock: CatalogueItem["stock"]
      ): CatalogueItem["stock"] =>
        stock.kind === "to-order" ? { kind: "untracked" } : stock;
      return {
        ...s,
        find: async input =>
          (await s.find(input)).map(item => ({
            ...item,
            stock: untrack(item.stock),
          })),
        price: async input =>
          (await s.price(input)).map(line =>
            line.found ? { ...line, stock: untrack(line.stock) } : line
          ),
      };
    });
    expect(failed).toContain(
      "reports an item sold to order, with the most a line may ask for"
    );
  });

  it("fails a source that applies a repeated hold and a repeated release twice", async () => {
    // Its own figure moves with every delivery, so a doubled hold and a doubled
    // release still cancel out: only a look after each repeat can catch it.
    const failed = await failingCases(s => {
      const stock = s.stock;
      if (!stock) return s;
      const moved = new Map<string, number>();
      return {
        ...s,
        find: async input =>
          (await s.find(input)).map(item =>
            item.stock.kind === "counted"
              ? {
                  ...item,
                  stock: {
                    kind: "counted" as const,
                    available:
                      item.stock.available + (moved.get(item.reference) ?? 0),
                  },
                }
              : item
          ),
        stock: {
          report: async input => {
            const step =
              input.kind === "hold"
                ? -input.quantity
                : input.kind === "release"
                  ? input.quantity
                  : 0;
            moved.set(
              input.reference,
              (moved.get(input.reference) ?? 0) + step
            );
            return stock.report(input);
          },
          confirm: input => stock.confirm(input),
        },
      };
    });
    expect(failed).toContain(
      "records a hold and its release once each when their answers are lost and they are repeated"
    );
  });

  it("fails a source that quotes a negative price", async () => {
    const failed = await failingCases(s => ({
      ...s,
      price: async input =>
        (await s.price(input)).map(line =>
          line.found && line.price.kind === "listed"
            ? {
                ...line,
                price: {
                  kind: "listed" as const,
                  unitPrice: money(-line.price.unitPrice.amount, "USD"),
                },
              }
            : line
        ),
    }));
    expect(failed).toContain(
      "prices lines for checkout, one answer per line in the order asked"
    );
  });

  it("fails a source that drops every release report", async () => {
    const failed = await failingCases(s => {
      const stock = s.stock;
      if (!stock) return s;
      const dropped = new Set<string>();
      return {
        ...s,
        stock: {
          report: async input => {
            if (input.kind === "release") {
              dropped.add(input.operationId);
              return;
            }
            return stock.report(input);
          },
          confirm: async input =>
            dropped.has(input.operationId)
              ? { recorded: false }
              : stock.confirm(input),
        },
      };
    });
    expect(failed).toContain(
      "records a hold and its release once each when their answers are lost and they are repeated"
    );
  });

  it("fails a source that refuses a repeated hold as a reused key", async () => {
    const failed = await failingCases(s => {
      const stock = s.stock;
      if (!stock) return s;
      const holds = new Set<string>();
      return {
        ...s,
        stock: {
          report: async input => {
            if (input.kind === "hold") {
              if (holds.has(input.operationId)) {
                throw commerceError("COMMERCE_OPERATION_KEY_REUSED");
              }
              holds.add(input.operationId);
            }
            return stock.report(input);
          },
          confirm: input => stock.confirm(input),
        },
      };
    });
    expect(failed).toContain(
      "records a hold and its release once each when their answers are lost and they are repeated"
    );
  });

  it("fails a source whose listing cursor goes round in a loop", async () => {
    const failed = await failingCases(s => ({
      ...s,
      list: async () => ({ items: [], nextCursor: "again" }),
    }));
    expect(failed).toContain("lists every item a page at a time, each once");
  });

  it("fails a source whose listing hands out empty pages without end", async () => {
    let n = 0;
    const failed = await failingCases(s => ({
      ...s,
      list: async () => ({ items: [], nextCursor: String(++n) }),
    }));
    expect(failed).toContain("lists every item a page at a time, each once");
  });

  it("fails a source whose listing leaves items out", async () => {
    const failed = await failingCases(s => ({
      ...s,
      list: async () => ({
        items: await s.find({ references: ["drill-press"] }),
        nextCursor: null,
      }),
    }));
    expect(failed).toContain("lists every item a page at a time, each once");
  });

  it("passes every case for the unbroken source, so the failures above are the breaks", async () => {
    expect(await failingCases(s => s)).toEqual([]);
  });
});
