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
  clearFieldGroupType,
  currentFieldGroupTypeKey,
  fieldGroupTypeKeys,
  isFieldGroupTypeKey,
  readFieldGroupType,
  writeFieldGroupType,
} from "../field-group-type-key";

import { COMPONENT_META_KEYS } from "../../services/field-group-utils";

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

  it("removes the discriminator under EVERY spelling", () => {
    // Clearing only the current spelling leaves a legacy-spelled document still carrying its
    // type, so an object the caller has defined by that absence still reads as typed and the
    // strip/tag pair stop being inverses of each other.
    const instance: Record<string, unknown> = {
      _componentType: "old",
      _fieldGroupType: "new",
      label: "kept",
    };

    clearFieldGroupType(instance);

    expect(Object.keys(instance)).toEqual(["label"]);
  });

  it("treats every spelling as component metadata rather than authored data", () => {
    // This set decides what is stripped as metadata before a write. A spelling missing from it is
    // treated as a field the author meant to store, which is the opposite of the intent for a key
    // that only ever announced the instance's type.
    for (const key of fieldGroupTypeKeys) {
      expect(COMPONENT_META_KEYS.has(key)).toBe(true);
    }
    expect(COMPONENT_META_KEYS.has("_componentType")).toBe(true);
  });
});
