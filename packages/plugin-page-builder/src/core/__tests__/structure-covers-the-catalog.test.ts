/**
 * Every block DEFINITION that declares slots has a structure the write path can read.
 *
 * This file is the renderer-aware half of the pair, and it imports `render/blocks` deliberately —
 * the opposite of `validate-without-renderer.test.ts`, which must never import it. The two answer
 * different questions and both are needed:
 *
 * - **There:** with nothing loaded, does the validator still refuse an undeclared slot? That is the
 *   condition the config and server paths actually run in.
 * - **Here:** does the structure source still describe the real catalogue? A hand-written list
 *   compared against a hand-written record agrees with itself whatever the blocks do.
 *
 * The gap this closes is specific. The set-completeness assertion in the other file reads
 * `CORE_BLOCK_STRUCTURES` and compares it to a literal list. Both are maintained by hand, so a new
 * built-in that declares its slots ONLY in `defineBlock` satisfies both and silently opts itself
 * out of the slot check — the failure the whole task exists to remove, reintroduced by omission.
 * Nothing but the registry itself can see that.
 */
import { describe, expect, it } from "vitest";

import { CORE_BLOCK_STRUCTURES, declaredSlotsOf } from "../block-structure";
import { defaultBlockRegistry } from "../registry";
import "../../render/blocks";

/** Every registered definition that can hold children, by type. */
function slotDeclaringTypes(): string[] {
  return defaultBlockRegistry
    .all()
    .filter(def => (def.slots?.length ?? 0) > 0)
    .map(def => def.type)
    .sort();
}

describe("the structure source against the real catalogue", () => {
  it("covers every definition that declares a slot", () => {
    const fromDefinitions = slotDeclaringTypes();

    // Positive control: the registry is actually populated here. Without the side-effect import
    // above this list would be empty and every assertion below would hold vacuously — which is
    // exactly how the write-path check came to look like it worked while being inert.
    expect(fromDefinitions.length).toBeGreaterThan(0);

    const missing = fromDefinitions.filter(
      type => declaredSlotsOf(type) === undefined
    );
    expect(missing).toEqual([]);
  });

  it("declares the SAME slot names the definition does", () => {
    // Covering the type is not enough: a structure naming different slots than its definition
    // would let the validator accept a name the renderer never places, or reject one it does.
    for (const def of defaultBlockRegistry.all()) {
      const declared = def.slots?.map(s => s.name).sort();
      if (!declared?.length) continue;
      expect(
        declaredSlotsOf(def.type)
          ?.map(s => s.name)
          .sort()
      ).toEqual(declared);
    }
  });

  it("does not describe a block the catalogue does not have", () => {
    // The other direction. A structure left behind by a renamed or removed block would keep the
    // validator enforcing slots for a type nothing can produce, which reads as working and is not.
    const known = new Set(defaultBlockRegistry.all().map(def => def.type));
    const orphans = Object.keys(CORE_BLOCK_STRUCTURES).filter(
      type => !known.has(type)
    );

    expect(orphans).toEqual([]);
  });
});
