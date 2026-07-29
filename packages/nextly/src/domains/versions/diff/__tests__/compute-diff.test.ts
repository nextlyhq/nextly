/**
 * Guards the diff engine. Covers each field kind, the false-positive batch that
 * proves equal content never diffs, the move-detection differentiator, and the
 * hard rule that a password is never surfaced at any depth.
 */
import { describe, expect, it } from "vitest";

import type { FieldConfig } from "../../../../collections/fields/types";
import { computeVersionDiff } from "../compute-diff";

/** Loose field fixture: the engine reads structurally, so a plain shape is enough. */
function field(def: Record<string, unknown>): FieldConfig {
  return def as unknown as FieldConfig;
}

describe("computeVersionDiff — per field kind", () => {
  it("diffs a scalar as before/after values", () => {
    const diff = computeVersionDiff({ views: 1 }, { views: 2 }, [
      field({ name: "views", type: "number" }),
    ]);
    expect(diff.hasChanges).toBe(true);
    expect(diff.fields[0]).toMatchObject({
      kind: "value",
      name: "views",
      status: "changed",
      before: 1,
      after: 2,
    });
  });

  it("diffs a text field into word segments", () => {
    const diff = computeVersionDiff(
      { title: "hello world" },
      { title: "hello there" },
      [field({ name: "title", type: "text" })]
    );
    const node = diff.fields[0];
    expect(node.kind).toBe("text");
    expect(node.status).toBe("changed");
    if (node.kind === "text") {
      expect(node.segments.some(s => s.op === -1)).toBe(true);
      expect(node.segments.some(s => s.op === 1)).toBe(true);
    }
  });

  it("recurses a group and marks only the changed child", () => {
    const fields = [
      field({
        name: "seo",
        type: "group",
        fields: [
          field({ name: "title", type: "text" }),
          field({ name: "desc", type: "text" }),
        ],
      }),
    ];
    const diff = computeVersionDiff(
      { seo: { title: "A", desc: "same" } },
      { seo: { title: "B", desc: "same" } },
      fields
    );
    const group = diff.fields[0];
    expect(group.kind).toBe("group");
    expect(group.status).toBe("changed");
    if (group.kind === "group") {
      expect(group.fields.find(n => n.name === "title")?.status).toBe(
        "changed"
      );
      expect(group.fields.find(n => n.name === "desc")?.status).toBe(
        "unchanged"
      );
    }
  });

  it("diffs a dynamic-zone list: add, edit+move, and pure move", () => {
    const layout = field({
      name: "layout",
      type: "component",
      components: ["hero", "cta"],
      repeatable: true,
      componentSchemas: {
        hero: { fields: [field({ name: "heading", type: "text" })] },
        cta: { fields: [field({ name: "label", type: "text" })] },
      },
    });
    const before = {
      layout: [
        { id: "1", _componentType: "hero", heading: "Hi" },
        { id: "2", _componentType: "cta", label: "Go" },
      ],
    };
    const after = {
      layout: [
        { id: "2", _componentType: "cta", label: "Go" },
        { id: "1", _componentType: "hero", heading: "Hello" },
        { id: "3", _componentType: "hero", heading: "New" },
      ],
    };
    const diff = computeVersionDiff(before, after, [layout]);
    const list = diff.fields[0];
    expect(list.kind).toBe("list");
    if (list.kind === "list") {
      const one = list.items.find(i => i.id === "1");
      const two = list.items.find(i => i.id === "2");
      const three = list.items.find(i => i.id === "3");
      // Edited AND moved: content changed, position changed.
      expect(one).toMatchObject({ status: "changed", hasMoved: true });
      // Pure move: identity kept, content identical.
      expect(two).toMatchObject({ status: "unchanged", hasMoved: true });
      // New row is the only addition — nothing around it is marked changed.
      expect(three?.status).toBe("added");
    }
  });

  it("diffs a many relationship as an id set", () => {
    const diff = computeVersionDiff(
      { tags: ["a", "b"] },
      { tags: ["b", "c"] },
      [field({ name: "tags", type: "relationship", hasMany: true })]
    );
    expect(diff.fields[0]).toMatchObject({
      kind: "set",
      status: "changed",
      added: ["c"],
      removed: ["a"],
    });
  });

  it("surfaces a snapshot field absent from the current schema", () => {
    const diff = computeVersionDiff({ retired: "x" }, { retired: "y" }, []);
    expect(diff.fields[0]).toMatchObject({
      kind: "unknown",
      name: "retired",
      status: "changed",
    });
  });
});

describe("computeVersionDiff — no false positives", () => {
  it("treats a JSON string and a parsed array as equal", () => {
    const diff = computeVersionDiff(
      { tags: '["a","b"]' },
      { tags: ["a", "b"] },
      [field({ name: "tags", type: "chips" })]
    );
    expect(diff.hasChanges).toBe(false);
  });

  it("treats every boolean encoding as equal", () => {
    const diff = computeVersionDiff({ on: 1 }, { on: true }, [
      field({ name: "on", type: "checkbox" }),
    ]);
    expect(diff.hasChanges).toBe(false);
  });

  it("treats empty string and null as the same absence", () => {
    const diff = computeVersionDiff({ note: "" }, { note: null }, [
      field({ name: "note", type: "text" }),
    ]);
    expect(diff.hasChanges).toBe(false);
  });

  it("ignores object key order inside a group", () => {
    const fields = [
      field({
        name: "g",
        type: "group",
        fields: [
          field({ name: "a", type: "text" }),
          field({ name: "b", type: "text" }),
        ],
      }),
    ];
    const diff = computeVersionDiff(
      { g: { a: "1", b: "2" } },
      { g: { b: "2", a: "1" } },
      fields
    );
    expect(diff.hasChanges).toBe(false);
  });
});

describe("computeVersionDiff — never leaks a password", () => {
  it("omits a top-level password even when its stored value changed", () => {
    const fields = [
      field({ name: "title", type: "text" }),
      field({ name: "secret", type: "password" }),
    ];
    const diff = computeVersionDiff(
      { title: "t", secret: "HASH_A" },
      { title: "t", secret: "HASH_B" },
      fields
    );
    expect(diff.fields.find(n => n.name === "secret")).toBeUndefined();
    expect(diff.hasChanges).toBe(false);
  });

  it("omits a password nested inside a component/group", () => {
    const fields = [
      field({
        name: "account",
        type: "group",
        fields: [
          field({ name: "username", type: "text" }),
          field({ name: "pin", type: "password" }),
        ],
      }),
    ];
    const diff = computeVersionDiff(
      { account: { username: "u", pin: "HASH_A" } },
      { account: { username: "u", pin: "HASH_B" } },
      fields
    );
    const group = diff.fields[0];
    expect(group.status).toBe("unchanged");
    if (group.kind === "group") {
      expect(group.fields.find(n => n.name === "pin")).toBeUndefined();
    }
  });
});

describe("computeVersionDiff — modifiedOnly", () => {
  it("drops unchanged nodes when asked", () => {
    const fields = [
      field({ name: "a", type: "text" }),
      field({ name: "b", type: "text" }),
    ];
    const diff = computeVersionDiff(
      { a: "1", b: "same" },
      { a: "2", b: "same" },
      fields,
      { modifiedOnly: true }
    );
    expect(diff.fields).toHaveLength(1);
    expect(diff.fields[0].name).toBe("a");
  });
});
