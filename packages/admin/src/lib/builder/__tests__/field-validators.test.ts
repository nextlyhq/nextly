// Why: pin the schema-save preflight contract for the Schema Builder.
// zero user fields is a legitimate state: the auto-create flow already
// creates schemas with empty user fields, and system columns
// (id, title, slug, timestamps, status) make a zero-user-field schema
// fully functional. The other three guards (unnamed-field, missing
// component reference, missing select options) stay in place.
import { describe, expect, it } from "vitest";

import type { BuilderField } from "@admin/components/features/schema-builder/types";

import { validateBuilderFields } from "../field-validators";

const baseField = (overrides: Partial<BuilderField> = {}): BuilderField => ({
  id: "f1",
  name: "body",
  label: "Body",
  type: "text",
  validation: {},
  ...overrides,
});

describe("validateBuilderFields", () => {
  it("returns valid for an empty fields array (zero-user-field schema)", () => {
    expect(validateBuilderFields([])).toEqual({ valid: true });
  });

  it("returns valid for fields that pass every guard", () => {
    const fields: BuilderField[] = [
      baseField({ id: "f1", name: "title", label: "Title", type: "text" }),
      baseField({ id: "f2", name: "body", label: "Body", type: "textarea" }),
    ];
    expect(validateBuilderFields(fields)).toEqual({ valid: true });
  });

  it("returns the unnamed-field error when any field has an empty name", () => {
    const fields: BuilderField[] = [
      baseField({ id: "f1", name: "title", type: "text" }),
      baseField({ id: "f2", name: "", type: "text" }),
    ];
    expect(validateBuilderFields(fields)).toEqual({
      valid: false,
      errorMessage: "All fields must have a name",
    });
  });

  it("returns the missing-component-reference error for a component field with no component", () => {
    const fields: BuilderField[] = [
      baseField({
        id: "f1",
        name: "hero",
        label: "Hero",
        type: "component",
        component: undefined,
      }),
    ];
    const result = validateBuilderFields(fields);
    expect(result.valid).toBe(false);
    expect(result.errorMessage).toMatch(/Component field "hero" must have/);
  });

  it("returns the missing-options error for a select field with no options", () => {
    const fields: BuilderField[] = [
      baseField({
        id: "f1",
        name: "category",
        label: "Category",
        type: "select",
        options: [],
      }),
    ];
    const result = validateBuilderFields(fields);
    expect(result.valid).toBe(false);
    expect(result.errorMessage).toMatch(
      /Select\/Radio field "category" must have at least one option/
    );
  });

  it("returns the missing-options error for a radio field with no options", () => {
    const fields: BuilderField[] = [
      baseField({
        id: "f1",
        name: "tone",
        label: "Tone",
        type: "radio",
        options: [],
      }),
    ];
    expect(validateBuilderFields(fields).valid).toBe(false);
  });

  it("does not return the legacy 'Please add at least one field' error", () => {
    // Why: lock the regression. The old check fired on any save with
    // userFields.length === 0; this test asserts the message is gone.
    const result = validateBuilderFields([]);
    expect(result.errorMessage).toBeUndefined();
  });
});
