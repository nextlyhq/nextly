import { describe, expect, it } from "vitest";

import type { CheckboxFieldConfig } from "../../../collections/fields/types/checkbox";

import { mapCheckboxField } from "./checkbox";
import type { MappingContext } from "./types";

const baseCtx: MappingContext = {
  schemaRef: n => ({ $ref: `#/components/schemas/${n}` }),
  ownerSlug: "posts",
  fieldPath: "fields[0]",
};

describe("mapCheckboxField", () => {
  it("maps to a plain boolean schema", () => {
    const field: CheckboxFieldConfig = {
      name: "published",
      type: "checkbox",
    };
    const { input, output } = mapCheckboxField(field, baseCtx);
    expect(input).toEqual({ type: "boolean" });
    expect(output).toEqual({ type: "boolean" });
  });

  it("admin.description wins, label is the fallback", () => {
    const a: CheckboxFieldConfig = {
      name: "published",
      type: "checkbox",
      label: "Published",
      admin: { description: "Visible to readers." },
    };
    const b: CheckboxFieldConfig = {
      name: "published",
      type: "checkbox",
      label: "Published",
    };
    expect(mapCheckboxField(a, baseCtx).input.description).toBe(
      "Visible to readers."
    );
    expect(mapCheckboxField(b, baseCtx).input.description).toBe("Published");
  });

  it("input and output are independent objects", () => {
    const field: CheckboxFieldConfig = { name: "ok", type: "checkbox" };
    const { input, output } = mapCheckboxField(field, baseCtx);
    expect(input).not.toBe(output);
  });
});
