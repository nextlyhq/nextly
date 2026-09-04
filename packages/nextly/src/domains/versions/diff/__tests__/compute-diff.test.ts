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

  it("carries display config on a value node for faithful client rendering", () => {
    const diff = computeVersionDiff(
      { scores: [1, 2], state: "draft" },
      { scores: [1, 2, 3], state: "pub" },
      [
        field({ name: "scores", type: "number", hasMany: true }),
        field({
          name: "state",
          type: "select",
          options: [
            { label: "Draft", value: "draft" },
            { label: "Published", value: "pub" },
          ],
        }),
      ]
    );
    expect(diff.fields.find(f => f.name === "scores")).toMatchObject({
      kind: "value",
      display: { hasMany: true },
    });
    expect(diff.fields.find(f => f.name === "state")).toMatchObject({
      kind: "value",
      display: {
        options: [
          { label: "Draft", value: "draft" },
          { label: "Published", value: "pub" },
        ],
      },
    });
  });

  it("omits display config when a field has none", () => {
    const diff = computeVersionDiff({ views: 1 }, { views: 2 }, [
      field({ name: "views", type: "number" }),
    ]);
    const node = diff.fields[0];
    expect(node.kind).toBe("value");
    if (node.kind === "value") expect(node.display).toBeUndefined();
  });

  it("carries the component type transition on a dynamic-zone swap", () => {
    const zone = field({
      name: "block",
      type: "component",
      components: ["hero", "cta"],
      componentSchemas: {
        hero: { fields: [field({ name: "headline", type: "text" })] },
        cta: { fields: [field({ name: "label", type: "text" })] },
      },
    });
    // Both instances carry only their discriminator: no field values to diff, so
    // the type change is the only visible change and must survive on the node.
    const diff = computeVersionDiff(
      { block: { _componentType: "hero" } },
      { block: { _componentType: "cta" } },
      [zone]
    );
    expect(diff.fields[0]).toMatchObject({
      kind: "group",
      status: "changed",
      componentTypeBefore: "hero",
      componentTypeAfter: "cta",
    });
  });

  it("carries the type transition on a repeatable zone item that swaps type", () => {
    const zone = field({
      name: "blocks",
      type: "component",
      repeatable: true,
      components: ["hero", "cta"],
      componentSchemas: {
        hero: { fields: [field({ name: "headline", type: "text" })] },
        cta: { fields: [field({ name: "label", type: "text" })] },
      },
    });
    // Same row id, changed discriminator: the swap must survive on the item.
    const diff = computeVersionDiff(
      { blocks: [{ id: "1", _componentType: "hero" }] },
      { blocks: [{ id: "1", _componentType: "cta" }] },
      [zone]
    );
    const node = diff.fields[0];
    expect(node.kind).toBe("list");
    if (node.kind === "list") {
      expect(node.items[0]).toMatchObject({
        id: "1",
        status: "changed",
        componentTypeBefore: "hero",
        componentTypeAfter: "cta",
      });
    }
  });

  it("classifies a json object-to-null edit as a two-sided change", () => {
    // A stored json `null` is a value, not absence: object -> null is a change,
    // not a removal, even though normalization collapses null the same either way.
    // json now compares as SOURCE LINES rather than as one opaque value, so the
    // reader sees which keys moved; the null classification above is unchanged
    // and is what this test guards.
    const diff = computeVersionDiff({ cfg: { a: 1 } }, { cfg: null }, [
      field({ name: "cfg", type: "json" }),
    ]);
    expect(diff.fields[0]).toMatchObject({ kind: "source", status: "changed" });
  });

  it("classifies an absent-to-json-null edit as added", () => {
    const diff = computeVersionDiff({}, { cfg: null }, [
      field({ name: "cfg", type: "json" }),
    ]);
    expect(diff.fields.find(n => n.name === "cfg")).toMatchObject({
      kind: "source",
      status: "added",
    });
  });

  it("diffs a richText field structurally, not as one opaque value", () => {
    // Comparing two editor documents by equality reports only THAT they
    // differ, which is the one thing the reader already knows.
    const doc = (body: string) => ({
      root: {
        type: "root",
        version: 1,
        format: "",
        indent: 0,
        direction: "ltr",
        children: [
          {
            type: "paragraph",
            version: 1,
            format: "",
            indent: 0,
            direction: "ltr",
            children: [
              {
                type: "text",
                version: 1,
                text: body,
                format: 0,
                detail: 0,
                mode: "normal",
                style: "",
              },
            ],
          },
        ],
      },
    });
    const diff = computeVersionDiff({ body: doc("a") }, { body: doc("b") }, [
      field({ name: "body", type: "richText" }),
    ]);
    const node = diff.fields[0];
    expect(node).toMatchObject({ kind: "richText", status: "changed" });
    if (node.kind === "richText") {
      expect(node.blocks[0]?.status).toBe("changed");
      expect(node.blocks[0]?.segments?.length).toBeGreaterThan(0);
    }
  });

  it("diffs a code field as source lines rather than as one word-diffed string", () => {
    // `code` used to sit in TEXT_TYPES, which rendered the comparison as a
    // proportional, word-wrapped paragraph — less readable than viewing the
    // version. It is now line-oriented and carries its language.
    const diff = computeVersionDiff(
      { snippet: "const a = 1;\nconst b = 2;" },
      { snippet: "const a = 1;\nconst b = 3;" },
      [field({ name: "snippet", type: "code" })]
    );
    const node = diff.fields[0];
    expect(node).toMatchObject({ kind: "source", status: "changed" });
    if (node.kind === "source") {
      // No declared language, so the field type's own documented default.
      expect(node.language).toBe("plaintext");
      expect(node.lines.filter(l => l.status !== "unchanged")).toHaveLength(1);
    }
  });

  it("carries a code field's declared language into the comparison", () => {
    // `SourceFieldDiff.language` exists so a renderer can choose a grammar.
    // Emitting a literal "code" named a language no highlighter knows, which
    // left the configured one unreachable for exactly the fields that set it.
    //
    // The language sits under `admin`, which is where the field type declares
    // it and where the field's own editor reads it. An earlier fixture put it
    // at the top level — a shape no real config has — so this test passed
    // against an engine that read the wrong place and rendered every correctly
    // configured code field as plain text.
    const diff = computeVersionDiff(
      { snippet: "select 1" },
      { snippet: "select 2" },
      [field({ name: "snippet", type: "code", admin: { language: "sql" } })]
    );
    const node = diff.fields[0];
    if (node.kind === "source") expect(node.language).toBe("sql");
    else throw new Error("expected a source node");
  });

  it("ignores a language written where the config does not declare one", () => {
    // The control for the fixture above: reading a top-level `language` must
    // NOT work, or the test cannot tell the two accessors apart.
    const diff = computeVersionDiff(
      { snippet: "select 1" },
      { snippet: "select 2" },
      [field({ name: "snippet", type: "code", language: "sql" })]
    );
    const node = diff.fields[0];
    if (node.kind === "source") expect(node.language).toBe("plaintext");
    else throw new Error("expected a source node");
  });

  it("does not report a json key reordering as a change", () => {
    const diff = computeVersionDiff(
      { cfg: { a: 1, b: 2 } },
      { cfg: { b: 2, a: 1 } },
      [field({ name: "cfg", type: "json" })]
    );
    expect(diff.hasChanges).toBe(false);
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

  // A migrated definition stores both the type token and the zone whitelist
  // under the fieldGroup spellings. Reading only the legacy keys would treat
  // this zone as a single-schema field and drop its nested values from the
  // diff entirely, so these cases pin the nested diff itself, not just the
  // node kind.
  it("diffs a migrated non-repeatable fieldGroups zone through its instance schema", () => {
    const zone = field({
      name: "layout",
      type: "fieldGroup",
      fieldGroups: ["hero", "cta"],
      componentSchemas: {
        hero: { fields: [field({ name: "heading", type: "text" })] },
        cta: { fields: [field({ name: "label", type: "text" })] },
      },
    });
    // Populated from its own table, a non-repeatable zone arrives as a
    // one-element array; normalization unwraps the instance.
    const diff = computeVersionDiff(
      { layout: [{ _fieldGroupType: "hero", heading: "Hi" }] },
      { layout: [{ _fieldGroupType: "hero", heading: "Hello" }] },
      [zone]
    );
    const group = diff.fields[0];
    expect(group.kind).toBe("group");
    if (group.kind === "group") {
      // The nested value node itself is the point: the zone's whitelist and
      // its instance type are both stored under migrated spellings, and the
      // heading diffed through the resolved hero schema.
      expect(group.fields.find(n => n.name === "heading")).toMatchObject({
        status: "changed",
      });
    }
  });

  it("diffs a migrated single fieldGroup through its enriched schema", () => {
    const seo = field({
      name: "seo",
      type: "fieldGroup",
      fieldGroup: "seo",
      componentFields: [field({ name: "metaTitle", type: "text" })],
    });
    const diff = computeVersionDiff(
      { seo: [{ metaTitle: "A" }] },
      { seo: [{ metaTitle: "B" }] },
      [seo]
    );
    const group = diff.fields[0];
    expect(group.kind).toBe("group");
    if (group.kind === "group") {
      expect(group.fields.find(n => n.name === "metaTitle")).toMatchObject({
        status: "changed",
      });
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
  it("withholds the value of a field deleted from the schema", () => {
    // The `legacy` field no longer exists in the schema, so its stored value has
    // no verifiable access rule. The change surfaces, but the value is withheld
    // entirely rather than masked, so nothing can leak.
    const hashA = "$2b$12$" + "a".repeat(53);
    const hashB = "$2b$12$" + "b".repeat(53);
    const diff = computeVersionDiff({ legacy: hashA }, { legacy: hashB }, []);
    const node = diff.fields.find(n => n.name === "legacy");
    expect(node).toMatchObject({ kind: "unknown", status: "changed" });
    expect(node).not.toHaveProperty("before");
    expect(node).not.toHaveProperty("after");
  });

  it("withholds the whole value of a component whose type is gone", () => {
    // A dynamic-zone component whose stored type is no longer in the schema is
    // unresolved, so the whole value is withheld like a dropped field.
    const zone = field({
      name: "block",
      type: "component",
      components: ["hero"],
      componentSchemas: {
        hero: { fields: [field({ name: "headline", type: "text" })] },
      },
    });
    const diff = computeVersionDiff(
      { block: { _componentType: "gone", secret: "x" } },
      { block: { _componentType: "gone", secret: "y" } },
      [zone]
    );
    const node = diff.fields.find(n => n.name === "block");
    expect(node?.kind).toBe("unknown");
    expect(node).not.toHaveProperty("before");
    expect(node).not.toHaveProperty("after");
  });

  it("withholds stray values in a resolved but empty container", () => {
    // A group that still resolves but has no fields (its children were deleted)
    // is a real empty container; its stray stored key surfaces as a withheld
    // unknown child rather than exposing the value.
    const emptyGroup = field({ name: "meta", type: "group", fields: [] });
    const diff = computeVersionDiff(
      { meta: { removedChild: "secret-old" } },
      { meta: { removedChild: "secret-new" } },
      [emptyGroup]
    );
    const node = diff.fields.find(n => n.name === "meta");
    expect(node?.kind).toBe("group");
    if (node?.kind === "group") {
      const child = node.fields.find(n => n.name === "removedChild");
      expect(child?.kind).toBe("unknown");
      expect(child).not.toHaveProperty("before");
      expect(child).not.toHaveProperty("after");
    }
  });

  it("shows a valid empty container without a schema-unavailable warning", () => {
    const emptyGroup = field({ name: "meta", type: "group", fields: [] });
    const diff = computeVersionDiff({ meta: {} }, { meta: {} }, [emptyGroup]);
    const node = diff.fields.find(n => n.name === "meta");
    expect(node?.kind).toBe("group");
    if (node?.kind === "group") expect(node.fields).toEqual([]);
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

describe("computeVersionDiff — round-2 hardening", () => {
  it("withholds a value nested inside an opaque removed node", () => {
    const hash = "$2b$12$" + "c".repeat(53);
    // `oldBlock` is absent from the schema, so it surfaces as one opaque unknown
    // node; its value, and any nested secret, is withheld entirely.
    const diff = computeVersionDiff(
      { oldBlock: { id: "1", secret: hash } },
      { oldBlock: { id: "1", secret: hash } },
      []
    );
    const node = diff.fields.find(n => n.name === "oldBlock");
    expect(node?.kind).toBe("unknown");
    expect(node).not.toHaveProperty("before");
    expect(node).not.toHaveProperty("after");
  });

  it("marks a list item that gained a component discriminator", () => {
    const layout = field({
      name: "layout",
      type: "component",
      components: ["hero"],
      repeatable: true,
      componentSchemas: {
        hero: { fields: [field({ name: "label", type: "text" })] },
      },
    });
    const diff = computeVersionDiff(
      { layout: [{ id: "1", label: "Go" }] }, // older row, no discriminator
      { layout: [{ id: "1", _componentType: "hero", label: "Go" }] },
      [layout]
    );
    const list = diff.fields[0];
    if (list.kind === "list") expect(list.items[0].status).toBe("changed");
  });

  it("surfaces a removed field named like a system key at a nested level", () => {
    const fields = [
      field({
        name: "meta",
        type: "group",
        fields: [field({ name: "title", type: "text" })],
      }),
    ];
    // `status` inside the group is not a framework column; removed from the
    // schema, its change must still surface.
    const diff = computeVersionDiff(
      { meta: { title: "same", status: "old" } },
      { meta: { title: "same", status: "new" } },
      fields
    );
    expect(diff.hasChanges).toBe(true);
    const group = diff.fields[0];
    if (group.kind === "group") {
      expect(group.fields.find(n => n.name === "status")?.status).toBe(
        "changed"
      );
    }
  });

  it("still excludes the top-level status framework column", () => {
    const diff = computeVersionDiff(
      { title: "same", status: "draft" },
      { title: "same", status: "published" },
      [field({ name: "title", type: "text" })]
    );
    expect(diff.fields.find(n => n.name === "status")).toBeUndefined();
    expect(diff.hasChanges).toBe(false);
  });

  it("omits a component child that declares a read rule", () => {
    const layout = field({
      name: "layout",
      type: "component",
      components: ["card"],
      repeatable: true,
      componentSchemas: {
        card: {
          fields: [
            field({ name: "title", type: "text" }),
            field({
              name: "secret",
              type: "text",
              access: { read: () => false },
            }),
          ],
        },
      },
    });
    const diff = computeVersionDiff(
      {
        layout: [{ id: "1", _componentType: "card", title: "t", secret: "A" }],
      },
      {
        layout: [{ id: "1", _componentType: "card", title: "t", secret: "B" }],
      },
      [layout]
    );
    const list = diff.fields[0];
    if (list.kind === "list") {
      const item = list.items[0];
      expect(item.fields.find(n => n.name === "secret")).toBeUndefined();
      expect(item.status).toBe("unchanged");
    }
  });

  it("keeps a top-level field declaring a read rule (redaction handles those)", () => {
    const fields = [
      field({ name: "title", type: "text" }),
      field({ name: "gated", type: "text", access: { read: () => true } }),
    ];
    const diff = computeVersionDiff(
      { title: "t", gated: "A" },
      { title: "t", gated: "B" },
      fields
    );
    expect(diff.fields.find(n => n.name === "gated")?.status).toBe("changed");
  });
});

describe("computeVersionDiff — round-3 hardening", () => {
  it("detects a change in a hasMany text field stored as an array", () => {
    const diff = computeVersionDiff({ aliases: ["a"] }, { aliases: ["b"] }, [
      field({ name: "aliases", type: "text", hasMany: true }),
    ]);
    expect(diff.hasChanges).toBe(true);
    expect(diff.fields[0]).toMatchObject({ kind: "value", status: "changed" });
  });

  it("surfaces a removed user field named id inside a plain group", () => {
    const fields = [
      field({
        name: "meta",
        type: "group",
        fields: [field({ name: "title", type: "text" })],
      }),
    ];
    const diff = computeVersionDiff(
      { meta: { title: "same", id: "external-old" } },
      { meta: { title: "same", id: "external-new" } },
      fields
    );
    expect(diff.hasChanges).toBe(true);
    const group = diff.fields[0];
    if (group.kind === "group") {
      expect(group.fields.find(n => n.name === "id")?.status).toBe("changed");
    }
  });

  it("diffs a single dynamic-zone type swap field-by-field, masking secrets", () => {
    const hash = "$2b$12$" + "d".repeat(53);
    const hero = field({
      name: "hero",
      type: "component",
      components: ["a", "b"],
      componentSchemas: {
        a: {
          fields: [
            field({ name: "secret", type: "password" }),
            field({ name: "x", type: "text" }),
          ],
        },
        b: { fields: [field({ name: "y", type: "text" })] },
      },
    });
    const diff = computeVersionDiff(
      { hero: { id: "1", _componentType: "a", secret: hash, x: "hi" } },
      { hero: { id: "1", _componentType: "b", y: "yo" } },
      [hero]
    );
    const node = diff.fields[0];
    // A group diff over the union of both schemas, not a raw object dump.
    expect(node.kind).toBe("group");
    if (node.kind === "group") {
      expect(node.fields.find(n => n.name === "secret")).toBeUndefined();
    }
  });

  it("omits a protected before-type field when a list item changes type", () => {
    const hash = "$2b$12$" + "e".repeat(53);
    const zone = field({
      name: "zone",
      type: "component",
      components: ["a", "b"],
      repeatable: true,
      componentSchemas: {
        a: {
          fields: [
            field({ name: "secret", type: "password" }),
            field({ name: "x", type: "text" }),
          ],
        },
        b: { fields: [field({ name: "y", type: "text" })] },
      },
    });
    const diff = computeVersionDiff(
      { zone: [{ id: "1", _componentType: "a", secret: hash, x: "hi" }] },
      { zone: [{ id: "1", _componentType: "b", y: "yo" }] },
      [zone]
    );
    const list = diff.fields[0];
    if (list.kind === "list") {
      const item = list.items[0];
      expect(item.status).toBe("changed");
      expect(item.fields.find(n => n.name === "secret")).toBeUndefined();
    }
  });
});

describe("computeVersionDiff — round-4 hardening", () => {
  it("marks a single dynamic-zone type swap changed even if field values match", () => {
    const hero = field({
      name: "hero",
      type: "component",
      components: ["a", "b"],
      componentSchemas: {
        a: { fields: [field({ name: "label", type: "text" })] },
        b: { fields: [field({ name: "label", type: "text" })] },
      },
    });
    const diff = computeVersionDiff(
      { hero: { id: "1", _componentType: "a", label: "Go" } },
      { hero: { id: "1", _componentType: "b", label: "Go" } },
      [hero]
    );
    expect(diff.hasChanges).toBe(true);
    expect(diff.fields[0].status).toBe("changed");
  });

  it("diffs a type swap that reuses a field name at a different type per schema", () => {
    const zone = field({
      name: "block",
      type: "component",
      components: ["a", "b"],
      repeatable: true,
      componentSchemas: {
        a: { fields: [field({ name: "content", type: "text" })] },
        b: { fields: [field({ name: "content", type: "richText" })] },
      },
    });
    const diff = computeVersionDiff(
      { block: [{ id: "1", _componentType: "a", content: "hello" }] },
      { block: [{ id: "1", _componentType: "b", content: { rich: true } }] },
      [zone]
    );
    const list = diff.fields[0];
    if (list.kind === "list") {
      const item = list.items[0];
      expect(item.status).toBe("changed");
      const content = item.fields.filter(n => n.name === "content");
      // The old text field is removed and the new richText field added; the two
      // definitions never collide.
      expect(
        content.some(n => n.type === "text" && n.status === "removed")
      ).toBe(true);
      expect(
        content.some(n => n.type === "richText" && n.status === "added")
      ).toBe(true);
    }
  });

  it("reports changed for two different masked secrets in a text field", () => {
    const hashA = "$2b$12$" + "a".repeat(53);
    const hashB = "$2b$12$" + "b".repeat(53);
    const diff = computeVersionDiff({ legacy: hashA }, { legacy: hashB }, [
      field({ name: "legacy", type: "text" }),
    ]);
    const node = diff.fields[0];
    expect(node.status).toBe("changed");
    if (node.kind === "text") {
      expect(node.segments.every(s => !s.text.includes("$2b$"))).toBe(true);
    }
  });
});

describe("computeVersionDiff — round-5 hardening", () => {
  it("surfaces stored values for a list item whose component type is gone", () => {
    // The item was saved under a component type no longer in the schema, so its
    // child schema cannot be resolved; its values must still surface (opaquely)
    // rather than be silently dropped.
    const layout = field({
      name: "layout",
      type: "component",
      components: ["current"],
      repeatable: true,
      componentSchemas: {
        current: { fields: [field({ name: "x", type: "text" })] },
      },
    });
    const diff = computeVersionDiff(
      { layout: [] },
      {
        layout: [
          { id: "1", _componentType: "legacy", heading: "Hi", body: "Yo" },
        ],
      },
      [layout]
    );
    const list = diff.fields[0];
    if (list.kind === "list") {
      const item = list.items[0];
      expect(item.status).toBe("added");
      expect(item.fields.some(n => n.name === "heading")).toBe(true);
      expect(item.fields.some(n => n.name === "body")).toBe(true);
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
