// Why: pin the schema-save preflight contract for the Schema Builder.
// zero user fields is a legitimate state: the auto-create flow already
// creates schemas with empty user fields, and system columns
// (id, title, slug, timestamps, status) make a zero-user-field schema
// fully functional. The other three guards (unnamed-field, missing
// component reference, missing select options) stay in place.
import { describe, expect, it } from "vitest";

import type { BuilderField } from "@admin/components/features/schema-builder/types";

import { builderFieldErrors, validateBuilderFields } from "../field-validators";

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

  it("returns the missing-reference error for a field-group field with no field group", () => {
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
    expect(result.errorMessage).toMatch(
      /Field "hero" must have a field group selected/
    );
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

describe("builderFieldErrors", () => {
  it("marks each field with an error, at any depth, by its id", () => {
    const fields: BuilderField[] = [
      baseField({ id: "ok" }),
      baseField({
        id: "group",
        name: "group",
        type: "group",
        fields: [
          baseField({ id: "unnamed", name: "" }),
          baseField({
            id: "choice",
            name: "choice",
            type: "select",
            options: [],
          }),
          baseField({ id: "ref", name: "ref", type: "component" }),
        ],
      }),
    ];
    const errors = builderFieldErrors(fields);
    expect([...errors.keys()]).toEqual(["unnamed", "choice", "ref"]);
    expect(errors.get("choice")?.message).toBe(
      'Select/Radio field "choice" must have at least one option'
    );
  });

  it("refuses a save with the first error the outline marks", () => {
    const fields: BuilderField[] = [
      baseField({ id: "choice", name: "choice", type: "select", options: [] }),
      baseField({
        id: "group",
        name: "group",
        type: "group",
        fields: [baseField({ id: "unnamed", name: "" })],
      }),
    ];
    // An unnamed field is reported before a select without options, wherever
    // it sits, as the save always has.
    expect(validateBuilderFields(fields)).toEqual({
      valid: false,
      errorMessage: "All fields must have a name",
    });
  });

  it("holds a save on a max length of 0, saying what the panel says under it", () => {
    // Why: the panel flagged the bound but Save stored it anyway, and
    // downstream read 0 as "no limit" — so the field said to hold nothing
    // held anything.
    const fields: BuilderField[] = [
      baseField({
        id: "f1",
        name: "title",
        validation: { maxLength: 0 },
      }),
    ];
    const errors = builderFieldErrors(fields);
    expect(errors.get("f1")?.message).toBe(
      'Field "title": Max length must be at least 1.'
    );
    expect(validateBuilderFields(fields)).toEqual({
      valid: false,
      errorMessage: 'Field "title": Max length must be at least 1.',
    });
  });

  it("holds a save on a minimum above its maximum, rows included", () => {
    // Why: core refuses a lower bound above its upper one for lengths and
    // values, but not for rows — the builder's own gate is the only refusal a
    // row bound gets. A textarea is where rows are offered.
    const fields: BuilderField[] = [
      baseField({
        id: "f1",
        name: "tags",
        type: "textarea",
        validation: { minRows: 5, maxRows: 2 },
      }),
    ];
    expect(validateBuilderFields(fields)).toEqual({
      valid: false,
      errorMessage: 'Field "tags": Min rows can\'t be more than max rows.',
    });
  });

  it("holds a save on a count that is not a whole number of zero or more", () => {
    const fields: BuilderField[] = [
      baseField({
        id: "f1",
        name: "title",
        validation: { minLength: 2.5 },
      }),
    ];
    expect(validateBuilderFields(fields)).toEqual({
      valid: false,
      errorMessage: 'Field "title": Use a whole number, 0 or more.',
    });
  });

  it("keeps a save free for bounds that stand, and a field with none set", () => {
    const fields: BuilderField[] = [
      baseField({
        id: "f1",
        name: "title",
        validation: { minLength: 2, maxLength: 10 },
      }),
      baseField({
        id: "f2",
        name: "count",
        type: "number",
        validation: { min: 0, max: 5 },
      }),
      baseField({ id: "f3", name: "body" }),
    ];
    expect(validateBuilderFields(fields)).toEqual({ valid: true });
    expect(builderFieldErrors(fields).size).toBe(0);
  });

  it("does not judge a stored bound the field's type does not offer", () => {
    // Why: the loader keeps a stored validation object as it was, so a bound
    // from another life of the field — an icon's length, a text field's rows
    // — can arrive with a type that no longer offers it. Refusing it would
    // hold the save about a control the Validation tab never shows, with no
    // way to fix it there.
    const fields: BuilderField[] = [
      baseField({
        id: "f1",
        name: "favicon",
        type: "icon",
        validation: { maxLength: 0 },
      }),
      baseField({
        id: "f2",
        name: "title",
        validation: { minRows: 5, maxRows: 2 },
      }),
    ];
    expect(validateBuilderFields(fields)).toEqual({ valid: true });
    expect(builderFieldErrors(fields).size).toBe(0);
  });
});
