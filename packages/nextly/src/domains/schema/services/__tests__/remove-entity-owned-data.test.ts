import { describe, expect, it, vi } from "vitest";

import { ENTITY_OWNED_DATA, type OwningEntityKind } from "../entity-owned-data";
import {
  removeFieldGroupRegistryRow,
  rowsRemovedBeforeTheDrop,
} from "../remove-entity-owned-data";

const KINDS: OwningEntityKind[] = ["collection", "single", "fieldGroup"];

describe("the rows a delete removes before an entity's tables go", () => {
  it("has a step for every kind the declaration removes before the drop, but the translations table", () => {
    // A kind added to the declaration with no step would otherwise be passed over in silence.
    for (const kind of KINDS) {
      const declared = ENTITY_OWNED_DATA[kind]
        .filter(entry => entry.removed === "beforeTheDrop")
        .map(entry => entry.data)
        .filter(data => data !== "translations");
      expect(rowsRemovedBeforeTheDrop(kind)).toEqual(declared);
    }
  });

  it("removes them in the declaration's order: field-group values, then the translation rows", () => {
    for (const kind of ["collection", "single"] as const) {
      expect(rowsRemovedBeforeTheDrop(kind)).toEqual([
        "fieldGroupValues",
        "translationArchive",
        "translationTransition",
        "translationProvenance",
      ]);
    }
    // A field group keeps no records of where its translated values came from.
    expect(rowsRemovedBeforeTheDrop("fieldGroup")).toEqual([
      "fieldGroupValues",
      "translationArchive",
      "translationTransition",
    ]);
  });
});

describe("a field group's registry row", () => {
  it("is removed by its slug alone, from the registry named, and says how many went", async () => {
    const remove = vi.fn().mockResolvedValue(1);
    expect(
      await removeFieldGroupRegistryRow(
        { delete: remove },
        "dynamic_components",
        "seo"
      )
    ).toBe(1);
    expect(remove).toHaveBeenCalledWith("dynamic_components", {
      and: [{ column: "slug", op: "=", value: "seo" }],
    });
  });
});
