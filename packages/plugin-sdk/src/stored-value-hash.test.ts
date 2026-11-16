/**
 * The hash a conditional write is judged by, as a plugin imports it.
 *
 * A plugin hashes what the stored read returned, and core hashes what it reads
 * again under the row lock, so the hash must not change with what a database
 * does to a value it hands back: PostgreSQL's `jsonb` and MySQL's `JSON`
 * reorder an object's keys. It must change with anything that changes what a
 * document means, an array's order among them, and "nothing stored" must not
 * collide with any stored value.
 */
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { storedValueHash } from "./index";

const value = (v: unknown) => ({ kind: "value", value: v }) as const;
const absent = { kind: "absent" } as const;

describe("storedValueHash", () => {
  it("is the SHA-256 of the value's canonical JSON, as hex", async () => {
    const hash = await storedValueHash(value({ b: 1, a: [true, null] }));
    expect(hash).toBe(
      createHash("sha256").update('{"a":[true,null],"b":1}').digest("hex")
    );
  });

  it("ignores the order of an object's keys, at every depth", async () => {
    expect(
      await storedValueHash(value({ a: 1, b: { c: 1, d: [{ e: 1, f: 2 }] } }))
    ).toBe(
      await storedValueHash(value({ b: { d: [{ f: 2, e: 1 }], c: 1 }, a: 1 }))
    );
  });

  it("keeps an array's order, which is part of what a document means", async () => {
    expect(await storedValueHash(value([1, 2]))).not.toBe(
      await storedValueHash(value([2, 1]))
    );
  });

  it("hashes an own __proto__ key as the key it is", async () => {
    const one = JSON.parse('{"__proto__":{"x":1}}') as unknown;
    const two = JSON.parse('{"__proto__":{"x":2}}') as unknown;
    expect(await storedValueHash(value(one))).not.toBe(
      await storedValueHash(value(two))
    );
    expect(await storedValueHash(value(one))).toBe(
      createHash("sha256").update('{"__proto__":{"x":1}}').digest("hex")
    );
  });

  it("tells a value's type apart: a string from the number it spells", async () => {
    expect(await storedValueHash(value("1"))).not.toBe(
      await storedValueHash(value(1))
    );
  });

  it("hashes nothing stored as a stored null, and as no stored value", async () => {
    const nothing = await storedValueHash(absent);
    expect(await storedValueHash(value(null))).toBe(nothing);
    for (const stored of ["", {}, [], 0, false, "\u0000absent"]) {
      expect(await storedValueHash(value(stored))).not.toBe(nothing);
    }
  });
});
