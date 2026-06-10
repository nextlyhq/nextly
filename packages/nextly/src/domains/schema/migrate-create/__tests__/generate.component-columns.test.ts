// Components must be generated with component system columns (the _parent_*
// embedding set), NOT collection columns (slug/title). Regression for
// migrate:create emitting a collection-shaped table for components, which made
// the generated snapshot diverge from the real (apply-built) component table
// and broke `migrate:resolve --applied` verify.

import { describe, it, expect } from "vitest";

import { buildDesiredSnapshotFromConfig } from "../generate";

describe("buildDesiredSnapshotFromConfig — components", () => {
  it("emits component system columns, not collection columns", () => {
    const snap = buildDesiredSnapshotFromConfig(
      [],
      [],
      [
        {
          slug: "test_comp",
          tableName: "comp_test_comp",
          fields: [{ name: "content", type: "text" }],
        },
      ],
      "postgresql"
    );

    const table = snap.tables.find(t => t.name === "comp_test_comp");
    const cols = (table?.columns ?? []).map(c => c.name);

    // Component embedding columns are present.
    expect(cols).toEqual(
      expect.arrayContaining([
        "_parent_id",
        "_parent_table",
        "_parent_field",
        "_order",
        "_component_type",
      ])
    );
    // Collection-only columns must NOT be present on a component.
    expect(cols).not.toContain("slug");
    expect(cols).not.toContain("title");
  });
});
