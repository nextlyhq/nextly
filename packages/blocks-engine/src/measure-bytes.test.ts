import { describe, expect, it } from "vitest";

import { measureBytes } from "./measure-bytes";

/**
 * The counter's whole purpose is to answer the question `JSON.stringify` would
 * answer without building the string. So the test is that agreement, asserted
 * byte for byte rather than approximately: a counter that is merely close is a
 * counter that accepts documents over the cap, and the cap is the only thing
 * between a hostile document and an unbounded allocation.
 */
function pageWith(props: Record<string, unknown>) {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [{ id: "a", type: "core/text", version: 1, props }],
  };
}

function realBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

describe("measureBytes", () => {
  it("counts exactly what JSON.stringify emits", () => {
    const cases: Array<[string, unknown]> = [
      ["empty props", pageWith({})],
      ["one prop", pageWith({ a: 1 })],
      ["two props, so a separating comma exists", pageWith({ a: 1, b: 2 })],
      ["nested objects", pageWith({ a: { b: { c: "d" } } })],
      ["arrays of objects", pageWith({ a: [{ b: 1 }, { c: 2 }, {}] })],
      ["mixed scalars", pageWith({ a: null, b: true, c: 1.5, d: "x" })],
      ["escapes", pageWith({ a: 'quote " backslash \\ newline \n tab \t' })],
      ["control characters", pageWith({ a: "" })],
      ["multibyte", pageWith({ a: "héllo — 世界 \u{1f389}" })],
      ["keys needing escapes", pageWith({ 'a"b': 1, "c\\d": 2 })],
    ];

    for (const [label, value] of cases) {
      expect(measureBytes(value, Number.MAX_SAFE_INTEGER).bytes, label).toBe(
        realBytes(value)
      );
    }
  });

  it("counts the comma between every pair of properties", () => {
    // The case the omission hid behind: one byte per property is invisible on a
    // small document and decides the verdict on a large one. At 170,000 empty
    // props the real size is over the 2 MiB cap while an undercounting measure
    // reported it comfortably under, so the document was accepted.
    const props: Record<string, string> = {};
    for (let index = 0; index < 170_000; index += 1) props[`k${index}`] = "";
    const document = pageWith(props);

    const real = realBytes(document);
    expect(real).toBeGreaterThan(2 * 1024 * 1024);
    expect(measureBytes(document, Number.MAX_SAFE_INTEGER).bytes).toBe(real);
    expect(measureBytes(document, 2 * 1024 * 1024).exceeded).toBe(true);
  });

  it("stops at the limit instead of measuring the whole input", () => {
    // A lower bound is all `bytes` promises once `exceeded` is set; what
    // matters is that it stopped, which is the property the cap buys.
    const huge = pageWith({ a: "x".repeat(5_000_000) });
    const result = measureBytes(huge, 1024);
    expect(result.exceeded).toBe(true);
    expect(result.bytes).toBeLessThan(5_000_000);
  });

  it("terminates on a cycle rather than throwing", () => {
    // `JSON.stringify` throws here. The counter is a precondition for parsing
    // untrusted input, so it has to report rather than crash the caller.
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(() => measureBytes(pageWith(cyclic), 1024)).not.toThrow();
    expect(measureBytes(pageWith(cyclic), 1024).exceeded).toBe(true);
  });

  it("reads property values one at a time, not all at once", () => {
    // The reason the walk uses `for...in` with an indexed read rather than
    // `Object.entries`: the latter builds the complete array of key/value pairs
    // before the loop can compare even the first key against the limit, so an
    // object with hundreds of thousands of keys forces exactly the allocation
    // this counter exists to avoid.
    //
    // Allocation is not observable from a test, but the READ is: a getter fires
    // when its value is taken. `Object.entries` takes every value up front, so
    // it would fire all of them regardless of the limit; a lazy walk stops
    // early. This is the assertion that separates the two — the correctness
    // tests above pass under either.
    let reads = 0;
    const wide: Record<string, unknown> = {};
    for (let index = 0; index < 5_000; index += 1) {
      Object.defineProperty(wide, `key${index}`, {
        enumerable: true,
        get() {
          reads += 1;
          return "x".repeat(100);
        },
      });
    }

    const result = measureBytes(wide, 2_000);
    expect(result.exceeded).toBe(true);
    // Measured at 210 — bounded by how many keys fit in the 2,000-byte limit,
    // not by the object's 5,000. An eager pass reads all 5,000 whatever the
    // limit is, which is the difference this asserts.
    expect(reads).toBeLessThan(500);
  });

  it("stops reading values once the limit is crossed by value bytes", () => {
    // The companion to the test above, and the one that separates lazy KEYS
    // from lazy VALUES. That test crosses the limit on key bytes alone, so it
    // passes for an implementation that stacks every value before measuring
    // any — which is eager in exactly the half that allocates.
    //
    // Here the keys are negligible and the values are large, so the limit can
    // only be reached by reading them. An implementation that collects values
    // first runs all 1,000 accessors and holds ~100 MB before consulting the
    // cap; one that measures as it goes stops after about twenty.
    let reads = 0;
    const wide: Record<string, unknown> = {};
    for (let index = 0; index < 1_000; index += 1) {
      Object.defineProperty(wide, `k${index}`, {
        enumerable: true,
        get() {
          reads += 1;
          return "x".repeat(100_000);
        },
      });
    }

    const result = measureBytes(wide, 2 * 1024 * 1024);
    expect(result.exceeded).toBe(true);
    // 2 MiB / 100 KB is about 21 values. Bounded by the LIMIT rather than by
    // the object, which is the property; the margin allows for counting order.
    expect(reads).toBeLessThan(60);
  });

  it("counts own properties only", () => {
    // The walk uses `for...in`, which reaches the prototype chain. An inherited
    // property is not serialized, so counting one would overstate the size and
    // could refuse a document that fits.
    const parent = { inherited: "x".repeat(1000) };
    const child = Object.create(parent) as Record<string, unknown>;
    child.own = 1;
    expect(measureBytes(child, Number.MAX_SAFE_INTEGER).bytes).toBe(
      realBytes(child)
    );
  });
});
