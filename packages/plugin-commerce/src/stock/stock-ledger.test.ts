import { describe, expect, it } from "vitest";

import type { CatalogueItem } from "../contracts/catalogue-source";
import { money } from "../money/money";

import {
  availableStock,
  availableUnits,
  type StockRecord,
} from "./stock-ledger";

function record(onHand: number | null, held: number): StockRecord {
  return { id: "s1", onHand, held, version: 0 };
}

function item(reference: string, stock: CatalogueItem["stock"]): CatalogueItem {
  return {
    reference,
    name: reference,
    price: { kind: "listed", unitPrice: money(100, "USD") },
    stock,
  };
}

describe("the units of an item that can be bought now", () => {
  it("is the source's figure while commerce holds nothing of the item", () => {
    expect(availableUnits(4, undefined)).toBe(4);
  });

  it("takes every active hold off the source's figure until commerce keeps its own", () => {
    expect(availableUnits(4, record(null, 3))).toBe(1);
  });

  it("starts from commerce's own on-hand figure once it keeps one", () => {
    // The source says 4, commerce counted 10 and holds 3.
    expect(availableUnits(4, record(10, 3))).toBe(7);
  });

  it("is never less than none", () => {
    expect(availableUnits(2, record(null, 5))).toBe(0);
    expect(availableUnits(9, record(1, 4))).toBe(0);
  });
});

describe("the stock a shopper sees, by kind", () => {
  const items = new Map(
    [
      item("drill", { kind: "counted", available: 4 }),
      item("lathe", { kind: "one-off", available: 1 }),
      item("bolt", { kind: "untracked" }),
      item("bench", { kind: "to-order", maxPerLine: 9 }),
    ].map(i => [i.reference, i])
  );

  it("counts a counted item and a one-off unit down by their holds", () => {
    const seen = availableStock(
      items,
      new Map([
        ["drill", record(null, 1)],
        ["lathe", record(null, 1)],
      ])
    );
    expect(seen.get("drill")?.stock).toEqual({ kind: "counted", available: 3 });
    expect(seen.get("lathe")?.stock).toEqual({ kind: "one-off", available: 0 });
  });

  it("never shows a one-off item as more than one unit", () => {
    const seen = availableStock(items, new Map([["lathe", record(5, 0)]]));
    expect(seen.get("lathe")?.stock).toEqual({ kind: "one-off", available: 1 });
  });

  it("leaves an untracked item and one sold to order as the source gave them", () => {
    const seen = availableStock(
      items,
      new Map([
        ["bolt", record(0, 3)],
        ["bench", record(0, 3)],
      ])
    );
    expect(seen.get("bolt")?.stock).toEqual({ kind: "untracked" });
    expect(seen.get("bench")?.stock).toEqual({
      kind: "to-order",
      maxPerLine: 9,
    });
  });

  it("leaves an item without a record at the source's figure", () => {
    const seen = availableStock(items, new Map());
    expect(seen.get("drill")?.stock).toEqual({ kind: "counted", available: 4 });
    expect(seen.get("lathe")?.stock).toEqual({ kind: "one-off", available: 1 });
  });
});
