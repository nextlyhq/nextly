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

  it("terminates on a cycle independently of the byte limit", () => {
    // `JSON.stringify` throws here. The walk is a precondition for parsing
    // untrusted input, so it has to report rather than crash the caller.
    //
    // The earlier version terminated because the cycle drove the byte count
    // past the cap, which is termination by accident: a cyclic document of
    // small values under a large cap would have run forever. Termination now
    // comes from the repeated reference itself, so this asserts `unserializable`
    // rather than `exceeded` — and deliberately uses a limit the document never
    // approaches, which the previous implementation could not have survived.
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    const document = pageWith(cyclic);

    expect(() => measureBytes(document, 10_000_000)).not.toThrow();
    const result = measureBytes(document, 10_000_000);
    expect(result.unserializable).toBe(true);
    expect(result.exceeded).toBe(false);
  });

  it("counts a repeated subtree once per occurrence", () => {
    // A shared reference is legal JSON: the serializer DUPLICATES the subtree.
    // Counting it once undercounts by exactly the copy storage will add, which
    // is how a document over the cap can measure under it.
    const shared = { text: "x".repeat(1000) };
    const document = pageWith({ a: shared, b: shared });

    expect(measureBytes(document, Number.MAX_SAFE_INTEGER).bytes).toBe(
      realBytes(document)
    );
    expect(measureBytes(document, Number.MAX_SAFE_INTEGER).unserializable).toBe(
      false
    );
  });

  it("refuses an accessor without invoking it", () => {
    // A getter's return value is not what storage holds, and running it to find
    // that out is the risk itself: it is caller-supplied code reached while
    // checking input that is untrusted by definition. The descriptor says a
    // property is an accessor without evaluating anything.
    let invoked = 0;
    const hostile: Record<string, unknown> = { ok: 1 };
    Object.defineProperty(hostile, "computed", {
      enumerable: true,
      get() {
        invoked += 1;
        return "x".repeat(100_000);
      },
    });

    expect(measureBytes(hostile, 2 * 1024 * 1024).unserializable).toBe(true);
    expect(invoked).toBe(0);
  });

  it("reads array elements one at a time", () => {
    // Arrays are read by index, so a proxy can observe the order. Filling the
    // stack first reads every element before any is measured, which holds an
    // entire hostile array in memory while enforcing the cap that exists to
    // refuse it.
    let reads = 0;
    const backing = Array.from({ length: 1_000 }, () => "x".repeat(100_000));
    const observed = new Proxy(backing, {
      get(target, key, receiver) {
        if (typeof key === "string" && /^[0-9]+$/.test(key)) reads += 1;
        return Reflect.get(target, key, receiver) as unknown;
      },
    });

    expect(measureBytes({ items: observed }, 2 * 1024 * 1024).exceeded).toBe(
      true
    );
    // 2 MiB / 100 KB is about 21 elements. An eager fill reads all 1,000.
    expect(reads).toBeLessThan(100);
  });

  it("reports symbol-keyed properties on objects and arrays", () => {
    // JSON drops these without a word, the same class as `undefined`.
    const withSymbol: Record<string, unknown> = { ok: 1 };
    withSymbol[Symbol("s") as unknown as string] = 2;
    expect(measureBytes(withSymbol, 1024).unserializable).toBe(true);

    const array: unknown[] = [1, 2];
    (array as unknown as Record<symbol, unknown>)[Symbol("s")] = 3;
    expect(measureBytes(array, 1024).unserializable).toBe(true);

    // The positive control: an ordinary object and array must NOT be flagged,
    // or the assertions above pass for a walk that refuses everything.
    expect(measureBytes({ ok: 1 }, 1024).unserializable).toBe(false);
    expect(measureBytes([1, 2], 1024).unserializable).toBe(false);
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
