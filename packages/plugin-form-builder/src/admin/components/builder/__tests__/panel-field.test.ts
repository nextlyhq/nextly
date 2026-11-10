/**
 * A form field moved into the shared settings panel's shape and back must come
 * back as it went in, for every type, with every setting a form can store:
 * a setting the panel has no place for would otherwise be dropped by the first
 * edit, and the form saved without it. Each fixture sets every property its
 * type allows, so a key the mapping forgets fails here rather than passing on
 * a field that never carried it.
 *
 * @module admin/components/builder/__tests__/panel-field.test
 */
import { describe, expect, it } from "vitest";

import type { AnyFormField } from "../../../../types";
import {
  formOnlyOf,
  fromPanelField,
  toPanelField,
  withFormOnly,
} from "../panel-field";

const conditionalLogic = {
  enabled: true,
  action: "hide" as const,
  operator: "OR" as const,
  conditions: [{ field: "other", operator: "equals" as const, value: "x" }],
};

const common = {
  name: "subject",
  label: "Subject",
  placeholder: "Type here",
  helpText: "What it is about",
  required: true,
  conditionalLogic,
  admin: { width: "50%" as const, className: "wide" },
};

const EVERY_TYPE: AnyFormField[] = [
  {
    ...common,
    type: "text",
    defaultValue: "Hello",
    validation: {
      minLength: 2,
      maxLength: 40,
      pattern: "^[a-z]+$",
      errorMessage: "Letters only",
    },
  },
  {
    ...common,
    type: "email",
    defaultValue: "a@b.co",
    validation: { pattern: ".+@example\\.com$", errorMessage: "Work email" },
  },
  {
    ...common,
    type: "number",
    defaultValue: 3,
    validation: { min: 1, max: 9, step: 0.5, errorMessage: "1 to 9" },
  },
  { ...common, type: "phone", validation: { pattern: "^\\+" } },
  { ...common, type: "url", defaultValue: "https://a.b" },
  {
    ...common,
    type: "textarea",
    rows: 6,
    validation: { minLength: 1, maxLength: 500 },
  },
  {
    ...common,
    type: "select",
    options: [
      { label: "One", value: "one" },
      { label: "Two", value: "two" },
    ],
    allowMultiple: true,
    defaultValue: ["one", "two"],
  },
  { ...common, type: "checkbox", defaultValue: true },
  {
    ...common,
    type: "radio",
    options: [{ label: "Yes", value: "yes" }],
    defaultValue: "yes",
  },
  {
    ...common,
    type: "file",
    accept: "image/*",
    multiple: true,
    maxFileSize: 1024,
    attachToEmail: true,
  },
  {
    ...common,
    type: "date",
    defaultValue: "2026-01-01",
    min: "2026-01-01",
    max: "2026-12-31",
  },
  { ...common, type: "time", defaultValue: "09:00" },
  { ...common, type: "hidden", defaultValue: "website" },
  // A plugin's type: only the base properties, which must survive too.
  { ...common, type: "star-rating", defaultValue: 4 },
];

describe("a form field in the panel and back", () => {
  it.each(EVERY_TYPE.map(field => [field.type, field] as const))(
    "keeps every %s setting",
    (_, field) => {
      expect(fromPanelField(toPanelField(field, "f-1"))).toStrictEqual(field);
    }
  );

  it("keeps a bare field bare, and empty objects empty", () => {
    const bare: AnyFormField = { type: "text", name: "a", label: "A" };
    expect(fromPanelField(toPanelField(bare, "f-1"))).toStrictEqual(bare);
    const empty: AnyFormField = {
      type: "text",
      name: "a",
      label: "A",
      validation: {},
      admin: {},
    };
    expect(fromPanelField(toPanelField(empty, "f-1"))).toStrictEqual(empty);
  });
});

describe("the panel's spelling of a form's settings", () => {
  const field = EVERY_TYPE[0]!;
  const panel = toPanelField(field, "f-1");

  it("moves each setting the panel edits to where the panel reads it", () => {
    expect(panel).toMatchObject({
      id: "f-1",
      type: "text",
      name: "subject",
      label: "Subject",
      defaultValue: "Hello",
      admin: {
        placeholder: "Type here",
        description: "What it is about",
        width: "50%",
      },
      validation: {
        required: true,
        minLength: 2,
        maxLength: 40,
        pattern: "^[a-z]+$",
        message: "Letters only",
      },
    });
    // The form's spellings are not left beside the panel's.
    expect(panel).not.toHaveProperty("helpText");
    expect(panel.validation).not.toHaveProperty("errorMessage");
  });

  it("calls a dropdown's several choices hasMany", () => {
    const select = toPanelField(EVERY_TYPE[6]!, "f-1");
    expect(select.hasMany).toBe(true);
    expect(fromPanelField({ ...select, hasMany: false })).toMatchObject({
      allowMultiple: false,
    });
  });

  it("writes the panel's changes back in the form's spelling", () => {
    const next = fromPanelField({
      ...panel,
      admin: {
        ...panel.admin,
        description: "New help",
        placeholder: undefined,
      },
      validation: { ...panel.validation, required: false, message: "Nope" },
    });
    expect(next).toMatchObject({
      helpText: "New help",
      required: false,
      validation: { errorMessage: "Nope" },
    });
    // A setting the panel cleared is gone, not left at its old value.
    expect(next).not.toHaveProperty("placeholder");
  });

  it("strips the ids the options editor adds", () => {
    const select = toPanelField(EVERY_TYPE[6]!, "f-1");
    const next = fromPanelField({
      ...select,
      options: [{ id: "drag-1", label: "One", value: "one" }],
    });
    // Strictly: a matcher that allows extra keys would pass with the id left in.
    expect((next as { options?: unknown }).options).toStrictEqual([
      { label: "One", value: "one" },
    ]);
  });

  it("changes a form-only setting and leaves the rest", () => {
    const file = toPanelField(EVERY_TYPE[9]!, "f-9");
    const next = withFormOnly(file, { accept: "application/pdf" });
    expect(next.id).toBe("f-9");
    expect(formOnlyOf(next)).toMatchObject({
      accept: "application/pdf",
      multiple: true,
      maxFileSize: 1024,
    });
    expect(fromPanelField(next)).toStrictEqual({
      ...EVERY_TYPE[9],
      accept: "application/pdf",
    });
  });
});
