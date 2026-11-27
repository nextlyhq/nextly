import type { FieldConfig } from "nextly/config";
import { describe, it, expect } from "vitest";

import {
  fixedIdentityNames,
  ownTitleInHeading,
  relaxIdentityRequired,
} from "../identity-fields";

/** Both identity fields fixed by config, as for a Single declaring neither. */
const BOTH = fixedIdentityNames({});

describe("relaxIdentityRequired", () => {
  it("marks title and slug not-required, leaving other fields untouched", () => {
    const out = relaxIdentityRequired(
      [
        { type: "text", name: "title", required: true },
        { type: "text", name: "slug", required: true },
        { type: "text", name: "heroTitle", required: true },
      ] as unknown as FieldConfig[],
      BOTH
    );

    const byName = Object.fromEntries(
      out.map(f => [(f as { name: string }).name, f as { required?: boolean }])
    );
    expect(byName.title.required).toBe(false);
    expect(byName.slug.required).toBe(false);
    expect(byName.heroTitle.required).toBe(true);
  });

  it("clears nested validation.required for identity fields but keeps other rules", () => {
    const [title] = relaxIdentityRequired(
      [
        {
          type: "text",
          name: "title",
          validation: { required: true, maxLength: 80 },
        },
      ] as unknown as FieldConfig[],
      BOTH
    );

    const v = (
      title as { validation: { required?: boolean; maxLength?: number } }
    ).validation;
    expect(v.required).toBe(false);
    expect(v.maxLength).toBe(80);
  });

  it("leaves an author's own title its required rule", () => {
    const fixed = fixedIdentityNames({ ownIdentityFields: ["title"] });
    const out = relaxIdentityRequired(
      [
        { type: "text", name: "title", required: true },
        { type: "text", name: "slug", required: true },
      ] as unknown as FieldConfig[],
      fixed
    );

    expect([...fixed]).toEqual(["slug"]);
    expect(out.map(f => (f as { required?: boolean }).required)).toEqual([
      true,
      false,
    ]);
  });
});

describe("ownTitleInHeading", () => {
  const title = (extra: Record<string, unknown>) =>
    ({ type: "text", name: "title", ...extra }) as unknown as FieldConfig;

  it("draws a plain, always-shown text title in the heading", () => {
    expect(ownTitleInHeading(title({}))).toBe(true);
  });

  it("leaves any title the one-line heading can't hold to its own control", () => {
    expect(ownTitleInHeading(title({ type: "number" }))).toBe(false);
    expect(ownTitleInHeading(title({ hasMany: true }))).toBe(false);
    expect(
      ownTitleInHeading(title({ admin: { component: "@acme/x#Editor" } }))
    ).toBe(false);
    expect(ownTitleInHeading(title({ admin: { hidden: true } }))).toBe(false);
    expect(
      ownTitleInHeading(
        title({
          admin: {
            condition: { field: "intro", operator: "exists" },
          },
        })
      )
    ).toBe(false);
  });
});
