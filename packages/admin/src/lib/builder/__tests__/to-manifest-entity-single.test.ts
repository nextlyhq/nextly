import { describe, expect, it } from "vitest";

import { fieldGroupToManifestEntity } from "../to-manifest-entity-field-group";
import { singleToManifestEntity } from "../to-manifest-entity-single";

describe("singleToManifestEntity", () => {
  it("maps slug + fields into a manifest entity", () => {
    const e = singleToManifestEntity({
      slug: "hero",
      settings: { singularName: "Hero" },
      fields: [{ name: "heading", type: "text", required: true }],
    });
    expect(e.slug).toBe("hero");
    expect(e.fields).toEqual([
      { name: "heading", type: "text", required: true },
    ]);
  });

  it("accepts the widened types (radio with options)", () => {
    const e = singleToManifestEntity({
      slug: "hero",
      settings: {},
      fields: [
        { name: "size", type: "radio", options: [{ label: "S", value: "s" }] },
      ],
    });
    expect(e.fields[0].type).toBe("radio");
    expect(e.fields[0].options).toEqual([{ label: "S", value: "s" }]);
  });

  it("maps nested fields for a repeater", () => {
    const e = singleToManifestEntity({
      slug: "hero",
      settings: {},
      fields: [
        {
          name: "items",
          type: "repeater",
          fields: [{ name: "label", type: "text" }],
        },
      ],
    });
    expect(e.fields[0].fields).toEqual([{ name: "label", type: "text" }]);
  });
});

describe("fieldGroupToManifestEntity", () => {
  it("maps slug + fields into a manifest entity", () => {
    const e = fieldGroupToManifestEntity({
      slug: "card",
      settings: { singularName: "Card" },
      fields: [{ name: "title", type: "text" }],
    });
    expect(e.slug).toBe("card");
    expect(e.fields).toEqual([{ name: "title", type: "text" }]);
  });
});

describe("a description survives a field-group save", () => {
  it("reaches the manifest entity", () => {
    // 🔴 The migration's upsert writes this column unconditionally so that
    // clearing a description propagates, so a manifest omitting it does not
    // leave the deployed value alone — it replaces it with NULL. The field-group
    // projections pass their settings inline, so the mapper carrying it is only
    // half the fix; the call sites have to send it.
    const entity = fieldGroupToManifestEntity({
      slug: "seo",
      settings: { singularName: "SEO", description: "Search metadata" },
      fields: [],
    });
    expect(entity.description).toBe("Search metadata");
  });

  it("leaves the key absent when there is none", () => {
    // The control against a mapper that always sets it, which would serialise a
    // present-but-empty key into the manifest.
    const entity = fieldGroupToManifestEntity({
      slug: "seo",
      settings: { singularName: "SEO" },
      fields: [],
    });
    expect("description" in entity).toBe(false);
  });
});
