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
