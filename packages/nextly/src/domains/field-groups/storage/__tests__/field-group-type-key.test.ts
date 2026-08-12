/**
 * The type key reads under either spelling, and writes under one.
 *
 * 🔴 The two spellings are the SAME STRING today — the flip has not happened — so every assertion
 * about "falls back to the legacy key" passes trivially against the real constants, whether or not
 * the fallback exists at all. A suite written against them would report coverage it does not have,
 * and would keep reporting it right up until the flip made it matter.
 *
 * So the target spelling is mocked to something genuinely different. That is what makes the two
 * branches distinguishable, and it is the only way to see the fallback work before the day it has
 * to.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// A spelling that is not the current one, standing in for the post-flip name. Mocked rather than
// waited for: the property under test is "two different keys both read", and with one key there is
// nothing to test.
vi.mock("../../migration/manifest", async () => {
  const actual = await vi.importActual<
    typeof import("../../migration/manifest")
  >("../../migration/manifest");
  return {
    ...actual,
    MIGRATION_TARGET: { ...actual.MIGRATION_TARGET, wireTypeKey: "_afterFlip" },
  };
});

import { STORAGE_FORMAT } from "../../../../schemas/storage-format";
import {
  currentFieldGroupTypeKey,
  readFieldGroupType,
  writeFieldGroupType,
} from "../field-group-type-key";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the field-group type key", () => {
  it("reads a document written under the CURRENT spelling", () => {
    expect(readFieldGroupType({ [STORAGE_FORMAT.wireTypeKey]: "hero" })).toBe(
      "hero"
    );
  });

  it("reads a document written under the OTHER spelling", () => {
    // The row a migration has already rewritten, or has not yet — which of the two depends on
    // direction, and a reader cannot tell. Both must read.
    expect(readFieldGroupType({ _afterFlip: "hero" })).toBe("hero");
  });

  it("prefers the current spelling when a document somehow carries both", () => {
    // Not a state the migration produces, but a state a hand-repaired or partially rewritten
    // document can reach. The preference has to be decided rather than left to key order.
    expect(
      readFieldGroupType({
        [STORAGE_FORMAT.wireTypeKey]: "current",
        _afterFlip: "other",
      })
    ).toBe("current");
  });

  it("writes only the current spelling", () => {
    // 🔴 The half that matters most. A save path that writes the LEGACY key keeps manufacturing
    // pre-migration documents behind a migration that already reported success, so the set of
    // rows needing a rewrite grows instead of shrinking.
    const instance: Record<string, unknown> = {};
    writeFieldGroupType(instance, "hero");

    expect(instance[currentFieldGroupTypeKey]).toBe("hero");
    expect(Object.keys(instance)).toEqual([currentFieldGroupTypeKey]);
    expect(instance._afterFlip).toBeUndefined();
  });

  it("answers undefined for an instance that announces no type", () => {
    // The single-field-group shape carries no discriminator at all, so absence is an ordinary
    // answer rather than a failure, and callers branch on it.
    expect(readFieldGroupType({})).toBeUndefined();
    expect(readFieldGroupType(null)).toBeUndefined();
    expect(readFieldGroupType("hero")).toBeUndefined();
  });

  it("treats a non-string value as absent rather than coercing it", () => {
    // The value is a slug that gets looked up. A number coerces into something that resolves to
    // nothing while reading as though a type had been found, which turns a malformed document
    // into a confident wrong answer.
    expect(
      readFieldGroupType({ [STORAGE_FORMAT.wireTypeKey]: 42 })
    ).toBeUndefined();
    expect(
      readFieldGroupType({ [STORAGE_FORMAT.wireTypeKey]: { slug: "hero" } })
    ).toBeUndefined();
  });

  it("falls through to the other spelling when the current one holds a non-string", () => {
    // The two rules compose: a malformed current key must not shadow a usable legacy one, or a
    // partially rewritten document reads as untyped because of a value nobody meant to keep.
    expect(
      readFieldGroupType({
        [STORAGE_FORMAT.wireTypeKey]: 42,
        _afterFlip: "hero",
      })
    ).toBe("hero");
  });
});
