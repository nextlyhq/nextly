/**
 * The field-function registry can be snapshotted and put back.
 *
 * A config reload re-registers from the newly read config before it knows the
 * reload will land, on the same optimistic terms as the field-type registry.
 * A reload that is then abandoned has to leave the retained config's functions
 * in force: an access rule from a config that never took effect must not be
 * the one deciding writes.
 */
import { describe, expect, it } from "vitest";

import {
  getFieldFunctions,
  registerFieldFunctions,
  restoreFieldFunctions,
  snapshotFieldFunctions,
} from "../field-level-registry";

describe("snapshotFieldFunctions / restoreFieldFunctions", () => {
  it("puts back what was registered, and drops what the abandoned run added", () => {
    registerFieldFunctions("collection", "kept", [
      { name: "tone", type: "text", defaultValue: () => "before" },
    ]);
    const snapshot = snapshotFieldFunctions();

    // What an abandoned reload would have done: change one entity and add one.
    registerFieldFunctions("collection", "kept", [
      { name: "tone", type: "text", defaultValue: () => "after" },
    ]);
    registerFieldFunctions("collection", "added", [
      { name: "tone", type: "text", defaultValue: () => "new" },
    ]);
    expect(
      getFieldFunctions("collection", "kept")?.tone?.defaultValue?.({})
    ).toBe("after");
    expect(getFieldFunctions("collection", "added")).toBeDefined();

    restoreFieldFunctions(snapshot);

    expect(
      getFieldFunctions("collection", "kept")?.tone?.defaultValue?.({})
    ).toBe("before");
    // The entity the abandoned run introduced is gone, not merely stale.
    expect(getFieldFunctions("collection", "added")).toBeUndefined();
  });

  it("is a copy, so registering after the snapshot does not change it", () => {
    registerFieldFunctions("collection", "copied", [
      { name: "tone", type: "text", defaultValue: () => "one" },
    ]);
    const snapshot = snapshotFieldFunctions();
    registerFieldFunctions("collection", "copied", [
      { name: "tone", type: "text", defaultValue: () => "two" },
    ]);

    restoreFieldFunctions(snapshot);
    expect(
      getFieldFunctions("collection", "copied")?.tone?.defaultValue?.({})
    ).toBe("one");
  });
});
