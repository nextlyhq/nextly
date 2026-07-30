/**
 * Rebuilt objects keep a key named after a prototype accessor.
 *
 * Four places rebuild an object key by key from data nobody validates: the two
 * detach helpers, the webhook envelope's path stripper, and the version diff's
 * secret mask. `JSON.parse` produces `__proto__` as an ordinary own property,
 * so any JSON column can carry one. Assigning it would repoint the copy's
 * prototype and drop the key, which is silent data loss in a delivered
 * envelope, a stored diff, and the declaration a plugin validator judges.
 */
import { describe, expect, it } from "vitest";

import { detachData } from "../detach";
import { detachedField } from "../detached-field";
import { defineOwnProperty, hasOwnProperty } from "../own-property";

/** What a JSON column holding this key actually deserializes to. */
const withProtoKey = (): Record<string, unknown> =>
  JSON.parse('{"__proto__": {"polluted": true}, "kept": 1}') as Record<
    string,
    unknown
  >;

describe("defineOwnProperty", () => {
  it("creates an own property for a key the prototype defines as an accessor", () => {
    const target: Record<string, unknown> = {};
    defineOwnProperty(target, "__proto__", { marker: 1 });

    expect(hasOwnProperty(target, "__proto__")).toBe(true);
    expect(target.__proto__).toEqual({ marker: 1 });
    // The copy's own prototype is untouched, so nothing leaks to other objects.
    expect(Object.getPrototypeOf(target)).toBe(Object.prototype);
  });

  it("is what plain assignment fails to do", () => {
    const assigned: Record<string, unknown> = {};
    // Written through a variable so this is the ordinary keyed assignment the
    // helper replaces, reaching the inherited setter exactly as the code paths
    // it guards used to.
    const key = "__proto__";
    assigned[key] = { marker: 1 };

    // Pins the hazard the helper exists for: the key never becomes a property.
    expect(hasOwnProperty(assigned, "__proto__")).toBe(false);
    expect(Object.keys(assigned)).toEqual([]);
  });
});

describe("hasOwnProperty", () => {
  it("does not answer for the prototype chain", () => {
    expect(hasOwnProperty({}, "constructor")).toBe(false);
    expect(hasOwnProperty({}, "toString")).toBe(false);
    expect(hasOwnProperty({ toString: 1 }, "toString")).toBe(true);
  });
});

describe("detachedField", () => {
  it("hands plugin code an option named __proto__", () => {
    const field = {
      name: "rating",
      type: "star-rating",
      ...withProtoKey(),
    } as unknown as { name: string; type: string };

    const detached = detachedField(field) as unknown as Record<string, unknown>;

    expect(hasOwnProperty(detached, "__proto__")).toBe(true);
    expect(detached.__proto__).toEqual({ polluted: true });
    expect(detached.kept).toBe(1);
  });

  it("keeps a nested __proto__ inside an option object", () => {
    const field = {
      name: "rating",
      type: "star-rating",
      policy: withProtoKey(),
    } as unknown as { name: string; type: string };

    const detached = detachedField(field) as unknown as {
      policy: Record<string, unknown>;
    };

    expect(hasOwnProperty(detached.policy, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(detached.policy)).toBe(Object.prototype);
    // The value too: preserving the key while losing what it held would be the
    // same data loss wearing a different shape.
    expect(detached.policy.__proto__).toEqual({ polluted: true });
  });
});

describe("detachData", () => {
  it("keeps a __proto__ key held in document data", () => {
    const detached = detachData({ body: withProtoKey() });

    expect(hasOwnProperty(detached.body, "__proto__")).toBe(true);
    expect(detached.body.kept).toBe(1);
    expect(detached.body.__proto__).toEqual({ polluted: true });
  });
});
