/**
 * The dual read survives the release that adopts the new spelling.
 *
 * 🔴 This is the case a derived read order gets wrong, and it gets it wrong at the worst moment.
 * Once `STORAGE_FORMAT.wireTypeKey` is flipped to the target spelling the two catalogs hold the
 * SAME string, so a read order built from just those two collapses to one entry — and the legacy
 * spelling stops being read in precisely the release where nearly every stored document still
 * uses it. Every document written before the flip would read as untyped.
 *
 * A separate file because the flip is simulated by mocking the CATALOG, and the sibling suite
 * mocks the migration manifest instead; `vi.mock` is hoisted per file, so the two states cannot
 * coexist in one.
 */
import { describe, expect, it, vi } from "vitest";

// The post-flip world: the current spelling IS the target spelling.
vi.mock("../../../../schemas/storage-format", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../schemas/storage-format")
  >("../../../../schemas/storage-format");
  return {
    ...actual,
    STORAGE_FORMAT: {
      ...actual.STORAGE_FORMAT,
      wireTypeKey: "_fieldGroupType",
    },
  };
});

import {
  currentFieldGroupTypeKey,
  isFieldGroupTypeKey,
  readFieldGroupType,
  writeFieldGroupType,
} from "../field-group-type-key";

describe("after the catalog has been flipped to the new spelling", () => {
  it("the two catalogs really do agree, or this file proves nothing", () => {
    // The precondition. Without it, a mock that silently failed to apply would leave every
    // assertion below running against the PRE-flip world and passing for the wrong reason.
    expect(currentFieldGroupTypeKey).toBe("_fieldGroupType");
  });

  it("still reads a document written under the LEGACY spelling", () => {
    // The whole point. These are the documents that exist in the largest numbers on the day the
    // flip ships, and the migration may not have rewritten them yet — or may never, if the
    // operator has not run it.
    expect(readFieldGroupType({ _componentType: "hero" })).toBe("hero");
  });

  it("still reads a document written under the new spelling", () => {
    expect(readFieldGroupType({ _fieldGroupType: "hero" })).toBe("hero");
  });

  it("still recognises the legacy spelling as a type key", () => {
    // The key-by-key walkers depend on this: a pruner that stops recognising the legacy key
    // discards the discriminator of every un-rewritten row it touches.
    expect(isFieldGroupTypeKey("_componentType")).toBe(true);
    expect(isFieldGroupTypeKey("_fieldGroupType")).toBe(true);
  });

  it("writes the NEW spelling, so the legacy set only shrinks", () => {
    const instance: Record<string, unknown> = {};
    writeFieldGroupType(instance, "hero");

    expect(Object.keys(instance)).toEqual(["_fieldGroupType"]);
  });

  it("prefers the current spelling when a document carries both", () => {
    expect(
      readFieldGroupType({ _fieldGroupType: "new", _componentType: "old" })
    ).toBe("new");
  });
});
