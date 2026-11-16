/**
 * The row count a widget query asks for, as the server will run it.
 *
 * One rule for both sides: the query validator bounds the limit with it, and
 * the admin reserves a list card's rows with it before any data arrives. A
 * second copy in the browser would reserve 5 rows for a query the server runs
 * at 50 the day the two disagreed.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { validateWidgetQuery } from "../query";
import {
  DEFAULT_WIDGET_LIMIT,
  MAX_WIDGET_LIMIT,
  MAX_WIDGET_ROWS,
  effectiveWidgetLimit,
  listEntries,
} from "../query-limits";
import { clearSources, registerSource } from "../sources";

beforeEach(() => {
  clearSources();
  registerSource({
    id: "collection:posts",
    label: "Posts",
    kind: "collection",
    supports: ["count", "list"],
    fields: [{ name: "title", type: "string" }],
  });
});

describe("effectiveWidgetLimit", () => {
  it("takes the default when no usable limit is declared", () => {
    for (const limit of [undefined, null, "10", Number.NaN, Infinity]) {
      expect(effectiveWidgetLimit(limit)).toBe(DEFAULT_WIDGET_LIMIT);
    }
  });

  it("bounds a declared limit to one and the maximum, in whole rows", () => {
    expect(effectiveWidgetLimit(0)).toBe(1);
    expect(effectiveWidgetLimit(-3)).toBe(1);
    expect(effectiveWidgetLimit(12)).toBe(12);
    expect(effectiveWidgetLimit(12.9)).toBe(12);
    expect(effectiveWidgetLimit(MAX_WIDGET_LIMIT + 30)).toBe(MAX_WIDGET_LIMIT);
  });

  it("is the limit the validator runs a query at", () => {
    // 🔴 The separating case for a second implementation: whatever the
    // validator does to a limit, this answers the same.
    for (const limit of [undefined, 0, 7, 12.9, 500]) {
      const query = validateWidgetQuery({
        source: "collection:posts",
        op: "list",
        ...(limit === undefined ? {} : { limit }),
      });
      expect(query.limit).toBe(effectiveWidgetLimit(limit));
    }
  });
});

describe("listEntries", () => {
  it('is twenty at most: the most a card\'s "Number of entries" offers', () => {
    expect(MAX_WIDGET_ROWS).toBe(20);
  });

  it("is five where the setting is missing or garbage", () => {
    // A numeric string is not a number: read as missing, never as ten.
    for (const limit of [undefined, null, Number.NaN, "10", Infinity, {}]) {
      expect(listEntries(limit)).toBe(5);
    }
  });

  it("is the setting itself from one to twenty", () => {
    expect(listEntries(1)).toBe(1);
    expect(listEntries(7)).toBe(7);
    expect(listEntries(10)).toBe(10);
    expect(listEntries(20)).toBe(20);
  });

  it("is at least one row, for a setting of zero or less", () => {
    expect(listEntries(0)).toBe(1);
    expect(listEntries(-4)).toBe(1);
  });

  it("is twenty for a setting above twenty, though a query may ask up to fifty", () => {
    // 🔴 The separating case against reading the setting by `effectiveWidgetLimit` alone,
    // which answers 25 and 50 here.
    expect(listEntries(25)).toBe(20);
    expect(listEntries(MAX_WIDGET_LIMIT + 30)).toBe(20);
    expect(effectiveWidgetLimit(25)).toBe(25);
  });

  it("counts whole rows, dropping a fraction", () => {
    expect(listEntries(7.8)).toBe(7);
    expect(listEntries(20.5)).toBe(20);
  });
});
