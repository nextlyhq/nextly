import { describe, expect, it } from "vitest";

import type { NodeStyles } from "../document";

import { overlaidStyles } from "./overlaid-styles";

/*
 * One style envelope laid over another. The Detach cases live with the
 * editor's shared-style target; these pin what the renderer's base layering
 * relies on as well.
 */

const styles = (value: unknown): NodeStyles => value as NodeStyles;

describe("one style envelope over another", () => {
  it("keeps every value the over tier does not set, and merges a composite side by side", () => {
    const under = styles({
      base: {
        base: {
          color: "red",
          display: "inline-block",
          padding: { top: "4px", bottom: "4px" },
        },
      },
    });
    const over = styles({
      base: { base: { color: "blue", padding: { top: "8px" } } },
      hover: { base: { color: "green" } },
    });
    expect(overlaidStyles(under, over)).toEqual({
      base: {
        base: {
          color: "blue",
          display: "inline-block",
          padding: { top: "8px", bottom: "4px" },
        },
      },
      hover: { base: { color: "green" } },
    });
  });

  it("keeps an own `__proto__` key as data at every level", () => {
    const own = (key: string, value: unknown): Record<string, unknown> =>
      Object.defineProperty({}, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    const over = styles(
      own("__proto__", own("__proto__", own("__proto__", "red")))
    );
    const laid = overlaidStyles(undefined, over) as unknown as Record<
      string,
      unknown
    >;
    // Still a plain record, holding the key as its own.
    expect(Object.getPrototypeOf(laid)).toBe(Object.prototype);
    expect(Object.hasOwn(laid, "__proto__")).toBe(true);
    const state = Object.getOwnPropertyDescriptor(laid, "__proto__")
      ?.value as Record<string, unknown>;
    expect(Object.hasOwn(state, "__proto__")).toBe(true);
    // A composite's own `__proto__` side survives being merged too.
    const padded = overlaidStyles(
      styles({ base: { base: { padding: { top: "1px" } } } }),
      styles({ base: { base: { padding: own("__proto__", "2px") } } })
    ) as unknown as {
      base: { base: { padding: Record<string, unknown> } };
    };
    expect(Object.hasOwn(padded.base.base.padding, "__proto__")).toBe(true);
    expect(padded.base.base.padding.top).toBe("1px");
  });

  it("reads a tier that is no record as empty", () => {
    expect(overlaidStyles(styles(null), styles([]))).toEqual({});
  });
});
