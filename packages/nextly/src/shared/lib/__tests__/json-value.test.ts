/**
 * What counts as JSON that reads back unchanged.
 */
import { describe, expect, it } from "vitest";

import { isJsonValue } from "../json-value";

describe("isJsonValue", () => {
  it.each([
    ["a string", "text"],
    ["a finite number", 1.5],
    ["a boolean", false],
    ["null", null],
    ["nested arrays and plain objects", { a: [1, { b: "c" }], d: null }],
    [
      "an object with no prototype",
      Object.assign(Object.create(null), { a: 1 }),
    ],
  ])("accepts %s", (_case, value) => {
    expect(isJsonValue(value)).toBe(true);
  });

  it.each([
    ["undefined", undefined],
    ["a non-finite number", Number.POSITIVE_INFINITY],
    ["NaN", Number.NaN],
    ["a bigint", 1n],
    ["a function", () => 1],
    ["a date", new Date()],
    ["a map", new Map()],
    ["a nested class instance", { at: new Date() }],
    ["an undefined property", { a: undefined }],
    ["undefined in an array", [1, undefined]],
    [
      "a class instance",
      new (class Point {
        x = 1;
      })(),
    ],
    [
      "a getter",
      Object.defineProperty({}, "computed", { enumerable: true, get: () => 1 }),
    ],
    ["an array with a named property", Object.assign([1], { note: "kept" })],
    ["a symbol key", { [Symbol("s")]: 1 }],
    [
      "a property JSON does not write",
      Object.defineProperty({}, "hidden", { enumerable: false, value: 1 }),
    ],
    ["negative zero", -0],
    [
      "a hidden toJSON",
      Object.defineProperty({ a: 1 }, "toJSON", {
        enumerable: false,
        value: () => "replaced",
      }),
    ],
    ["a nested bigint", { n: [1n] }],
  ])("refuses %s", (_case, value) => {
    expect(isJsonValue(value)).toBe(false);
  });

  it("refuses an array with a hole, which JSON writes as null", () => {
    const holed: unknown[] = [];
    holed.length = 1;
    expect(isJsonValue(holed)).toBe(false);
    expect(isJsonValue({ list: holed })).toBe(false);
  });

  it("refuses a value that contains itself, rather than recursing forever", () => {
    const cycle: Record<string, unknown> = { a: 1 };
    cycle.self = cycle;
    expect(isJsonValue(cycle)).toBe(false);
  });

  it("accepts one object reached twice, which is not a cycle", () => {
    const shared = { a: 1 };
    expect(isJsonValue({ first: shared, second: [shared] })).toBe(true);
  });
});
