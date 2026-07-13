// i18n M7: the schema builder's Localized flags must survive serialization end-to-end —
// per-field advanced.localized and the collection-level i18n toggle.

import { describe, it, expect } from "vitest";

import type { BuilderField } from "../../../components/features/schema-builder/types";
import { convertToFieldDefinition } from "../field-transformers";
import { collectionEntityFromSettings } from "../settings-to-manifest";
import { mapBuilderFieldToManifest } from "../to-manifest-entity";

const field = (over: Partial<BuilderField> = {}): BuilderField => ({
  id: "f1",
  name: "heading",
  label: "Heading",
  type: "text",
  isSystem: false,
  validation: {},
  admin: { width: "100%" },
  ...over,
});

describe("localized flag serialization", () => {
  it("convertToFieldDefinition carries advanced.localized into the field definition", () => {
    const def = convertToFieldDefinition(
      field({ advanced: { localized: true } })
    );
    expect(def.localized).toBe(true);
  });

  // H4: an untoggled field must NOT serialize an explicit `localized: false` —
  // that would override the backend's smart per-type default (text-like fields
  // localize by default). It must be undefined so the default applies, and the
  // manifest passthrough (which drops undefined) omits it entirely.
  it("convertToFieldDefinition leaves localized undefined when the author didn't set it", () => {
    const def = convertToFieldDefinition(field());
    expect(def.localized).toBeUndefined();
    const manifest = mapBuilderFieldToManifest(
      def as unknown as Parameters<typeof mapBuilderFieldToManifest>[0]
    );
    expect(manifest.localized).toBeUndefined();
  });

  it("convertToFieldDefinition keeps an explicit localized:false (author disabled it)", () => {
    const def = convertToFieldDefinition(field({ advanced: { localized: false } }));
    expect(def.localized).toBe(false);
  });

  it("mapBuilderFieldToManifest passes localized through to the ui-schema field", () => {
    const manifest = mapBuilderFieldToManifest({
      name: "heading",
      type: "text",
      localized: true,
    });
    expect(manifest.localized).toBe(true);
  });

  it("mapBuilderFieldToManifest omits localized when not set", () => {
    const manifest = mapBuilderFieldToManifest({ name: "heading", type: "text" });
    expect(manifest.localized).toBeUndefined();
  });

  it("collectionEntityFromSettings maps the i18n toggle to entity.localized", () => {
    const entity = collectionEntityFromSettings(
      "pages",
      {
        singularName: "Page",
        pluralName: "Pages",
        slug: "pages",
        description: "",
        icon: "FileText",
        status: false,
        i18n: true,
      },
      [{ name: "heading", type: "text", localized: true }]
    );
    expect(entity.localized).toBe(true);
    expect(entity.fields[0].localized).toBe(true);
  });

  it("collectionEntityFromSettings sets localized false when i18n is off", () => {
    const entity = collectionEntityFromSettings(
      "pages",
      {
        singularName: "Page",
        pluralName: "Pages",
        slug: "pages",
        description: "",
        icon: "FileText",
        status: false,
        i18n: false,
      },
      []
    );
    expect(entity.localized).toBe(false);
  });
});
