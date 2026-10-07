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
});
