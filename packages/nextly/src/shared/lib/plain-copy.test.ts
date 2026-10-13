import { describe, expect, it } from "vitest";

import { copyPlainValues } from "./plain-copy";

describe("copyPlainValues", () => {
  it("rebuilds plain containers and keeps functions and instances", () => {
    const hook = () => undefined;
    const when = new Date(0);
    const source = { list: [{ hook }], when };

    const copy = copyPlainValues(source);

    expect(copy).not.toBe(source);
    expect(copy.list).not.toBe(source.list);
    expect(copy.list[0]).not.toBe(source.list[0]);
    expect(copy.list[0].hook).toBe(hook);
    expect(copy.when).toBe(when);
  });

  it("freezes every container it builds when asked", () => {
    const copy = copyPlainValues({ a: { b: [1] } }, { freeze: true });

    expect(Object.isFrozen(copy)).toBe(true);
    expect(Object.isFrozen(copy.a)).toBe(true);
    expect(Object.isFrozen(copy.a.b)).toBe(true);
  });

  it("reads an accessor once and holds the value it returned", () => {
    let reads = 0;
    const source = {
      get flag() {
        reads += 1;
        return reads > 1;
      },
    };

    const copy = copyPlainValues(source);

    expect(copy.flag).toBe(false);
    expect(copy.flag).toBe(false);
    expect(reads).toBe(1);
  });

  it("copies shared and cyclic structure once", () => {
    const shared: Record<string, unknown> = { n: 1 };
    shared.self = shared;

    const copy = copyPlainValues({ a: shared, b: shared });

    expect(copy.a).toBe(copy.b);
    expect(copy.a.self).toBe(copy.a);
    expect(copy.a).not.toBe(shared);
  });

  describe("symbol-keyed properties", () => {
    // `Symbol.for`, as the field brands are, so the test exercises a key of
    // the kind those brands use.
    const brand = Symbol.for("nextly.plain-copy-test.brand");

    it.each([false, true])(
      "keeps an enumerable symbol key (freeze: %s)",
      freeze => {
        const source = { name: "score", [brand]: true as const };

        const copy = copyPlainValues(source, { freeze });

        expect(copy).not.toBe(source);
        expect(Object.getOwnPropertySymbols(copy)).toEqual([brand]);
        expect(copy[brand]).toBe(true);
        expect(Object.isFrozen(copy)).toBe(freeze);
      }
    );

    it("leaves a non-enumerable symbol key out, as with a string key", () => {
      const hidden = Symbol("hidden");
      const source: Record<string, unknown> = { name: "score" };
      Object.defineProperty(source, hidden, { value: 1, enumerable: false });
      Object.defineProperty(source, "secret", { value: 2, enumerable: false });

      const copy = copyPlainValues(source);

      expect(Object.getOwnPropertySymbols(copy)).toEqual([]);
      expect(Object.getOwnPropertyNames(copy)).toEqual(["name"]);
    });

    it("copies a plain value under a symbol key rather than sharing it", () => {
      const nested = { list: [1] };
      const source = { [brand]: nested };

      const copy = copyPlainValues(source, { freeze: true });

      expect(copy[brand]).toEqual({ list: [1] });
      expect(copy[brand]).not.toBe(nested);
      expect(copy[brand].list).not.toBe(nested.list);
      expect(Object.isFrozen(copy[brand])).toBe(true);
      expect(Object.isFrozen(copy[brand].list)).toBe(true);
    });

    it("reads a symbol-keyed accessor once", () => {
      let reads = 0;
      const source = {
        get [brand]() {
          reads += 1;
          return reads;
        },
      };

      const copy = copyPlainValues(source);

      expect(copy[brand]).toBe(1);
      expect(copy[brand]).toBe(1);
      expect(reads).toBe(1);
    });
  });
});
