import { describe, expect, it } from "vitest";

import type { PasswordFieldConfig } from "../../../collections/fields/types/password";

import { mapPasswordField } from "./password";
import type { MappingContext } from "./types";

const baseCtx: MappingContext = {
  schemaRef: n => ({ $ref: `#/components/schemas/${n}` }),
  ownerSlug: "users",
  fieldPath: "fields[0]",
};

describe("mapPasswordField", () => {
  it("emits writeOnly: true and a default minLength of 8", () => {
    const field: PasswordFieldConfig = { name: "password", type: "password" };
    const { input } = mapPasswordField(field, baseCtx);
    expect(input).toMatchObject({
      type: "string",
      writeOnly: true,
      minLength: 8,
    });
  });

  it("honors a custom minLength from the flat field", () => {
    const field: PasswordFieldConfig = {
      name: "password",
      type: "password",
      minLength: 12,
    };
    const { input } = mapPasswordField(field, baseCtx);
    expect(input).toMatchObject({ minLength: 12, writeOnly: true });
  });

  it("nested validation wins over flat minLength/maxLength", () => {
    const field: PasswordFieldConfig = {
      name: "password",
      type: "password",
      minLength: 8,
      maxLength: 64,
      validation: { minLength: 16, maxLength: 128 },
    };
    const { input } = mapPasswordField(field, baseCtx);
    expect(input).toMatchObject({ minLength: 16, maxLength: 128 });
  });

  it("emits pattern from nested validation", () => {
    const field: PasswordFieldConfig = {
      name: "password",
      type: "password",
      validation: { pattern: "(?=.*[A-Z])(?=.*[a-z])(?=.*\\d).{8,}" },
    };
    const { input } = mapPasswordField(field, baseCtx);
    expect(input.pattern).toBe("(?=.*[A-Z])(?=.*[a-z])(?=.*\\d).{8,}");
  });

  it("output is symmetric to input (omission from response schema is handled by the collection composer in T11)", () => {
    const field: PasswordFieldConfig = { name: "password", type: "password" };
    const { input, output } = mapPasswordField(field, baseCtx);
    // The mapper returns a writeOnly output too; the per-collection schema
    // builder in T11 is responsible for OMITTING password fields from the
    // read variant entirely. This keeps the mapper itself pure.
    expect(output).toMatchObject({ writeOnly: true });
    expect(input).not.toBe(output);
  });

  it("uses admin.description, falling back to label", () => {
    const a: PasswordFieldConfig = {
      name: "password",
      type: "password",
      label: "Password",
      admin: { description: "Min 12 characters, mixed case." },
    };
    const b: PasswordFieldConfig = {
      name: "password",
      type: "password",
      label: "Password",
    };
    expect(mapPasswordField(a, baseCtx).input.description).toBe(
      "Min 12 characters, mixed case."
    );
    expect(mapPasswordField(b, baseCtx).input.description).toBe("Password");
  });
});
