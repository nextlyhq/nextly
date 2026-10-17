/**
 * What a slot's lock fixes, asked of the rule directly.
 *
 * Validation is where the rule reaches a document, and its own suite drives it
 * through the registry and the expander. These pin the rule's three answers on
 * their own, so a failure there can be told apart from a failure here.
 */
import { describe, expect, it } from "vitest";

import {
  effectiveSlotLock,
  holdsStartingChildren,
  isSlotLock,
} from "./slot-lock";

describe("isSlotLock", () => {
  it("accepts every value a slot may declare", () => {
    for (const value of ["all", "insert", "contentOnly", false]) {
      expect(isSlotLock(value)).toBe(true);
    }
  });

  it("refuses anything else, near misses included", () => {
    for (const value of [
      true,
      "ALL",
      "content-only",
      "readonly",
      "",
      null,
      undefined,
      0,
      {},
    ]) {
      expect(isSlotLock(value)).toBe(false);
    }
  });
});

describe("effectiveSlotLock", () => {
  it("leaves a slot unlocked when neither it nor anything above it locks", () => {
    expect(effectiveSlotLock(undefined, undefined)).toBeUndefined();
  });

  it("takes the slot's own declaration", () => {
    expect(effectiveSlotLock("all", undefined)).toBe("all");
    expect(effectiveSlotLock("insert", undefined)).toBe("insert");
    expect(effectiveSlotLock("contentOnly", undefined)).toBe("contentOnly");
  });

  it("passes a lock down to a slot that declares none", () => {
    expect(effectiveSlotLock(undefined, "all")).toBe("all");
    expect(effectiveSlotLock(undefined, "insert")).toBe("insert");
  });

  it("lets a slot's own lock replace the one it would inherit", () => {
    expect(effectiveSlotLock("insert", "all")).toBe("insert");
    expect(effectiveSlotLock("all", "insert")).toBe("all");
  });

  it("stops the inheritance at a slot that declares false", () => {
    expect(effectiveSlotLock(false, "all")).toBeUndefined();
    expect(effectiveSlotLock(false, "insert")).toBeUndefined();
  });

  it("keeps contentOnly beneath it whatever a slot inside declares", () => {
    expect(effectiveSlotLock(false, "contentOnly")).toBe("contentOnly");
    expect(effectiveSlotLock("insert", "contentOnly")).toBe("contentOnly");
    expect(effectiveSlotLock(undefined, "contentOnly")).toBe("contentOnly");
  });

  it("reads a declaration that is not a lock as no declaration", () => {
    expect(effectiveSlotLock("readonly", undefined)).toBeUndefined();
    expect(effectiveSlotLock(true, "all")).toBe("all");
  });
});

describe("holdsStartingChildren", () => {
  const starting = ["acme/heading", "acme/text", "acme/button"];

  it("accepts the starting children in their order under every lock", () => {
    for (const lock of ["all", "insert", "contentOnly"] as const) {
      expect(holdsStartingChildren(lock, starting, starting)).toBe(true);
    }
  });

  it("refuses a reorder under all and contentOnly, and accepts it under insert", () => {
    const reordered = ["acme/button", "acme/heading", "acme/text"];
    expect(holdsStartingChildren("all", reordered, starting)).toBe(false);
    expect(holdsStartingChildren("contentOnly", reordered, starting)).toBe(
      false
    );
    expect(holdsStartingChildren("insert", reordered, starting)).toBe(true);
  });

  it("refuses a child added or removed under every lock", () => {
    for (const lock of ["all", "insert", "contentOnly"] as const) {
      expect(holdsStartingChildren(lock, starting.slice(0, 2), starting)).toBe(
        false
      );
      expect(
        holdsStartingChildren(lock, [...starting, "acme/text"], starting)
      ).toBe(false);
    }
  });

  it("refuses another type in a starting child's place under every lock", () => {
    const swapped = ["acme/heading", "acme/image", "acme/button"];
    for (const lock of ["all", "insert", "contentOnly"] as const) {
      expect(holdsStartingChildren(lock, swapped, starting)).toBe(false);
    }
  });

  it("counts each type, so insert cannot trade one starting child for another", () => {
    // Same length and the same SET of types, which a set comparison would pass.
    expect(
      holdsStartingChildren(
        "insert",
        ["acme/card", "acme/card", "acme/cta"],
        ["acme/card", "acme/cta", "acme/cta"]
      )
    ).toBe(false);
  });

  it("holds a slot that starts with nothing to holding nothing", () => {
    expect(holdsStartingChildren("all", [], [])).toBe(true);
    expect(holdsStartingChildren("insert", ["acme/text"], [])).toBe(false);
  });

  it("matches no starting child with a child whose type cannot be read", () => {
    expect(
      holdsStartingChildren(
        "all",
        ["acme/heading", undefined],
        starting.slice(0, 2)
      )
    ).toBe(false);
    expect(
      holdsStartingChildren(
        "insert",
        [undefined, "acme/heading"],
        starting.slice(0, 2)
      )
    ).toBe(false);
  });
});
