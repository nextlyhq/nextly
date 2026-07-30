/**
 * A plugin field added to an existing table gets its storage primitive.
 *
 * A fresh component table maps a plugin type through the canonical descriptor,
 * but `db:sync` adds columns to an existing table through this helper, whose
 * own switch falls back to TEXT for anything it does not recognise — so the
 * same declaration produced a numeric column on one path and a text column on
 * the other.
 */
import { afterEach, describe, expect, it } from "vitest";

import type { FieldConfig } from "../../../../collections/fields/types";
import {
  clearFieldTypes,
  registerFieldType,
} from "../../field-types/field-type-registry";
import { fieldToColumnDef } from "../missing-columns";

afterEach(() => {
  clearFieldTypes();
});

describe("adding a plugin field to an existing table", () => {
  it("uses the type's storage primitive rather than the text fallback", () => {
    registerFieldType({
      type: "star-rating",
      storage: "number",
      component: "@acme/ratings/admin#StarRating",
      surfaces: ["entries", "singles", "components"],
    });

    const column = fieldToColumnDef(
      { name: "score", type: "star-rating" } as unknown as FieldConfig,
      "postgresql"
    );

    expect(column).not.toMatch(/TEXT/i);
    expect(column).toMatch(/INTEGER|REAL|DOUBLE PRECISION|NUMERIC/i);
  });
});
