/**
 * Naming in a comparison: every field is labelled as the editor labels it,
 * with its place among containers, and a field the reader cannot see or that
 * no longer exists says which.
 */
import { describe, expect, it } from "vitest";

import type { FieldConfig } from "../../../../collections/fields/types";
import { computeVersionDiff } from "../compute-diff";
import type { FieldDiff } from "../types";

/** Loose field fixture: the engine reads structurally, so a plain shape is enough. */
function field(def: Record<string, unknown>): FieldConfig {
  return def as unknown as FieldConfig;
}

function find(nodes: FieldDiff[], name: string): FieldDiff {
  const node = nodes.find(n => n.name === name);
  if (!node) throw new Error(`no node named ${name}`);
  return node;
}

function children(node: FieldDiff): FieldDiff[] {
  if (node.kind !== "group") throw new Error(`${node.name} is not a group`);
  return node.fields;
}

describe("computeVersionDiff — labels", () => {
  it("gives a field's own label, and marks a field that declares none", () => {
    const diff = computeVersionDiff(
      { metaTitle: "A", excerpt: "x", blurb: "p" },
      { metaTitle: "B", excerpt: "y", blurb: "q" },
      [
        field({ name: "metaTitle", type: "text", label: "Meta title" }),
        field({ name: "excerpt", type: "text" }),
        // A blank label names nothing, so it is no label at all.
        field({ name: "blurb", type: "text", label: "  " }),
      ]
    );

    expect(find(diff.fields, "metaTitle")).toMatchObject({
      declaredLabel: "Meta title",
    });
    expect(find(diff.fields, "excerpt")).toMatchObject({ declaredLabel: null });
    expect(find(diff.fields, "blurb")).toMatchObject({ declaredLabel: null });
  });
});

describe("computeVersionDiff — paths through containers", () => {
  it("leaves a top-level field's path empty", () => {
    const diff = computeVersionDiff({ title: "A" }, { title: "B" }, [
      field({ name: "title", type: "text" }),
    ]);
    expect(find(diff.fields, "title")).toMatchObject({ path: [] });
  });

  it("places a field inside a named group under that group", () => {
    const diff = computeVersionDiff(
      { seo: { metaTitle: "A" } },
      { seo: { metaTitle: "B" } },
      [
        field({
          name: "seo",
          type: "group",
          label: "SEO",
          fields: [field({ name: "metaTitle", type: "text" })],
        }),
      ]
    );
    const seo = find(diff.fields, "seo");
    expect(seo).toMatchObject({ path: [] });
    expect(find(children(seo), "metaTitle")).toMatchObject({
      path: [{ name: "seo", declaredLabel: "SEO", type: "group" }],
    });
  });

  it("keeps the heading of a group that has no name", () => {
    // A nameless group's fields are stored on the document itself, so they
    // diff at the top level; their heading must not be lost on the way.
    const diff = computeVersionDiff({ metaTitle: "A" }, { metaTitle: "B" }, [
      field({
        type: "group",
        label: "SEO",
        fields: [field({ name: "metaTitle", type: "text" })],
      }),
    ]);
    expect(find(diff.fields, "metaTitle")).toMatchObject({
      path: [{ name: null, declaredLabel: "SEO", type: "group" }],
    });
  });

  it("adds no heading for a group with neither a name nor a label", () => {
    const diff = computeVersionDiff({ metaTitle: "A" }, { metaTitle: "B" }, [
      field({
        type: "group",
        fields: [field({ name: "metaTitle", type: "text" })],
      }),
    ]);
    expect(find(diff.fields, "metaTitle")).toMatchObject({ path: [] });
  });

  it("stacks headings through nested containers", () => {
    const diff = computeVersionDiff(
      { seo: { robots: "index" } },
      { seo: { robots: "noindex" } },
      [
        field({
          name: "seo",
          type: "group",
          label: "SEO",
          fields: [
            field({
              type: "group",
              label: "Advanced",
              fields: [field({ name: "robots", type: "text" })],
            }),
          ],
        }),
      ]
    );
    expect(find(children(find(diff.fields, "seo")), "robots")).toMatchObject({
      path: [
        { name: "seo", declaredLabel: "SEO", type: "group" },
        { name: null, declaredLabel: "Advanced", type: "group" },
      ],
    });
  });

  it("places a field inside repeater rows under the repeater", () => {
    const diff = computeVersionDiff(
      { links: [{ id: "r1", url: "/a" }] },
      { links: [{ id: "r1", url: "/b" }] },
      [
        field({
          name: "links",
          type: "repeater",
          label: "Links",
          fields: [field({ name: "url", type: "text" })],
        }),
      ]
    );
    const links = find(diff.fields, "links");
    if (links.kind !== "list") throw new Error("links is not a list");
    expect(find(links.items[0].fields, "url")).toMatchObject({
      path: [{ name: "links", declaredLabel: "Links", type: "repeater" }],
    });
  });

  it("places a field inside a single component under the component", () => {
    const diff = computeVersionDiff(
      { hero: { id: "c1", heading: "A" } },
      { hero: { id: "c1", heading: "B" } },
      [
        field({
          name: "hero",
          type: "component",
          component: "hero",
          componentFields: [field({ name: "heading", type: "text" })],
        }),
      ]
    );
    expect(find(children(find(diff.fields, "hero")), "heading")).toMatchObject({
      path: [{ name: "hero", declaredLabel: null, type: "component" }],
    });
  });
});

