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
      catalogue: items.map(item => item.reference),
      search: { query: "drill", finds: "drill-press", skips: "custom-rig" },
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

describe("the catalogue contract suite's search option", () => {
  it("refuses a source that lists but names no search to narrow it by", async () => {
    // Without one, a source that ignores the search passes: nothing asks.
    await expect(
      catalogueSourceContract({
        currency: "USD",
        fixtures: {
          listed: "drill-press",
          unknown: "no-such-item",
          soldFrom: "drill-press",
        },
        create: () =>
          createInMemoryCatalogueSource({ currency: "USD", items }).source,
      })
    ).rejects.toBeInstanceOf(ContractViolation);
  });
});

describe("the catalogue contract suite's whole-catalogue option", () => {
  it("names the listing case for the named fixtures when no whole catalogue is given", async () => {
    // Without the whole catalogue, the case can only check the fixtures it
    // names, so it says that rather than claiming every item.
    const cases = await catalogueSourceContract({
      currency: "USD",
      fixtures: {
        listed: "drill-press",
        unknown: "no-such-item",
        soldFrom: "drill-press",
        search: { query: "drill", finds: "drill-press", skips: "custom-rig" },
      },
      create: () =>
        createInMemoryCatalogueSource({ currency: "USD", items }).source,
    });
    const names = cases.map(c => c.name);
    expect(names).toContain(
      "lists the named fixtures a page at a time, each once"
    );
    expect(names).not.toContain("lists every item a page at a time, each once");
  });

  it("fails a source that leaves its item sold to order out of the listing, when only the fixtures are named", async () => {
    const run = await runContractCases(
      await catalogueSourceContract({
        currency: "USD",
        fixtures: {
          listed: "drill-press",
          onRequest: "custom-rig",
          unknown: "no-such-item",
          soldFrom: "drill-press",
          toOrder: { reference: "made-to-order-bench", maxPerLine: 99 },
          search: { query: "drill", finds: "drill-press", skips: "custom-rig" },
        },
        create: () => {
          const source = createInMemoryCatalogueSource({
            currency: "USD",
            items,
          }).source;
          const list = source.list?.bind(source);
          if (!list) throw new Error("the in-memory source lists");
          // Finds and prices the item sold to order, but never lists it.
          return {
            ...source,
            list: async input => {
              const page = await list(input);
              return {
                ...page,
                items: page.items.filter(i => i.stock.kind !== "to-order"),
              };
            },
          };
        },
      })
    );
    expect(run.failed.map(f => [f.name, String(f.error)])).toEqual([
      [
        "lists the named fixtures a page at a time, each once",
        expect.stringContaining("the listing includes made-to-order-bench"),
      ],
    ]);
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
        catalogue: [...items, ...many].map(item => item.reference),
        search: { query: "drill", finds: "drill-press", skips: "custom-rig" },
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

  it("fails a source that answers one line per reference", async () => {
    // Two lines for one reference are two lines to checkout, each with its
    // own quantity, and each must be answered in its place.
    const failed = await failingCases(s => ({
      ...s,
      price: input => {
        const seen = new Set<string>();
        return s.price({
          ...input,
          lines: input.lines.filter(line => {
            const first = !seen.has(line.reference);
            seen.add(line.reference);
            return first;
          }),
        });
      },
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

  it("fails a source that applies a repeated sale twice, even watching an item with one unit", async () => {
    // With one unit, a sale applied twice stops at zero just as one sale
    // does, so the suite must watch an item holding at least two.
    const breakIt = (s: CatalogueSource): CatalogueSource => {
      const stock = s.stock;
      if (!stock) return s;
      const seen = new Set<string>();
      return {
        ...s,
        stock: {
          report: async input => {
            const repeat = seen.has(input.operationId);
            seen.add(input.operationId);
            await stock.report(input);
            if (repeat && input.kind === "sale") {
              await stock.report({
                ...input,
                operationId: `${input.operationId}-again`,
              });
            }
          },
          confirm: input => stock.confirm(input),
        },
      };
    };
    const cases = await catalogueSourceContract({
      currency: "USD",
      fixtures: {
        listed: "drill-press",
        onRequest: "custom-rig",
        unknown: "no-such-item",
        soldFrom: "used-lathe",
        search: { query: "drill", finds: "drill-press", skips: "custom-rig" },
      },
      create: () =>
        breakIt(
          createInMemoryCatalogueSource({ currency: "USD", items }).source
        ),
    });
    const run = await runContractCases(cases);
    expect(run.failed.map(f => f.name)).toContain(
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

  it("fails a source whose listing holds only the named fixtures", async () => {
    // Every fixture the suite names is listed; the item none of them names
    // (the used lathe) is not, which only the whole catalogue shows.
    const fixtureReferences = new Set([
      "drill-press",
      "custom-rig",
      "made-to-order-bench",
    ]);
    const failed = await failingCases(s => {
      const list = s.list?.bind(s);
      if (!list) return s;
      return {
        ...s,
        list: async input => {
          const page = await list(input);
          return {
            ...page,
            items: page.items.filter(item =>
              fixtureReferences.has(item.reference)
            ),
          };
        },
      };
    });
    expect(failed).toContain("lists every item a page at a time, each once");
  });

  it("fails a source whose listing ignores the search", async () => {
    const failed = await failingCases(s => {
      const list = s.list?.bind(s);
      if (!list) return s;
      return {
        ...s,
        list: input => list({ limit: input.limit, cursor: input.cursor }),
      };
    });
    expect(failed).toContain(
      "narrows the listing to a search, a page at a time"
    );
  });

  it("passes every case for the unbroken source, so the failures above are the breaks", async () => {
    expect(await failingCases(s => s)).toEqual([]);
  });
});
