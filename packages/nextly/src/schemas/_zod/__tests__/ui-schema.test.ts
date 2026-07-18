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
});

describe("ui-schema manifest owner-column reservation (collections only)", () => {
  const withField = (kind: "collections" | "singles" | "components") => ({
    version: 1 as const,
    [kind]: [
      {
        slug: "x",
        fields: [{ name: "created_by", type: "text" }],
      },
    ],
  });

  it("rejects a created_by field on a collection", () => {
    const r = uiSchemaManifest.safeParse(withField("collections"));
    expect(r.success).toBe(false);
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
