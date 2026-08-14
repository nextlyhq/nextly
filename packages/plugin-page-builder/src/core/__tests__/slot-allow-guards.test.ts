/**
 * `slotAdmits` is reached with UNTRUSTED input, before node shape has been checked.
 *
 * `validateDocument` walks a stored document and asks this about each child, and a stored document
 * can be hand-authored or corrupted. A node whose `type` is not a string reaches the wildcard
 * branch, where `startsWith` on a number throws a TypeError — the validator crashing instead of
 * returning the message it was called for.
 */
import { describe, expect, it } from "vitest";

import { slotAdmits } from "../slot-allow";

describe("a child type that is not a name", () => {
  it("is refused rather than throwing, under a wildcard", () => {
    // The wildcard branch is the one that calls a string method on the value.
    expect(() =>
      slotAdmits({ allowedBlocks: ["core/*"] }, 42 as never)
    ).not.toThrow();
    expect(slotAdmits({ allowedBlocks: ["core/*"] }, 42 as never)).toBe(false);
  });

  it("is refused under an exact allowlist too", () => {
    expect(slotAdmits({ allowedBlocks: ["core/column"] }, null as never)).toBe(
      false
    );
  });

  it("is still admitted where the slot restricts NOTHING", () => {
    // The separating control. An unrestricted slot makes no claim about names, so refusing here
    // would reject a block for a fault the slot does not care about — and would change what an
    // undeclared allowlist means.
    expect(slotAdmits(undefined, 42 as never)).toBe(true);
    expect(slotAdmits({}, 42 as never)).toBe(true);
  });
});
