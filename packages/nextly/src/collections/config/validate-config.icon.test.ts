/**
 * An icon field's default is written into the column's DDL and onto every new
 * entry, so a default that is not an icon id (`<set>:<name>`) is refused when
 * the config is defined. Only the shape is judged: a well-formed id from a set
 * nobody registered is accepted, since sets are registered at runtime.
 */
import { describe, expect, it } from "vitest";

import type { SingleConfig } from "../../singles/config/types";
import { validateSingleConfig } from "../../singles/config/validate-single";
import { validateFieldGroupConfig } from "../../field-groups/config/validate-field-group";
import { icon, text } from "../fields/helpers";
import type { IconFieldConfig } from "../fields/types/icon";

import { defineCollection, type CollectionConfig } from "./define-collection";
import { validateCollectionConfig } from "./validate-config";

function collectionCodes(field: IconFieldConfig): string[] {
  const config: CollectionConfig = {
    slug: "features",
    fields: [text({ name: "title" }), field],
  };
  return validateCollectionConfig(config).errors.map(e => e.code);
}

describe("validateCollectionConfig: icon default", () => {
  it("accepts a well-formed id, an id from an unregistered set, and no default", () => {
    expect(
      collectionCodes(icon({ name: "badge", defaultValue: "lucide:star" }))
    ).toEqual([]);
    expect(
      collectionCodes(icon({ name: "badge", defaultValue: "acme:rocket-2" }))
    ).toEqual([]);
    expect(collectionCodes(icon({ name: "badge" }))).toEqual([]);
  });

  it("rejects a default that is not an icon id", () => {
    for (const bad of ["Star", "lucide:", ":star", "Lucide:Star", ""]) {
      expect(
        validateCollectionConfig({
          slug: "features",
          fields: [icon({ name: "badge", defaultValue: bad })],
        }).errors
      ).toEqual([
        expect.objectContaining({
          path: "fields[0].defaultValue",
          code: "ICON_DEFAULT_INVALID",
        }),
      ]);
    }
  });

  it("stops defineCollection, the entry every code-first collection goes through", () => {
    expect(() =>
      defineCollection({
        slug: "features",
        fields: [icon({ name: "badge", defaultValue: "Star" })],
      })
    ).toThrow(/ICON_DEFAULT_INVALID/);
  });

  it("is applied by the single and field-group validators too", () => {
    const fields = [icon({ name: "badge", defaultValue: "Star" })];
    const single: SingleConfig = { slug: "site-settings", fields };
    expect(validateSingleConfig(single).errors.map(e => e.code)).toContain(
      "ICON_DEFAULT_INVALID"
    );
    expect(
      validateFieldGroupConfig({ slug: "feature-card", fields }).errors.map(
        e => e.code
      )
    ).toContain("ICON_DEFAULT_INVALID");
  });
});
