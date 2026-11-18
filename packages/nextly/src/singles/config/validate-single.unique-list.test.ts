/**
 * A Single refuses `unique` on a relation holding a list of references where its config is
 * defined, by the same rule a collection's config applies (`uniqueOnListError`). A relation to one
 * entry stays allowed to be unique.
 */
import { describe, expect, it } from "vitest";

import type { SingleConfig } from "./types";
import { validateSingleConfig } from "./validate-single";

function codesFor(field: Record<string, unknown>) {
  const config = {
    slug: "home",
    fields: [{ name: "title", type: "text" }, field],
  } as unknown as SingleConfig;
  return validateSingleConfig(config).errors;
}

describe("validateSingleConfig: unique on a relation holding a list", () => {
  it("refuses a hasMany relationship marked unique, naming the field", () => {
    expect(
      codesFor({
        name: "picks",
        type: "relationship",
        relationTo: "posts",
        hasMany: true,
        unique: true,
      })
    ).toContainEqual(
      expect.objectContaining({
        path: "fields[1].unique",
        code: "UNIQUE_NOT_ON_LIST",
      })
    );
  });

  it("allows a relation to one entry to be unique", () => {
    expect(
      codesFor({
        name: "pick",
        type: "relationship",
        relationTo: "posts",
        unique: true,
      }).map(error => error.code)
    ).not.toContain("UNIQUE_NOT_ON_LIST");
  });
});
