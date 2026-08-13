import { describe, expect, it } from "vitest";

import { measureBytes, surveyDocument } from "./measure-bytes";

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

/**
 * A length-3 array holding values at `filled` and holes everywhere else.
 *
 * Built by assigning into a bare `Array(3)` rather than by `delete`-ing from a
 * literal, so the holes are genuine absent positions in every engine rather
 * than whatever a literal with elisions happens to produce.
 */
function sparse(filled: number[]): unknown[] {
  const array = new Array<unknown>(3);
  for (const index of filled) array[index] = index;
  return array;
}

/** A dense array carrying an own property that is not an index. */
function withExtra(): unknown[] {
  const array: unknown[] = [1, 2];
  Object.defineProperty(array, "extra", {
    value: "dropped",
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return array;
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
      ["a hole, which JSON writes as null", pageWith({ a: sparse([0, 2]) })],
      ["leading and trailing holes", pageWith({ a: sparse([1]) })],
      ["every position a hole", pageWith({ a: new Array(4) })],
      ["a non-index property JSON drops", pageWith({ a: withExtra() })],
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

  it("counts the null a hole serializes as, so holes reach the cap", () => {
    // The mirror of the missing comma, and it hides in the opposite place: the
    // bytes come from positions that hold NOTHING, so a walk over the values
    // present finds an almost empty array. 600,000 holes cost four bytes each
    // in storage and were measured as zero.
    const document = pageWith({ a: new Array(600_000) });

    const real = realBytes(document);
    expect(real).toBeGreaterThan(2 * 1024 * 1024);
    expect(measureBytes(document, Number.MAX_SAFE_INTEGER).bytes).toBe(real);
    expect(measureBytes(document, 2 * 1024 * 1024).exceeded).toBe(true);
  });

  it("refuses an over-long array without enumerating its keys", () => {
    // Brackets and commas alone are not the floor. Every position costs at
    // least one more byte, so an array can pass a bracket-and-comma check and
    // still be impossible to store — and the walk used to enumerate one string
    // per position before finding that out, which turned a document too large
    // to accept into hundreds of megabytes of keys.
    //
    // The counters are what separate the implementations, because every version
    // returns `tooLarge`: only the cost differs.
    //
    // `descriptors` is the sharper of the two. A walk that accepts the array
    // and discovers the overflow one position at a time reads a descriptor per
    // element; one that rejects it from `length` reads exactly the one that
    // told it the length.
    //
    // `ownKeys` covers the other half, which is memory rather than work: one
    // call is the symbol check every object pays, and a second would be a key
    // list built for an array that cannot be stored. Measured at two million
    // positions, that list moved resident memory from 94 MB to 366 MB.
    let descriptors = 0;
    let ownKeys = 0;
    const watched = new Proxy(new Array(1000).fill(0), {
      getOwnPropertyDescriptor(target, key) {
        descriptors += 1;
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
      ownKeys(target) {
        ownKeys += 1;
        return Reflect.ownKeys(target);
      },
    });

    // Chosen so the brackets and commas (1001) fit the budget and the positions
    // (1000 more) cannot. A bound that only counted the separators would walk
    // on.
    const survey = surveyDocument(watched, {
      maxBytes: 1500,
      maxDepth: 12,
      maxNodes: 5000,
    });

    expect(survey.tooLarge).toBe(true);
    expect(descriptors).toBe(1);
    expect(ownKeys).toBe(1);
  });

  it("refuses an array carrying a property JSON would drop", () => {
    // The array reads back from the caller's own value with `extra` on it and
    // returns from storage without it. Nothing throws and the size is right,
    // so the byte count cannot be what reports this.
    const document = pageWith({ a: withExtra() });
    const survey = measureBytes(document, Number.MAX_SAFE_INTEGER);

    expect(survey.bytes).toBe(realBytes(document));
    expect(survey.unserializable).toBe(true);

    // The control: the same array without the extra property is accepted, so
    // the refusal is of the property rather than of arrays in general.
    expect(
      measureBytes(pageWith({ a: [1, 2] }), Number.MAX_SAFE_INTEGER)
        .unserializable
    ).toBe(false);
  });

  it("treats a name that merely looks like an index as a dropped property", () => {
    // `JSON.stringify` emits positions 0..length-1 and nothing else, so these
    // are properties it discards — and each converts to a number, which is why
    // a numeric test rather than a canonical one would have admitted them.
    for (const name of ["01", "1e1", " 1", "-0", "1.0", "4294967296"]) {
      const array: unknown[] = [1, 2];
      Object.defineProperty(array, name, {
        value: "dropped",
        enumerable: true,
        writable: true,
        configurable: true,
      });
      const survey = measureBytes(
        pageWith({ a: array }),
        Number.MAX_SAFE_INTEGER
      );
      expect(survey.unserializable, name).toBe(true);
      expect(survey.bytes, name).toBe(realBytes(pageWith({ a: array })));
    }
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

  it("asks for one member at a time, records and arrays alike", () => {
    // Counts DESCRIPTOR requests, which is the operation the walk performs.
    // An earlier version of this counted `get` traps and stayed green for a
    // walk that enumerated every member first, because the reader never
    // triggers `get` at all — a control that measured an operation its subject
    // does not use.
    //
    // Asking for a member runs the container's own code, so a descriptor trap
    // can fabricate a fresh object per request. Enumerating a whole container
    // before measuring anything therefore materializes all of it under a cap
    // meant to refuse exactly that.
    const probe = (size: number) => {
      let descriptors = 0;
      const target: Record<string, unknown> = {};
      for (let index = 0; index < size; index += 1) target[`k${index}`] = index;
      const observed = new Proxy(target, {
        getOwnPropertyDescriptor(t, key) {
          descriptors += 1;
          return {
            configurable: true,
            enumerable: true,
            value: { big: "x".repeat(100_000) },
          };
        },
      });
      const result = measureBytes({ items: observed }, 2 * 1024 * 1024);
      return { descriptors, exceeded: result.exceeded };
    };

    const record = probe(1_000);
    expect(record.exceeded).toBe(true);
    // 2 MiB / 100 KB is about 21 members. An eager pass asks for all 1,000.
    expect(record.descriptors).toBeLessThan(200);

    let elements = 0;
    const backing = Array.from({ length: 1_000 }, () => 0);
    const observedArray = new Proxy(backing, {
      getOwnPropertyDescriptor(t, key) {
        // `length` must answer truthfully, or the walk refuses the array
        // before it iterates and this fixture never reaches the loop it is
        // testing — a control satisfied by the subject declining to run.
        if (typeof key !== "string" || !/^[0-9]+$/.test(key)) {
          return Reflect.getOwnPropertyDescriptor(t, key);
        }
        elements += 1;
        return {
          configurable: true,
          enumerable: true,
          value: { big: "x".repeat(100_000) },
        };
      },
    });
    expect(
      measureBytes({ items: observedArray }, 2 * 1024 * 1024).exceeded
    ).toBe(true);
    expect(elements).toBeLessThan(200);
  });

  it("refuses an indexed accessor without invoking it", () => {
    // The array counterpart of the object case. Both go through one reader, so
    // a guard cannot hold on one path and not the other — which is why the
    // reader exists rather than two matching checks.
    let invoked = 0;
    const array: unknown[] = [1];
    Object.defineProperty(array, "0", {
      enumerable: true,
      configurable: true,
      get() {
        invoked += 1;
        return "x".repeat(100_000);
      },
    });

    expect(measureBytes({ items: array }, 2 * 1024 * 1024).unserializable).toBe(
      true
    );
    expect(invoked).toBe(0);
  });

  it("survives a hostile prototype lookup", () => {
    // `Object.getPrototypeOf` runs a proxy's trap, which is caller-supplied
    // code. A walk that is a precondition for parsing untrusted input must
    // report rather than let the exception escape.
    const hostile = new Proxy(
      { a: 1 },
      {
        getPrototypeOf() {
          throw new Error("trap");
        },
      }
    );

    expect(() => measureBytes({ nested: hostile }, 1024)).not.toThrow();
    expect(measureBytes({ nested: hostile }, 1024).unserializable).toBe(true);
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
