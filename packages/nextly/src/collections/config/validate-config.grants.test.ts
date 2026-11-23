/**
 * A collection's `grants.presets` is checked where it is written: a misspelt
 * preset would open the collection to nothing and say nothing.
 */
import { describe, expect, it } from "vitest";

import { text } from "../fields/helpers";

import type { CollectionConfig } from "./define-collection";
import { validateCollectionConfig } from "./validate-config";

function errorsFor(grants: unknown) {
  return validateCollectionConfig({
    slug: "team",
    fields: [text({ name: "name" })],
    grants,
  } as CollectionConfig).errors;
}

describe("validateCollectionConfig: grants", () => {
  it("accepts the preset roles, none at all, and no grants", () => {
    expect(errorsFor(undefined)).toEqual([]);
    expect(errorsFor({})).toEqual([]);
    expect(errorsFor({ presets: [] })).toEqual([]);
    expect(
      errorsFor({ presets: ["admin", "editor", "author", "viewer"] })
    ).toEqual([]);
  });

  it("refuses a name that is not a preset role, naming it and the preset roles", () => {
    const errors = errorsFor({ presets: ["editors", "super-admin"] });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      path: "grants.presets",
      code: "GRANTS_PRESETS_INVALID",
    });
    expect(errors[0].message).toMatch(/"editors", "super-admin"/);
    expect(errors[0].message).toMatch(/admin, editor, author, viewer/);
  });

  it("refuses presets that are not a list of names, and grants that are not an object", () => {
    expect(errorsFor({ presets: "editor" })[0]?.code).toBe(
      "GRANTS_PRESETS_INVALID"
    );
    expect(errorsFor(["editor"])[0]?.code).toBe("GRANTS_PRESETS_INVALID");
  });
});
