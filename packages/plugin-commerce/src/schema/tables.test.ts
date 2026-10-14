/**
 * Rules every commerce table keeps, now and in every later slice: money is a
 * whole number of minor units with its currency beside it, and nothing that
 * could hold a card or bank account number is ever a column.
 *
 * Each rule is run first against a table built to break it, so a pass over
 * commerce's own tables cannot be a rule that finds nothing.
 */
import { col, defineTable } from "@nextlyhq/plugin-sdk/schema";
import { describe, expect, it } from "vitest";

import { COMMERCE_TABLES } from "./tables";

type Table = (typeof COMMERCE_TABLES)[number] | ReturnType<typeof defineTable>;

// A column that names money in any of these words holds an amount, so it must
// be spelt `<what>Amount` for the rules below to see it.
const MONEY_WORDS = /price|total|amount|cost|fee|tax|discount|refund|charge/i;
const FLOATING_KINDS = new Set(["double", "real", "decimal"]);

/** Every way a column breaks the money rule, as readable lines. */
function moneyViolations(table: Table): string[] {
  const byKey = new Map(table.columns.map(column => [column.key, column]));
  return table.columns.flatMap(column => {
    const where = `${table.name}.${column.key}`;
    const found: string[] = [];
    if (FLOATING_KINDS.has(column.kind)) {
      found.push(`${where} is a ${column.kind}, and money is never fractional`);
    }
    if (column.key.endsWith("Amount")) {
      found.push(...amountViolations(table, column, byKey));
    } else if (
      MONEY_WORDS.test(column.key) &&
      !column.key.endsWith("Currency")
    ) {
      found.push(`${where} names money but is not spelt as an amount`);
    }
    return found;
  });
}

type Column = Table["columns"][number];

/** What is wrong with an amount column and the currency that must sit beside it. */
function amountViolations(
  table: Table,
  column: Column,
  byKey: ReadonlyMap<string, Column>
): string[] {
  const where = `${table.name}.${column.key}`;
  const found: string[] = [];
  if (column.kind !== "bigint") {
    found.push(`${where} is a ${column.kind}, not a 64-bit integer`);
  }
  const currencyKey = `${column.key.slice(0, -"Amount".length)}Currency`;
  const currency = byKey.get(currencyKey);
  if (!currency) {
    found.push(`${where} has no ${currencyKey} beside it`);
  } else if (currency.kind !== "char" || currency.length !== 3) {
    found.push(`${table.name}.${currencyKey} is not a three-letter code`);
  } else if (currency.nullable && !column.nullable) {
    found.push(
      `${table.name}.${currencyKey} may be empty where its amount may not`
    );
  }
  return found;
}

// Word sequences in a snake_case column name that mean a card or bank account
// number, or a code that unlocks one. A card's brand and last four digits are
// not among them: those identify a payment without being able to make one.
const FORBIDDEN = [
  ["card", "number"],
  ["pan"],
  ["cvv"],
  ["cvv2"],
  ["cvc"],
  ["security", "code"],
  ["iban"],
  ["account", "number"],
  ["bank", "account"],
  ["routing", "number"],
  ["sort", "code"],
];

function cardViolations(table: Table): string[] {
  return table.columns.flatMap(column => {
    const words = column.name.toLowerCase().split("_");
    const hit = FORBIDDEN.find(sequence =>
      words.some((_, start) =>
        sequence.every((word, i) => words[start + i] === word)
      )
    );
    return hit
      ? [`${table.name}.${column.name} could hold ${hit.join(" ")}`]
      : [];
  });
}

// A catalogue reference is compared exactly by the contract, and by MySQL's
// default collation without regard to case or accents, so an index over the
// reference itself would join two items into one on MySQL alone. Indexes go
// over its key instead (`referenceKey`).
//
// A payment's `reference` is not a catalogue's: commerce mints it as `pay_`
// and lower-case hex, which every collation compares exactly, so it is
// indexed as it is.
const OWN_REFERENCES = new Set(["payments"]);

function referenceIndexViolations(table: Table): string[] {
  if (OWN_REFERENCES.has(table.name)) return [];
  return table.indexes.flatMap(index =>
    index.columns.includes("reference")
      ? [`${table.name} indexes reference, not reference_key`]
      : []
  );
}

describe("the reference rule", () => {
  it("finds an index over a catalogue reference itself", () => {
    const broken = defineTable(
      "broken_references",
      { id: col.id(), reference: col.varchar(255) },
      { indexes: [{ columns: ["reference"], unique: true }] }
    );
    expect(referenceIndexViolations(broken)).toEqual([
      "broken_references indexes reference, not reference_key",
    ]);
  });

  it("holds for every commerce table", () => {
    expect(COMMERCE_TABLES.flatMap(referenceIndexViolations)).toEqual([]);
    // The rule has something to check: the cart's lines are indexed by key.
    expect(
      COMMERCE_TABLES.flatMap(t => t.indexes).some(i =>
        i.columns.includes("reference_key")
      )
    ).toBe(true);
  });
});

describe("the money rule", () => {
  it("finds every way a table can hold money wrongly", () => {
    const broken = defineTable("broken_money", {
      id: col.id(),
      totalPrice: col.double(),
      loneAmount: col.bigint(),
      shortAmount: col.integer(),
      shortCurrency: col.char(3),
      wideAmount: col.bigint(),
      wideCurrency: col.varchar(8),
      fee: col.bigint(),
    });
    expect(moneyViolations(broken)).toEqual([
      "broken_money.totalPrice is a double, and money is never fractional",
      "broken_money.totalPrice names money but is not spelt as an amount",
      "broken_money.loneAmount has no loneCurrency beside it",
      "broken_money.shortAmount is a integer, not a 64-bit integer",
      "broken_money.wideCurrency is not a three-letter code",
      "broken_money.fee names money but is not spelt as an amount",
    ]);
  });

  it("holds for every commerce table", () => {
    expect(COMMERCE_TABLES.flatMap(moneyViolations)).toEqual([]);
    // The rule has something to check: the cart's lines hold an amount.
    expect(
      COMMERCE_TABLES.flatMap(t => t.columns).some(c =>
        c.key.endsWith("Amount")
      )
    ).toBe(true);
  });
});

describe("the card rule", () => {
  it("finds a column that could hold a card or bank account number", () => {
    const broken = defineTable("broken_cards", {
      id: col.id(),
      cardNumber: col.varchar(19),
      cvv: col.char(3),
      iban: col.varchar(34),
      bankAccountName: col.text(),
      cardBrand: col.varchar(16),
      cardLastFour: col.char(4),
      accountKind: col.varchar(64),
      company: col.text(),
    });
    expect(cardViolations(broken)).toEqual([
      "broken_cards.card_number could hold card number",
      "broken_cards.cvv could hold cvv",
      "broken_cards.iban could hold iban",
      "broken_cards.bank_account_name could hold bank account",
    ]);
  });

  it("holds for every commerce table", () => {
    expect(COMMERCE_TABLES.flatMap(cardViolations)).toEqual([]);
  });
});
