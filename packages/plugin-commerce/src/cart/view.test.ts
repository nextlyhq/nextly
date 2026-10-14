import { describe, expect, it } from "vitest";

import type { CatalogueItem } from "../contracts/catalogue-source";
import { money } from "../money/money";

import { buildCartView, emptyCartView, type StoredCartLine } from "./view";

const expiresAt = new Date("2026-11-13T05:00:00.000Z");

function line(
  reference: string,
  quantity: number,
  seen: number
): StoredCartLine {
  return {
    reference,
    quantity,
    seenUnitPriceAmount: seen,
    seenUnitPriceCurrency: "USD",
  };
}

function listed(
  reference: string,
  amount: number,
  stock: CatalogueItem["stock"]
): CatalogueItem {
  return {
    reference,
    name: `Item ${reference}`,
    sku: `SKU-${reference}`,
    price: { kind: "listed", unitPrice: money(amount, "USD") },
    stock,
  };
}

function viewOf(lines: StoredCartLine[], items: CatalogueItem[]) {
  return buildCartView({
    currency: "USD",
    expiresAt,
    lines,
    items: new Map(items.map(i => [i.reference, i])),
  });
}

describe("the cart view", () => {
  it("prices each line from the source now, and totals the lines with a price", () => {
    const view = viewOf(
      [line("a", 2, 1_000), line("b", 1, 500)],
      [
        listed("a", 1_000, { kind: "counted", available: 7 }),
        listed("b", 500, { kind: "untracked" }),
      ]
    );
    expect(view.lines.map(l => l.lineTotal)).toEqual([
      money(2_000, "USD"),
      money(500, "USD"),
    ]);
    expect(view.subtotal).toEqual(money(2_500, "USD"));
    expect(view.itemCount).toBe(3);
    expect(view.expiresAt).toBe("2026-11-13T05:00:00.000Z");
  });

  it("shows the price now, and says when it differs from the one shown before", () => {
    const [changed] = viewOf(
      [line("a", 3, 1_000)],
      [listed("a", 1_200, { kind: "counted", available: 7 })]
    ).lines;
    expect(changed?.unitPrice).toEqual(money(1_200, "USD"));
    expect(changed?.seenUnitPrice).toEqual(money(1_000, "USD"));
    expect(changed?.priceChanged).toBe(true);
    expect(changed?.lineTotal).toEqual(money(3_600, "USD"));

    const [same] = viewOf(
      [line("a", 1, 1_000)],
      [listed("a", 1_000, { kind: "counted", available: 7 })]
    ).lines;
    expect(same?.priceChanged).toBe(false);
  });

  it("keeps a line the source no longer knows, unpriced and out of the total", () => {
    const view = viewOf(
      [line("gone", 1, 900), line("a", 1, 100)],
      [listed("a", 100, { kind: "untracked" })]
    );
    expect(view.lines[0]).toMatchObject({
      reference: "gone",
      name: null,
      sku: null,
      unitPrice: null,
      priceChanged: false,
      lineTotal: null,
      availability: { kind: "not-found" },
    });
    expect(view.subtotal).toEqual(money(100, "USD"));
  });

  it("says what each kind of stock can be bought as", () => {
    const view = viewOf(
      [
        line("counted", 1, 100),
        line("none-left", 1, 100),
        line("untracked", 1, 100),
        line("one-off", 1, 100),
        line("sold-one-off", 1, 100),
        line("bench", 4, 100),
        line("rig", 1, 100),
      ],
      [
        listed("counted", 100, { kind: "counted", available: 3 }),
        listed("none-left", 100, { kind: "counted", available: 0 }),
        listed("untracked", 100, { kind: "untracked" }),
        listed("one-off", 100, { kind: "one-off", available: 1 }),
        listed("sold-one-off", 100, { kind: "one-off", available: 0 }),
        listed("bench", 100, { kind: "to-order", maxPerLine: 99 }),
        {
          reference: "rig",
          name: "Rig",
          price: { kind: "on-request" },
          stock: { kind: "untracked" },
        },
      ]
    );
    expect(view.lines.map(l => l.availability)).toEqual([
      { kind: "in-stock", available: 3 },
      { kind: "sold-out" },
      { kind: "in-stock", available: null },
      { kind: "in-stock", available: 1 },
      { kind: "sold-out" },
      { kind: "to-order", maxPerLine: 99 },
      { kind: "price-on-request" },
    ]);
    expect(view.lines.at(-1)?.lineTotal).toBeNull();
  });

  it("holds exactly its declared fields, whatever the source's item carries", () => {
    const [only] = viewOf(
      [line("a", 1, 100)],
      [listed("a", 100, { kind: "untracked" })]
    ).lines;
    expect(Object.keys(only ?? {}).sort()).toEqual([
      "availability",
      "lineTotal",
      "name",
      "priceChanged",
      "quantity",
      "reference",
      "seenUnitPrice",
      "sku",
      "unitPrice",
    ]);
  });

  it("is empty, with no deadline, for a shopper with no cart yet", () => {
    expect(emptyCartView("USD")).toEqual({
      currency: "USD",
      lines: [],
      itemCount: 0,
      subtotal: money(0, "USD"),
      expiresAt: null,
    });
  });
});
