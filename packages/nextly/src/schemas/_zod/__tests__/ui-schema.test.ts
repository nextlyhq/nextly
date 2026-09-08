import { describe, expect, it } from "vitest";

import { uiSchemaManifest, UI_FIELD_TYPES } from "../ui-schema";

function manifestWith(field: Record<string, unknown>) {
  return {
    version: 1 as const,
    collections: [{ slug: "posts", fields: [field] }],
    singles: [],
    components: [],
  };
}

describe("ui-schema field types (widened set)", () => {
  it("UI_FIELD_TYPES includes the canonical set", () => {
    for (const t of [
      "text",
      "textarea",
      "richText",
      "number",
      "checkbox",
      "date",
      "select",
      "relationship",
      "upload",
      "email",
      "password",
      "code",
      "radio",
      "repeater",
      "group",
      "component",
      "json",
      "chips",
    ]) {
      expect(UI_FIELD_TYPES as readonly string[]).toContain(t);
    }
  });

  it("accepts an email field", () => {
    expect(
      uiSchemaManifest.safeParse(
        manifestWith({ name: "contact", type: "email" })
      ).success
    ).toBe(true);
  });

  it("accepts a radio field with options", () => {
    expect(
      uiSchemaManifest.safeParse(
        manifestWith({
          name: "size",
          type: "radio",
          options: [
            { label: "S", value: "s" },
            { label: "L", value: "l" },
          ],
        })
      ).success
    ).toBe(true);
  });

  it("rejects a radio field without options", () => {
    expect(
      uiSchemaManifest.safeParse(manifestWith({ name: "size", type: "radio" }))
        .success
    ).toBe(false);
  });

  it("accepts a toggle field with a boolean default", () => {
    expect(
      uiSchemaManifest.safeParse(
        manifestWith({ name: "is_active", type: "toggle", defaultValue: true })
      ).success
    ).toBe(true);
  });

  it("losslessly round-trips a fully-configured field", () => {
    const field = {
      name: "cover",
      type: "relationship",
      label: "Cover",
      required: true,
      unique: true,
      index: true,
      hasMany: true,
      relationTo: ["media", "documents"],
      maxDepth: 2,
      allowCreate: true,
      allowEdit: false,
      isSortable: true,
      relationshipFilter: { field: "status", equals: "published" },
      validation: {
        minLength: 1,
        maxLength: 50,
        min: 0,
        max: 10,
        minRows: 1,
        maxRows: 5,
        pattern: "^[a-z]+$",
        message: "letters only",
      },
      admin: {
        width: "50%",
        position: "sidebar",
        readOnly: false,
        hidden: false,
        description: "help",
        placeholder: "pick",
        hideGutter: true,
        allowCreate: true,
        condition: { field: "other", operator: "equals", value: "x" },
      },
    };
    const r = uiSchemaManifest.safeParse(manifestWith(field));
    expect(r.success).toBe(true);
    const out = r.success ? r.data.collections[0].fields[0] : undefined;
    expect(out).toMatchObject({
      label: "Cover",
      unique: true,
      index: true,
      relationTo: ["media", "documents"],
      validation: { minLength: 1, maxLength: 50, message: "letters only" },
      admin: { width: "50%", hideGutter: true },
    });
  });

  it("rejects an empty relationTo array for a relationship", () => {
    expect(
      uiSchemaManifest.safeParse(
        manifestWith({ name: "r", type: "relationship", relationTo: [] })
      ).success
    ).toBe(false);
  });

  it("rejects minLength greater than maxLength", () => {
    expect(
      uiSchemaManifest.safeParse(
        manifestWith({
          name: "t",
          type: "text",
          validation: { minLength: 5, maxLength: 2 },
        })
      ).success
    ).toBe(false);
  });

  it("accepts a repeater field with nested fields", () => {
    expect(
      uiSchemaManifest.safeParse(
        manifestWith({
          name: "items",
          type: "repeater",
          fields: [{ name: "label", type: "text" }],
        })
      ).success
    ).toBe(true);
  });

  it("rejects a repeater field with no nested fields", () => {
    expect(
      uiSchemaManifest.safeParse(
        manifestWith({ name: "items", type: "repeater" })
      ).success
    ).toBe(false);
  });

  it("still accepts the original 9-type manifest (no regression)", () => {
    expect(
      uiSchemaManifest.safeParse(
        manifestWith({ name: "headline", type: "text", required: true })
      ).success
    ).toBe(true);
  });

  // The migrated reference keys must be DECLARED on the field object, not
  // merely tolerated: an undeclared key is stripped before any refinement
  // runs, so a manifest the storage migration wrote would fail the
  // exactly-one-reference check with both references reading as absent.
  it("accepts a fieldGroup field carrying the migrated singular reference", () => {
    const result = uiSchemaManifest.safeParse(
      manifestWith({ name: "seo", type: "fieldGroup", fieldGroup: "seo" })
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.collections[0].fields[0].fieldGroup).toBe("seo");
    }
  });

  it("accepts a fieldGroup field carrying the migrated plural reference", () => {
    const result = uiSchemaManifest.safeParse(
      manifestWith({
        name: "layout",
        type: "fieldGroup",
        fieldGroups: ["hero", "cta"],
      })
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.collections[0].fields[0].fieldGroups).toEqual([
        "hero",
        "cta",
      ]);
    }
  });

  it("still rejects a migrated fieldGroup field with no reference at all", () => {
    expect(
      uiSchemaManifest.safeParse(
        manifestWith({ name: "seo", type: "fieldGroup" })
      ).success
    ).toBe(false);
  });

  it("rejects two aliases of one reference shape instead of preferring the legacy value", () => {
    // The code-first validator rejects this exact input as a conflict: the
    // manifest boundary must agree, or validity would depend on which
    // schema reads the field and one reference could be silently discarded
    // on a round trip.
    const result = uiSchemaManifest.safeParse(
      manifestWith({
        name: "seo",
        type: "fieldGroup",
        component: "seo",
        fieldGroup: "other",
      })
    );
    expect(result.success).toBe(false);
  });
});

// The owner column (`created_by`) is injected only on collection tables, so the
// manifest schema reserves that field name for collections alone — singles are a
// single global row and components embed in JSON, so neither carries the column
// and both may define `created_by` freely.
describe("ui-schema manifest owner-column reservation (collections only)", () => {
  // Build a full manifest (all three top-level kind arrays present) with the
  // created_by field placed only on the target kind, so a parse failure can be
  // attributed to the reservation and not to a missing manifest-shape array.
  const withField = (kind: "collections" | "singles" | "components") => ({
    version: 1 as const,
    collections: [],
    singles: [],
    components: [],
    [kind]: [
      {
        slug: "x",
        fields: [{ name: "created_by", type: "text" }],
      },
    ],
  });

  it("rejects a created_by field on a collection with a reserved-field error", () => {
    const r = uiSchemaManifest.safeParse(withField("collections"));
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(
        r.error.issues.some(i => /'created_by' is reserved/.test(i.message))
      ).toBe(true);
    }
  });

  it("allows a created_by field on a single (no owner column there)", () => {
    expect(uiSchemaManifest.safeParse(withField("singles")).success).toBe(true);
  });

  it("allows a created_by field on a component", () => {
    expect(uiSchemaManifest.safeParse(withField("components")).success).toBe(
      true
    );
  });
});
