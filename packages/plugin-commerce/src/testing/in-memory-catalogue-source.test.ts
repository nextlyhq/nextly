import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import type { CatalogueItem } from "../contracts/catalogue-source";
import { money } from "../money/money";

import { createInMemoryCatalogueSource } from "./in-memory-catalogue-source";

// The parts of the in-memory source the catalogue suite cannot reach: input a
// caller outside the contract sends, and how the source is made.

const items: CatalogueItem[] = [
  {
    reference: "drill-press",
    name: "Drill press",
    price: { kind: "listed", unitPrice: money(129_900, "USD") },
    stock: { kind: "counted", available: 4 },
  },
];

async function codeOf(body: () => unknown): Promise<string | undefined> {
  try {
    await body();
  } catch (error) {
    return NextlyError.is(error) ? String(error.code) : "not a NextlyError";
  }
  return undefined;
}

describe("the in-memory catalogue source", () => {
  it("refuses an id that is not a lower-case slug when it is made", async () => {
    expect(
      await codeOf(() =>
        createInMemoryCatalogueSource({
          id: "Memory Source",
          currency: "USD",
          items,
        })
      )
    ).toBe("COMMERCE_PROVIDER_CONTRACT");
    // The control: a slug is accepted, so the refusal is the id's.
    expect(
      await codeOf(() =>
        createInMemoryCatalogueSource({
          id: "memory-2",
          currency: "USD",
          items,
        })
      )
    ).toBeUndefined();
  });

  it("refuses a list limit that is not a positive whole number", async () => {
    const { source } = createInMemoryCatalogueSource({
      currency: "USD",
      items,
    });
    const list = source.list?.bind(source);
    if (!list) throw new Error("the in-memory source lists");
    for (const limit of [0, -1, 1.5, Number.NaN]) {
      expect(await codeOf(() => list({ limit })), String(limit)).toBe(
        "VALIDATION_ERROR"
      );
    }
    expect((await list({ limit: 1 })).items).toHaveLength(1);
  });

  it("refuses price lines outside the contract before answering", async () => {
    const { source } = createInMemoryCatalogueSource({
      currency: "USD",
      items,
    });
    for (const line of [
      { reference: "drill-press", quantity: 0 },
      { reference: "drill-press", quantity: -2 },
      { reference: "drill-press", quantity: 1.5 },
      { reference: "", quantity: 1 },
    ]) {
      expect(
        await codeOf(() =>
          source.price({
            currency: "USD",
            lines: [{ reference: "drill-press", quantity: 1 }, line],
          })
        ),
        JSON.stringify(line)
      ).toBe("VALIDATION_ERROR");
    }
    const [priced] = await source.price({
      currency: "USD",
      lines: [{ reference: "drill-press", quantity: 1 }],
    });
    expect(priced.found).toBe(true);
  });
});
