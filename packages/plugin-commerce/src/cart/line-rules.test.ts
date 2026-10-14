import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import type { CatalogueItem } from "../contracts/catalogue-source";
import { money } from "../money/money";

import { allowLine, MAX_LINE_QUANTITY, maxLineQuantity } from "./line-rules";

function codeOf(body: () => unknown): string | undefined {
  try {
    body();
  } catch (error) {
    return NextlyError.is(error) ? String(error.code) : "not a NextlyError";
  }
  return undefined;
}

function item(stock: CatalogueItem["stock"]): CatalogueItem {
  return {
    reference: "drill",
    name: "Drill",
    price: { kind: "listed", unitPrice: money(12_900, "USD") },
    stock,
  };
}

describe("how many units a line may hold", () => {
  it("holds a one-off item to one unit", () => {
    expect(maxLineQuantity(item({ kind: "one-off", available: 1 }))).toBe(1);
  });

  it("holds an item sold to order to the source's own limit", () => {
    expect(maxLineQuantity(item({ kind: "to-order", maxPerLine: 99 }))).toBe(
      99
    );
  });

  it("never lets a source's limit take a line past the cart's own", () => {
    expect(
      maxLineQuantity(item({ kind: "to-order", maxPerLine: 1_000_000 }))
    ).toBe(MAX_LINE_QUANTITY);
  });

  it("leaves a counted item's stock to checkout, which holds it", () => {
    expect(maxLineQuantity(item({ kind: "counted", available: 2 }))).toBe(
      MAX_LINE_QUANTITY
    );
    expect(maxLineQuantity(item({ kind: "untracked" }))).toBe(
      MAX_LINE_QUANTITY
    );
  });
});

describe("which lines a cart refuses", () => {
  it("answers the listed unit price for a line it accepts", () => {
    expect(
      allowLine("drill", item({ kind: "counted", available: 2 }), 5)
    ).toEqual(money(12_900, "USD"));
  });

  it("refuses an item the source does not know", () => {
    expect(codeOf(() => allowLine("drill", undefined, 1))).toBe(
      "COMMERCE_ITEM_NOT_FOUND"
    );
  });

  it("refuses an item whose price is given on request", () => {
    const rig: CatalogueItem = {
      reference: "rig",
      name: "Rig",
      price: { kind: "on-request" },
      stock: { kind: "untracked" },
    };
    expect(codeOf(() => allowLine("rig", rig, 1))).toBe(
      "COMMERCE_PRICE_ON_REQUEST"
    );
  });

  it("refuses more units than the item allows, and accepts exactly that many", () => {
    const bench = item({ kind: "to-order", maxPerLine: 99 });
    expect(allowLine("drill", bench, 99)).toEqual(money(12_900, "USD"));
    expect(codeOf(() => allowLine("drill", bench, 100))).toBe(
      "COMMERCE_QUANTITY_NOT_ALLOWED"
    );
    expect(
      codeOf(() =>
        allowLine("drill", item({ kind: "one-off", available: 1 }), 2)
      )
    ).toBe("COMMERCE_QUANTITY_NOT_ALLOWED");
  });
});
