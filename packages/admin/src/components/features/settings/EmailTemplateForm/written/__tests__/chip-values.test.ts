/**
 * A chip is marked when it would show nothing with the test data: no value
 * (absent, null or an empty string, never false or 0) and no fallback.
 */
import { describe, expect, it } from "vitest";

import { chipShowsBlank } from "../chip-values";

const data = {
  customer: { firstName: "Ada", nickname: "", middle: null },
  vip: false,
  count: 0,
  order: {
    lines: [
      { title: "Lamp", note: "Gift" },
      { title: "Shade", note: "" },
    ],
    none: [],
  },
};

describe("whether a chip shows blank", () => {
  it("is blank with no value: absent, null or an empty string", () => {
    expect(chipShowsBlank({ variable: "customer.lastName" }, data)).toBe(true);
    expect(chipShowsBlank({ variable: "customer.middle" }, data)).toBe(true);
    expect(chipShowsBlank({ variable: "customer.nickname" }, data)).toBe(true);
    expect(chipShowsBlank({ variable: "nobody.at.all" }, data)).toBe(true);
  });

  it("shows false and 0, which are values", () => {
    expect(chipShowsBlank({ variable: "vip" }, data)).toBe(false);
    expect(chipShowsBlank({ variable: "count" }, data)).toBe(false);
    expect(chipShowsBlank({ variable: "customer.firstName" }, data)).toBe(
      false
    );
  });

  it("is never blank with a fallback, and an empty fallback is none", () => {
    expect(
      chipShowsBlank({ variable: "customer.lastName", fallback: "there" }, data)
    ).toBe(false);
    expect(
      chipShowsBlank({ variable: "customer.lastName", fallback: "" }, data)
    ).toBe(true);
  });

  it("reads `item` in a list as each item, blank when any lacks it", () => {
    expect(
      chipShowsBlank({ variable: "item.title" }, data, "order.lines")
    ).toBe(false);
    expect(chipShowsBlank({ variable: "item.note" }, data, "order.lines")).toBe(
      true
    );
    // No items to read at all.
    expect(chipShowsBlank({ variable: "item.title" }, data, "order.none")).toBe(
      true
    );
  });

  it("reads `item` as a variable outside a list", () => {
    expect(chipShowsBlank({ variable: "item.title" }, data)).toBe(true);
    expect(chipShowsBlank({ variable: "item" }, { item: "x" })).toBe(false);
  });
});
