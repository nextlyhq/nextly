import { describe, expect, it } from "vitest";

import type { EmailFieldConfig } from "../../../collections/fields/types/email";

import { mapEmailField } from "./email";
import type { MappingContext } from "./types";

const baseCtx: MappingContext = {
  schemaRef: n => ({ $ref: `#/components/schemas/${n}` }),
  ownerSlug: "users",
  fieldPath: "fields[0]",
};

describe("mapEmailField", () => {
  it("emits format: 'email'", () => {
    const field: EmailFieldConfig = { name: "email", type: "email" };
    const { input, output } = mapEmailField(field, baseCtx);
    expect(input).toMatchObject({ type: "string", format: "email" });
    expect(output).toMatchObject({ type: "string", format: "email" });
  });

  it("emits minLength / maxLength / pattern from nested validation", () => {
    const field: EmailFieldConfig = {
      name: "email",
      type: "email",
      validation: { minLength: 5, maxLength: 254, pattern: ".+@example\\..+" },
    };
    const { input } = mapEmailField(field, baseCtx);
    expect(input).toMatchObject({
      type: "string",
      format: "email",
      minLength: 5,
      maxLength: 254,
      pattern: ".+@example\\..+",
    });
  });

  it("admin.description wins, falls back to label", () => {
    const a: EmailFieldConfig = {
      name: "email",
      type: "email",
      label: "Email",
      admin: { description: "We never share your email." },
    };
    const b: EmailFieldConfig = {
      name: "email",
      type: "email",
      label: "Email",
    };
    expect(mapEmailField(a, baseCtx).input.description).toBe(
      "We never share your email."
    );
    expect(mapEmailField(b, baseCtx).input.description).toBe("Email");
  });

  it("input and output are independent objects", () => {
    const field: EmailFieldConfig = { name: "email", type: "email" };
    const { input, output } = mapEmailField(field, baseCtx);
    expect(input).not.toBe(output);
  });
});
