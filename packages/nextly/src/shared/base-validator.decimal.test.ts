/**
 * The shared decimal-dimension validator backs collections, singles, and
 * components, so a `dbType: "decimal"` field is checked the same way on every
 * surface. Exercised directly here.
 */
import { describe, expect, it } from "vitest";

import {
  type BaseValidationError,
  validateNumberDecimalDimensionsShared,
} from "./base-validator";

function codes(field: Record<string, unknown>): string[] {
  const errors: BaseValidationError[] = [];
  validateNumberDecimalDimensionsShared(field, "f", errors);
  return errors.map(e => e.code);
}

describe("validateNumberDecimalDimensionsShared", () => {
  it("ignores non-number and non-decimal fields", () => {
    expect(codes({ type: "number" })).toEqual([]);
    expect(
      codes({ type: "number", dbType: "integer", precision: 2, scale: 5 })
    ).toEqual([]);
    expect(codes({ type: "text", dbType: "decimal", precision: 0 })).toEqual(
      []
    );
  });

  it("accepts a valid decimal", () => {
    expect(
      codes({ type: "number", dbType: "decimal", precision: 10, scale: 2 })
    ).toEqual([]);
  });

  it("rejects scale greater than precision", () => {
    expect(
      codes({ type: "number", dbType: "decimal", precision: 5, scale: 10 })
    ).toContain("DECIMAL_SCALE_EXCEEDS_PRECISION");
  });

  it("rejects out-of-range precision and scale (portable MySQL bounds)", () => {
    expect(
      codes({ type: "number", dbType: "decimal", precision: 66 })
    ).toContain("DECIMAL_PRECISION_INVALID");
    expect(
      codes({ type: "number", dbType: "decimal", precision: 40, scale: 31 })
    ).toContain("DECIMAL_SCALE_INVALID");
  });

  it("rejects a non-integer precision", () => {
    expect(
      codes({ type: "number", dbType: "decimal", precision: 10.5 })
    ).toContain("DECIMAL_PRECISION_INVALID");
  });
});
