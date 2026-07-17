import { describe, expect, it } from "vitest";

import { createFieldFromType } from "../admin/context/FormBuilderContext";
import { isKnownFormField, BUILT_IN_FORM_FIELD_TYPES } from "../types";

describe("isKnownFormField", () => {
  it("is true for a built-in field type", () => {
    expect(isKnownFormField({ type: "text", name: "a", label: "A" })).toBe(
      true
    );
  });

  it("is false for a plugin-contributed type", () => {
    expect(isKnownFormField({ type: "rating", name: "a", label: "A" })).toBe(
      false
    );
  });

  it("covers exactly the built-in union", () => {
    for (const type of BUILT_IN_FORM_FIELD_TYPES) {
      expect(isKnownFormField({ type, name: "n", label: "L" })).toBe(true);
    }
  });
});

describe("createFieldFromType", () => {
  it("creates a typed built-in field with defaults", () => {
    const field = createFieldFromType("textarea");
    expect(field).toMatchObject({ type: "textarea", name: "textarea" });
    expect(isKnownFormField(field)).toBe(true);
  });

  it("preserves a plugin type id and seeds no built-in defaults", () => {
    const field = createFieldFromType("rating");
    expect(field.type).toBe("rating");
    expect(field.name).toBe("rating");
    // Title-cased label fallback for a type outside the built-in catalog.
    expect(field.label).toBe("Rating");
    expect(isKnownFormField(field)).toBe(false);
  });

  it("de-duplicates the generated name against existing names", () => {
    const field = createFieldFromType("rating", ["rating"]);
    expect(field.name).toBe("rating_2");
  });
});
