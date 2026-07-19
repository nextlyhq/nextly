import { describe, it, expect } from "vitest";

import { assembleDocument } from "../assemble-document";

// Verifies the snapshot builder's two contract points: (1) parent columns,
// component subtrees, and m2m id arrays merge into one object keyed by field
// name; (2) it is pure - missing inputs are treated as empty and the inputs are
// never mutated.
describe("assembleDocument", () => {
  it("merges parent columns, component subtrees, and m2m ids", () => {
    const snapshot = assembleDocument({
      parentRow: { id: "e1", title: "Hello", status: "published" },
      components: { seo: { metaTitle: "Hi" } },
      manyToMany: { tags: ["t1", "t2"] },
    });
    expect(snapshot).toEqual({
      id: "e1",
      title: "Hello",
      status: "published",
      seo: { metaTitle: "Hi" },
      tags: ["t1", "t2"],
    });
  });

  it("treats missing components/m2m as empty and does not mutate inputs", () => {
    const parentRow = { id: "e2", title: "Solo" };
    const snapshot = assembleDocument({ parentRow });
    expect(snapshot).toEqual({ id: "e2", title: "Solo" });
    expect(parentRow).toEqual({ id: "e2", title: "Solo" });
    expect(snapshot).not.toBe(parentRow);
  });
});
