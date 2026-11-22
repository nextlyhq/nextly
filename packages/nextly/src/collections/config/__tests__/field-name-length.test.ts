/**
 * A field's name is what its field group's rows point back to it by, in a parent-pointer column of
 * 255 characters on PostgreSQL and MySQL. A collection or Single declared in code with a longer
 * field-group field would start, and then every entry write would be refused, so configuration
 * refuses it as the Builder's save does, by the same cap (`MAX_FIELD_NAME_LENGTH`).
 */
import { describe, expect, it } from "vitest";

import { validateSingleConfig } from "../../../singles/config/validate-single";
import { validateCollectionConfig } from "../validate-config";

const card = (name: string) => ({
  name,
  type: "component" as const,
  component: "card",
});

const codesOf = (result: { errors: { code: string }[] }) =>
  result.errors.map(error => error.code);

describe("a field name declared in code", () => {
  it("is refused past 255 characters on a collection, column or not", () => {
    const declare = (name: string) =>
      validateCollectionConfig({
        slug: "posts",
        fields: [{ name: "title", type: "text" }, card(name)],
      } as never);
    expect(codesOf(declare("a".repeat(256)))).toContain("FIELD_NAME_TOO_LONG");
    expect(codesOf(declare("a".repeat(255)))).not.toContain(
      "FIELD_NAME_TOO_LONG"
    );
  });

  it("is refused past 255 characters on a Single", () => {
    const declare = (name: string) =>
      validateSingleConfig({ slug: "home", fields: [card(name)] } as never);
    expect(codesOf(declare("a".repeat(256)))).toContain("FIELD_NAME_TOO_LONG");
    expect(codesOf(declare("a".repeat(255)))).not.toContain(
      "FIELD_NAME_TOO_LONG"
    );
  });
});