describe("computeVersionDiff — fields the reader cannot see, and fields that are gone", () => {
  it("marks a field withheld from the reader in its place, with no values", () => {
    // Redaction removed `notes` from both snapshots before the engine ran.
    const diff = computeVersionDiff(
      { title: "A" },
      { title: "B" },
      [
        field({ name: "title", type: "text" }),
        field({ name: "notes", type: "textarea", label: "Internal notes" }),
      ],
      { withheld: new Set(["notes"]) }
    );

    expect(diff.fields.map(n => n.name)).toEqual(["title", "notes"]);
    const notes = find(diff.fields, "notes");
    expect(notes).toEqual({
      kind: "hidden",
      reason: "no-access",
      name: "notes",
      label: "Internal notes",
      declaredLabel: "Internal notes",
      type: "textarea",
      status: "unchanged",
      path: [],
    });
  });

  it("hides a field withheld from one version only, sending neither side", () => {
    // A rule that reads the document can deny one version and allow the
    // other; diffing the readable side would still say the field came or went.
    const diff = computeVersionDiff(
      { title: "A", notes: "visible then" },
      { title: "A" },
      [
        field({ name: "title", type: "text" }),
        field({ name: "notes", type: "textarea" }),
      ],
      { withheld: new Set(["notes"]) }
    );
    expect(find(diff.fields, "notes")).toMatchObject({
      kind: "hidden",
      status: "unchanged",
    });
    expect(JSON.stringify(diff)).not.toContain("visible then");
  });

  it("says a comparison is incomplete when fields were withheld, never that nothing changed", () => {
    const fields = [
      field({ name: "title", type: "text" }),
      field({ name: "notes", type: "textarea" }),
    ];
    const withheld = new Set(["notes"]);

    const full = computeVersionDiff({ title: "A" }, { title: "A" }, fields, {
      withheld,
    });
    expect(full).toMatchObject({ hasChanges: false, incomplete: true });

    // A changes-only comparison returns changed nodes only; the hidden field,
    // whose change cannot be known, is carried by `incomplete` instead.
    const changedOnly = computeVersionDiff(
      { title: "A" },
      { title: "A" },
      fields,
      { withheld, modifiedOnly: true }
    );
    expect(changedOnly).toMatchObject({
      hasChanges: false,
      incomplete: true,
      fields: [],
    });
  });

  it("is complete when nothing was withheld", () => {
    const diff = computeVersionDiff({ title: "A" }, { title: "B" }, [
      field({ name: "title", type: "text" }),
    ]);
    expect(diff.incomplete).toBe(false);
  });

  it("says a framework column is a system field, not a removed one", () => {
    const diff = computeVersionDiff(
      { title: "A", firstPublishedAt: "2026-10-01T00:00:00.000Z" },
      { title: "A", firstPublishedAt: "2026-10-02T00:00:00.000Z" },
      [field({ name: "title", type: "text" })]
    );
    expect(find(diff.fields, "firstPublishedAt")).toMatchObject({
      kind: "unknown",
      reason: "system",
    });
  });

  it("lists fields no longer in the content type last, after system fields", () => {
    const diff = computeVersionDiff(
      { legacy: 1, title: "A", firstPublishedAt: "x" },
      { legacy: 2, title: "B", firstPublishedAt: "y" },
      [field({ name: "title", type: "text" })]
    );
    expect(diff.fields.map(n => [n.name, n.kind])).toEqual([
      ["title", "text"],
      ["firstPublishedAt", "unknown"],
      ["legacy", "unknown"],
    ]);
    expect(find(diff.fields, "legacy")).toMatchObject({
      reason: "removed",
      path: [],
    });
  });

  it("judges system columns by the kind of document compared", () => {
    // A Single has no owner column, so `created_by` there is a field someone
    // declared and later removed.
    const before = { title: "A", created_by: "u1" };
    const after = { title: "A", created_by: "u2" };
    const fields = [field({ name: "title", type: "text" })];

    expect(
      find(
        computeVersionDiff(before, after, fields, { entity: "single" }).fields,
        "created_by"
      )
    ).toMatchObject({ reason: "removed" });
    expect(
      find(
        computeVersionDiff(before, after, fields, { entity: "collection" })
          .fields,
        "created_by"
      )
    ).toMatchObject({ reason: "system" });
  });

  it("treats a framework column's name inside a group as a removed field", () => {
    // Framework columns live on the document only; inside a group the same
    // name is something an editor wrote and has since been removed.
    const diff = computeVersionDiff(
      { seo: { firstPublishedAt: "x" } },
      { seo: { firstPublishedAt: "y" } },
      [field({ name: "seo", type: "group", fields: [] })]
    );
    expect(
      find(children(find(diff.fields, "seo")), "firstPublishedAt")
    ).toMatchObject({
      reason: "removed",
      path: [{ name: "seo", declaredLabel: null, type: "group" }],
    });
  });
});

describe("computeVersionDiff — framework keys by kind of document", () => {
  it("leaves a collection's owner column out, and shows a Single's former createdBy field", () => {
    // Undeclared on both: a collection's createdBy is its owner column; a
    // Single has none, so the key is a field it declared and later removed.
    const single = computeVersionDiff(
      { createdBy: "Ana" },
      { createdBy: "Ben" },
      [],
      { entity: "single" }
    );
    expect(find(single.fields, "createdBy")).toMatchObject({
      kind: "unknown",
      reason: "removed",
    });
    const collection = computeVersionDiff(
      { createdBy: "u1" },
      { createdBy: "u2" },
      [],
      { entity: "collection" }
    );
    expect(collection.fields.find(n => n.name === "createdBy")).toBeUndefined();
  });
});
