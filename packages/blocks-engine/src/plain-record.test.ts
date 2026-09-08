/**
 * The two readings of "is this a record", and the relationship between them.
 *
 * @module plain-record.test
 */
import { describe, expect, it } from "vitest";

import { definitelyNotARecord, isPlainRecord } from "./plain-record";

/**
 * Every root shape either reading has an opinion about.
 *
 * One table, shared, so the property below is asserted over the same
 * population both functions are asked about — a second list per test would let
 * a shape be added to one and not the other, which is the drift the property
 * exists to catch.
 */
function roots(): { name: string; value: unknown }[] {
  const { proxy, revoke } = Proxy.revocable({} as Record<string, unknown>, {});
  revoke();
  return [
    { name: "null", value: null },
    { name: "undefined", value: undefined },
    { name: "a number", value: 7 },
    { name: "a string", value: "{}" },
    { name: "a boolean", value: false },
    { name: "a symbol", value: Symbol("root") },
    { name: "a function", value: () => undefined },
    { name: "an array", value: [] },
    { name: "an object literal", value: {} },
    { name: "a null-prototype object", value: Object.create(null) },
    { name: "a Date", value: new Date() },
    { name: "a Map", value: new Map() },
    { name: "a class instance", value: new (class {})() },
    { name: "a revoked proxy", value: proxy },
  ];
}

describe("the throw-free reading never accepts what the full one refuses", () => {
  it.each(roots())("holds for $name", ({ value }) => {
    // The property that makes two readings of one question safe: refusing early
    // can only ever agree with refusing late. A reading that answered `true`
    // for something `isPlainRecord` accepts would refuse a valid document
    // before the caller's settings were even read.
    if (!definitelyNotARecord(value)) return;

    let full: boolean;
    try {
      full = isPlainRecord(value);
    } catch {
      // A value whose prototype cannot be read is not one the full reading
      // accepts either, which is what the property claims.
      return;
    }
    expect(full).toBe(false);
  });

  it("is not vacuous: the table contains values it refuses AND values it does not", () => {
    // Without this the property above passes on a table of nothing but records,
    // and on an implementation that answers `false` to everything.
    const refused = roots().filter(root => definitelyNotARecord(root.value));
    const undecided = roots().filter(root => !definitelyNotARecord(root.value));

    expect(refused.length).toBeGreaterThan(0);
    expect(undecided.length).toBeGreaterThan(0);
  });
});

describe("the throw-free reading answers where the full one throws", () => {
  it("declines to refuse a revoked proxy rather than throwing", () => {
    const { proxy, revoke } = Proxy.revocable(
      {} as Record<string, unknown>,
      {}
    );
    revoke();

    // It cannot say, so it does not refuse — and the caller's later, fuller
    // reading is what decides. The control is the full reading on the same
    // value, which throws.
    expect(definitelyNotARecord(proxy)).toBe(false);
    expect(() => isPlainRecord(proxy)).toThrow(TypeError);
  });

  it("declines to refuse an object whose prototype trap throws", () => {
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("the prototype is not for reading");
        },
      }
    );

    expect(definitelyNotARecord(hostile)).toBe(false);
    expect(() => isPlainRecord(hostile)).toThrow();
  });
});
