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

  it("diffs a many relationship as a target set", () => {
    const diff = computeVersionDiff(
      { tags: ["a", "b"] },
      { tags: ["b", "c"] },
      [field({ name: "tags", type: "relationship", hasMany: true })]
    );
    expect(diff.fields[0]).toMatchObject({
      kind: "set",
      status: "changed",
      added: [{ id: "c" }],
      removed: [{ id: "a" }],
    });
  });

  it("keeps relationTo in a polymorphic relationship's identity", () => {
    // Same id in different collections is a different target, so a change of
    // relationTo must register even when the id is unchanged.
    const diff = computeVersionDiff(
      { ref: [{ relationTo: "posts", value: "1" }] },
      { ref: [{ relationTo: "pages", value: "1" }] },
      [field({ name: "ref", type: "relationship", hasMany: true })]
    );
    expect(diff.fields[0]).toMatchObject({
      kind: "set",
      status: "changed",
      added: [{ id: "1", relationTo: "pages" }],
      removed: [{ id: "1", relationTo: "posts" }],
    });
  });

  it("does not emit duplicate targets for a duplicated stored id", () => {
    const diff = computeVersionDiff({ tags: [] }, { tags: ["a", "a"] }, [
      field({ name: "tags", type: "relationship", hasMany: true }),
    ]);
    const node = diff.fields[0];
    expect(node).toMatchObject({ kind: "set", status: "added" });
    if (node.kind === "set") expect(node.added).toEqual([{ id: "a" }]);
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

describe("computeVersionDiff — never leaks a password", () => {
  it("masks a bcrypt hash left by a password field deleted from the schema", () => {
    // The `legacy` field no longer exists in the schema, so its stored hash
    // surfaces as an unknown key; it must be masked rather than exposed.
    const hashA = "$2b$12$" + "a".repeat(53);
    const hashB = "$2b$12$" + "b".repeat(53);
    const diff = computeVersionDiff({ legacy: hashA }, { legacy: hashB }, []);
    const node = diff.fields.find(n => n.name === "legacy");
    // The change is surfaced, but neither hash is exposed.
    expect(node).toMatchObject({ kind: "unknown", status: "changed" });
    if (node && node.kind === "unknown") {
      expect(node.before).toBe("[protected]");
      expect(node.after).toBe("[protected]");
    }
  });
});

describe("computeVersionDiff — read-denied fields", () => {
  it("omits a field redaction removed from both snapshots", () => {
    // Redaction deletes a read-denied field's key; the diff must not reintroduce
    // it as an empty node the way it renders a genuinely-empty field.
    const fields = [
      field({ name: "title", type: "text" }),
      field({ name: "salary", type: "number" }),
    ];
    const diff = computeVersionDiff({ title: "t" }, { title: "t" }, fields);
    expect(diff.fields.find(n => n.name === "salary")).toBeUndefined();
    // A genuinely-empty field keeps its (null) key and still renders.
    const withEmpty = computeVersionDiff(
      { title: "t", salary: null },
      { title: "t", salary: null },
      fields
    );
    expect(withEmpty.fields.find(n => n.name === "salary")).toBeDefined();
  });
});

describe("computeVersionDiff — components", () => {
  it("treats a non-repeatable dynamic zone as a single value, not a list", () => {
    const field_ = field({
      name: "hero",
      type: "component",
      components: ["banner"],
      componentSchemas: {
        banner: { fields: [field({ name: "heading", type: "text" })] },
      },
    });
    const diff = computeVersionDiff(
      { hero: { id: "c1", _componentType: "banner", heading: "Old" } },
      { hero: { id: "c1", _componentType: "banner", heading: "New" } },
      [field_]
    );
    const node = diff.fields[0];
    expect(node.kind).toBe("group");
    expect(node.status).toBe("changed");
    if (node.kind === "group") {
      expect(node.fields.find(n => n.name === "heading")?.status).toBe(
        "changed"
      );
    }
  });

  it("marks a matched list item whose component type changed", () => {
    const layout = field({
      name: "layout",
      type: "component",
      components: ["hero", "cta"],
      repeatable: true,
      componentSchemas: {
        hero: { fields: [field({ name: "label", type: "text" })] },
        cta: { fields: [field({ name: "label", type: "text" })] },
      },
    });
    // Same stable id, different component type, coincidentally equal field value.
    const diff = computeVersionDiff(
      { layout: [{ id: "1", _componentType: "hero", label: "Go" }] },
      { layout: [{ id: "1", _componentType: "cta", label: "Go" }] },
      [layout]
    );
    const list = diff.fields[0];
    if (list.kind === "list") {
      expect(list.items[0].status).toBe("changed");
    }
  });

  it("surfaces an unknown key removed from a nested group", () => {
    // Only the removed nested child differs; without recursive unknown-key
    // detection the parent would look unchanged and hasChanges would be false.
    const fields = [
      field({
        name: "seo",
        type: "group",
        fields: [field({ name: "title", type: "text" })],
      }),
    ];
    const diff = computeVersionDiff(
      { seo: { title: "same", legacyKeyword: "old" } },
      { seo: { title: "same", legacyKeyword: "new" } },
      fields
    );
    expect(diff.hasChanges).toBe(true);
    const group = diff.fields[0];
    if (group.kind === "group") {
      expect(group.fields.find(n => n.name === "legacyKeyword")?.status).toBe(
        "changed"
      );
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
