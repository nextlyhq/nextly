/**
 * A `dbType: "decimal"` number field renders precision/scale straight into DDL,
 * so invalid dimensions must be caught at config time rather than failing later
 * at the database.
 */
import { describe, expect, it } from "vitest";

import { number, text } from "../fields/helpers";
import type { NumberFieldConfig } from "../fields/types/number";
import type { CollectionConfig } from "./define-collection";
import { validateCollectionConfig } from "./validate-config";

function codesFor(field: NumberFieldConfig): string[] {
  const config: CollectionConfig = {
    slug: "products",
    fields: [text({ name: "title" }), field],
  };
  return validateCollectionConfig(config).errors.map(e => e.code);
}

describe("validateCollectionConfig: decimal number dimensions", () => {
  it("accepts a valid decimal field", () => {
    const codes = codesFor(
      number({ name: "price", dbType: "decimal", precision: 10, scale: 2 })
    );
    expect(codes).not.toContain("DECIMAL_PRECISION_INVALID");
    expect(codes).not.toContain("DECIMAL_SCALE_INVALID");
    expect(codes).not.toContain("DECIMAL_SCALE_EXCEEDS_PRECISION");
  });

  it("rejects scale greater than precision", () => {
    expect(
      codesFor(
        number({ name: "price", dbType: "decimal", precision: 5, scale: 10 })
      )
    ).toContain("DECIMAL_SCALE_EXCEEDS_PRECISION");
  });

  it("rejects scale greater than the default precision when precision is omitted", () => {
    expect(
      codesFor(number({ name: "price", dbType: "decimal", scale: 12 }))
    ).toContain("DECIMAL_SCALE_EXCEEDS_PRECISION");
  });

  it("rejects a non-positive-integer precision", () => {
    expect(
      codesFor(number({ name: "price", dbType: "decimal", precision: 0 }))
    ).toContain("DECIMAL_PRECISION_INVALID");
    expect(
      codesFor(number({ name: "price", dbType: "decimal", precision: 10.5 }))
    ).toContain("DECIMAL_PRECISION_INVALID");
  });

  it("rejects a negative scale", () => {
    expect(
      codesFor(number({ name: "price", dbType: "decimal", scale: -1 }))
    ).toContain("DECIMAL_SCALE_INVALID");
  });

  it("rejects precision above the portable MySQL maximum (65)", () => {
    expect(
      codesFor(number({ name: "price", dbType: "decimal", precision: 66 }))
    ).toContain("DECIMAL_PRECISION_INVALID");
  });

  it("accepts precision at the maximum (65)", () => {
    expect(
      codesFor(
        number({ name: "price", dbType: "decimal", precision: 65, scale: 2 })
      )
    ).not.toContain("DECIMAL_PRECISION_INVALID");
  });

  it("rejects scale above the portable MySQL maximum (30)", () => {
    expect(
      codesFor(
        number({ name: "price", dbType: "decimal", precision: 40, scale: 31 })
      )
    ).toContain("DECIMAL_SCALE_INVALID");
  });

  it("ignores precision/scale on an integer field", () => {
    // These are meaningless for integer storage and must not raise errors.
    const codes = codesFor(number({ name: "count", precision: 2, scale: 5 }));
    expect(codes).not.toContain("DECIMAL_SCALE_EXCEEDS_PRECISION");
    expect(codes).not.toContain("DECIMAL_PRECISION_INVALID");
  });
});
