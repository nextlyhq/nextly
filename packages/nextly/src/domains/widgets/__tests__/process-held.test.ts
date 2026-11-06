import { describe, expect, it, vi } from "vitest";

import { processHeld } from "../process-held";

const isMap = (held: unknown): held is Map<string, number> =>
  held instanceof Map;

/** A key no other case, or run, shares. */
const freshKey = () => `nextly.test.processHeld.${crypto.randomUUID()}`;

describe("a value held for the process", () => {
  it("is made once, and every asker is handed that one, under its Symbol.for key", () => {
    const key = freshKey();
    const make = vi.fn(() => new Map<string, number>());
    const first = processHeld(key, make, isMap);
    const second = processHeld(key, make, isMap);
    expect(second).toBe(first);
    expect(make).toHaveBeenCalledOnce();
    expect(Reflect.get(globalThis, Symbol.for(key))).toBe(first);
  });

  it("is neither listed on globalThis, nor replaced, nor removed", () => {
    const key = freshKey();
    const held = processHeld(key, () => new Map<string, number>(), isMap);
    const slot = Symbol.for(key);
    expect(Object.getOwnPropertyDescriptor(globalThis, slot)).toEqual({
      value: held,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    expect(Reflect.set(globalThis, slot, new Map())).toBe(false);
    expect(Reflect.deleteProperty(globalThis, slot)).toBe(false);
    expect(processHeld(key, () => new Map<string, number>(), isMap)).toBe(held);
  });

  it("refuses a slot that holds something else, rather than reading it as the value", () => {
    const key = freshKey();
    Object.defineProperty(globalThis, Symbol.for(key), { value: "taken" });
    expect(() =>
      processHeld(key, () => new Map<string, number>(), isMap)
    ).toThrow();
  });
});
