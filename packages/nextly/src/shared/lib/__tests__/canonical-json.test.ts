/**
 * Guards the canonical serialisation both comparisons decide equality with.
 *
 * Two opposite mistakes matter here. Key ORDER must not count as content, or a
 * serializer upgrade that merely reorders exported properties reads as an edit.
 * And nothing a user can actually change may be dropped on the way — the
 * failure that reports two different values as the same.
 */
import { describe, expect, it } from "vitest";

import { canonicalise, canonicalJson } from "../canonical-json";

describe("canonicalJson — key order is not content", () => {
  it("gives two orderings of one object the same serialisation", () => {
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });

  it("sorts at every depth, not just the top", () => {
    expect(canonicalJson({ o: { x: 1, y: 2 } })).toBe(
      canonicalJson({ o: { y: 2, x: 1 } })
    );
  });

  it("sorts inside arrays without reordering the arrays themselves", () => {
    expect(canonicalJson([{ a: 1, b: 2 }])).toBe(
      canonicalJson([{ b: 2, a: 1 }])
    );
    // Array order IS content: an author who reorders a list changed something.
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });
});

describe("canonicalJson — nothing a user can change is dropped", () => {
  it("MUST DIFFER: values differing only under an own __proto__ key", () => {
    // Assigning `__proto__` to an ordinary object invokes the legacy prototype
    // setter rather than creating an enumerable property, so `JSON.stringify`
    // omits it entirely and both values serialise to `{}`. Parsed from text so
    // the key really is an own property, as it would be arriving from storage.
    const a = JSON.parse('{"__proto__":{"role":"reader"}}') as unknown;
    const b = JSON.parse('{"__proto__":{"role":"admin"}}') as unknown;
    expect(canonicalJson(a)).not.toBe(canonicalJson(b));
  });

  it("keeps an own __proto__ key in the output rather than swallowing it", () => {
    const parsed = JSON.parse('{"__proto__":{"role":"reader"}}') as unknown;
    expect(canonicalJson(parsed)).toContain("__proto__");
  });

  it("does not let __proto__ pollute the rebuilt object's prototype", () => {
    const parsed = JSON.parse('{"__proto__":{"polluted":true}}') as unknown;
    const rebuilt = canonicalise(parsed) as Record<string, unknown>;
    expect(Object.getPrototypeOf(rebuilt)).toBeNull();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("distinguishes a stored null from an absent key", () => {
    expect(canonicalJson({ a: null })).not.toBe(canonicalJson({}));
  });
});

describe("canonicalJson — what it cannot represent", () => {
  it("answers undefined for a cyclic value rather than throwing", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(canonicalJson(cyclic)).toBeUndefined();
  });

  it("answers undefined for a value JSON has no representation for", () => {
    expect(canonicalJson(undefined)).toBeUndefined();
    expect(canonicalJson(() => 1)).toBeUndefined();
  });
});
