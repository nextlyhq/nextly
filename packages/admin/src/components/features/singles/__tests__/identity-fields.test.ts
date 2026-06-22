import type { FieldConfig } from "nextly/config";
import { describe, it, expect } from "vitest";

import { relaxIdentityRequired } from "../identity-fields";

describe("relaxIdentityRequired", () => {
  it("marks title and slug not-required, leaving other fields untouched", () => {
    const out = relaxIdentityRequired([
      { type: "text", name: "title", required: true },
      { type: "text", name: "slug", required: true },
      { type: "text", name: "heroTitle", required: true },
    ] as unknown as FieldConfig[]);

    const byName = Object.fromEntries(
      out.map(f => [(f as { name: string }).name, f as { required?: boolean }])
    );
    expect(byName.title.required).toBe(false);
    expect(byName.slug.required).toBe(false);
    expect(byName.heroTitle.required).toBe(true);
  });

  it("clears nested validation.required for identity fields but keeps other rules", () => {
    const [title] = relaxIdentityRequired([
      {
        type: "text",
        name: "title",
        validation: { required: true, maxLength: 80 },
      },
    ] as unknown as FieldConfig[]);

    const v = (
      title as { validation: { required?: boolean; maxLength?: number } }
    ).validation;
    expect(v.required).toBe(false);
    expect(v.maxLength).toBe(80);
  });
});
