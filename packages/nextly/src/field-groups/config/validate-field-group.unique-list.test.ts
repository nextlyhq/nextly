/**
 * A field group refuses `unique` on a relation holding a list of references where its config is
 * defined, by the same rule a collection's and a Single's config apply (`uniqueOnListError`), so
 * `defineFieldGroup` and the build answer as the schema's create does. A relation to one entry
 * stays allowed to be unique.
 */
import { describe, expect, it } from "vitest";

import type { FieldGroupConfig } from "./types";
import { validateFieldGroupConfig } from "./validate-field-group";

function errorsFor(field: Record<string, unknown>) {
  const config = {
    slug: "seo",
    fields: [{ name: "title", type: "text" }, field],
  } as unknown as FieldGroupConfig;
  return validateFieldGroupConfig(config).errors;
}

const PICKS = {
  name: "picks",
  type: "relationship",
  relationTo: "posts",
  hasMany: true,
  unique: true,
};

describe("validateFieldGroupConfig: unique on a relation holding a list", () => {
  it("refuses a hasMany relationship marked unique, naming the field and the fix", () => {
    expect(errorsFor(PICKS)).toContainEqual(
      expect.objectContaining({
        path: "fields[1].unique",
        code: "UNIQUE_NOT_ON_LIST",
        message: expect.stringContaining(
          'Turn Unique off on "picks", or make it a single link.'
        ),
      })
    );
  });

  it("refuses one inside a group", () => {
    expect(
      errorsFor({ name: "meta", type: "group", fields: [PICKS] }).map(
        error => error.code
      )
    ).toContain("UNIQUE_NOT_ON_LIST");
  });

  it("allows a relation to one entry to be unique", () => {
    expect(
      errorsFor({
        name: "pick",
        type: "relationship",
        relationTo: "posts",
        unique: true,
      }).map(error => error.code)
    ).not.toContain("UNIQUE_NOT_ON_LIST");
  });
});
